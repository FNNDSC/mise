/**
 * @file Pipeline business logic for salsa.
 *
 * Wraps cumin's pipeline primitives to provide higher-level operations:
 * listing, running, and fetching source YAML for registered pipelines.
 *
 * @module
 */

import {
  chrisConnection,
  errorStack,
  FilteredResourceData,
  ListOptions,
  Result,
  Ok,
  Err,
  PipelineRecord,
  WorkflowCreateOptions,
  WorkflowResult,
  ChRISPipelineGroup,
  pipelines_list as cumin_pipelines_list,
  pipeline_resolve,
  pipeline_createWorkflow,
  pipelineFile_getTextByPath,
} from '@fnndsc/cumin';

export {
  pipelineDiagram_get,
  type PipelineDiagram,
  type PipelineDiagramArgument,
  type PipelineDiagramNode,
} from './diagram.js';
export {
  pipelineManifest_get,
  type PipelineManifest,
  type PipelineManifestGetOptions,
  type PipelineManifestNode,
  type PipelineManifestParameterDefault,
} from './manifest.js';
export {
  pipelineInvocation_prepare,
  type PipelineInvocationBinding,
  type PipelineInvocationPrepareOptions,
  type PipelineParameterDefinition,
  type PreparedPipelineInvocation,
  type PreparedWorkflowNode,
} from './invocation.js';
import axios from 'axios';
import {
  pipelineManifestForPipeline_get,
  pipelineManifest_get,
  type PipelineManifest,
  type PipelineManifestResource,
} from './manifest.js';
import {
  pipelineInvocation_prepare,
  type PipelineInvocationBinding,
  type PreparedPipelineInvocation,
} from './invocation.js';

export type { PipelineRecord, WorkflowResult };

type ConnectionClient = Awaited<ReturnType<typeof chrisConnection.client_get>>;

interface PipelineSlugCacheEntry {
  record: PipelineRecord;
  resource: PipelineLookupResource;
  expiresAt: number;
}

interface PipelineSourceFileItem {
  data: { fname: string; pipeline_id?: number; pipeline_name?: string };
}

interface PipelineSourceFileList {
  getItems: () => PipelineSourceFileItem[];
}

interface PipelineLookupResource extends PipelineManifestResource {
  data?: PipelineRecord;
}

interface PipelineLookupClient {
  getPipeline: (id: number) => Promise<PipelineLookupResource | null>;
  getPipelineSourceFiles: (options: Record<string, unknown>) => Promise<PipelineSourceFileList>;
}

const PIPELINE_SLUG_TTL_MS: number = 5 * 60 * 1000;
const pipelineSlugCaches: WeakMap<object, Map<string, PipelineSlugCacheEntry>> = new WeakMap();

function pipelineSlugCache_get(client: object): Map<string, PipelineSlugCacheEntry> {
  let cache: Map<string, PipelineSlugCacheEntry> | undefined = pipelineSlugCaches.get(client);
  if (cache === undefined) {
    cache = new Map();
    pipelineSlugCaches.set(client, cache);
  }
  return cache;
}

function pipelineSlug_create(pipeline: PipelineRecord, sourceFilename?: string): string {
  const sourceBase: string | undefined = sourceFilename
    ?.split('/').pop()?.replace(/\.(ya?ml)$/i, '');
  const generatedBase: string = pipeline.name
    .replace(/[^a-zA-Z0-9]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
  return `${sourceBase ?? generatedBase}_id${pipeline.id}`;
}

/**
 * Lists registered pipelines, optionally filtered by name substring.
 * Returns FilteredResourceData for table rendering compatibility.
 *
 * @param search - Optional name substring filter.
 */
export async function pipelines_list(
  search?: string
): Promise<FilteredResourceData | null> {
  const result: Result<PipelineRecord[]> = await cumin_pipelines_list(search);
  if (!result.ok || result.value.length === 0) return null;

  const records: Record<string, unknown>[] = result.value as Record<string, unknown>[];
  return {
    tableData: records,
    selectedFields: ['id', 'name', 'authors', 'category', 'description'],
  };
}

/**
 * Lists all pipelines across all pages.
 *
 * @param options - Search options (limit/offset managed internally).
 */
export async function pipelines_listAll(options: Partial<ListOptions> = {}): Promise<FilteredResourceData | null> {
  const group: ChRISPipelineGroup = new ChRISPipelineGroup();
  return await group.asset.resources_getAll(options);
}

/**
 * Returns available field names for pipelines.
 */
export async function pipelineFields_get(): Promise<string[] | null> {
  const group: ChRISPipelineGroup = new ChRISPipelineGroup();
  const result = await group.asset.resourceFields_get();
  return result ? result.fields : null;
}

/**
 * Returns all registered pipelines as a flat array for /bin listing.
 * Attaches a filesystem-safe slug derived from each pipeline's source filename.
 * Pipelines without a source file get a slug generated from their name.
 *
 * @returns Result containing array of PipelineRecord (with slug attached).
 */
export async function pipelines_getAll(): Promise<Result<PipelineRecord[]>> {
  const client: ConnectionClient = await chrisConnection.client_get();
  if (!client) {
    errorStack.stack_push('error', 'Not connected to ChRIS');
    return Err();
  }

  const [pipelinesResult, sourceFilesResponse] = await Promise.all([
    cumin_pipelines_list(),
    (client as unknown as {
      getPipelineSourceFiles: (o: Record<string, unknown>) => Promise<{
        getItems: () => Array<{ data: { fname: string; pipeline_name?: string; pipeline_id?: number } }>;
      }>;
    }).getPipelineSourceFiles({ limit: 1000 }).catch(() => null),
  ]);

  if (!pipelinesResult.ok) return Err();

  const idToSourceFilename: Map<number, string> = new Map<number, string>();
  if (sourceFilesResponse) {
    for (const item of sourceFilesResponse.getItems()) {
      const { fname, pipeline_id } = item.data;
      if (pipeline_id && fname) {
        idToSourceFilename.set(pipeline_id, fname);
      }
    }
  }

  const records = pipelinesResult.value.map((pipeline: PipelineRecord) => ({
    ...pipeline,
    slug: pipelineSlug_create(pipeline, idToSourceFilename.get(pipeline.id)),
  }));

  return Ok(records);
}

/**
 * Project one exact Pipeline executable slug without listing every Pipeline.
 *
 * The stable `_id<N>` suffix identifies the candidate Pipeline. The targeted
 * source-file lookup then verifies the complete slug before it is accepted.
 *
 * @param slug - Exact Pipeline basename exposed in `/bin`.
 * @returns The registered invocation manifest for the exact Pipeline slug.
 */
export async function pipelineManifestBySlug_get(slug: string): Promise<Result<PipelineManifest>> {
  const match: RegExpMatchArray | null = slug.match(/_id(\d+)$/);
  if (match === null) return Err();

  const pipelineID: number = Number(match[1]);
  const client: ConnectionClient = await chrisConnection.client_get();
  if (!client) {
    errorStack.stack_push('error', 'Not connected to ChRIS');
    return Err();
  }
  const cache: Map<string, PipelineSlugCacheEntry> = pipelineSlugCache_get(client as object);
  const cached: PipelineSlugCacheEntry | undefined = cache.get(slug);
  if (cached !== undefined && cached.expiresAt > Date.now()) {
    return pipelineManifestForPipeline_get(
      cached.record,
      cached.resource,
      { detail: 'registered' },
    );
  }
  if (cached !== undefined) cache.delete(slug);

  try {
    const typedClient: PipelineLookupClient = client as unknown as PipelineLookupClient;
    const [pipelineResource, sourceFiles]: [PipelineLookupResource | null, PipelineSourceFileList] = await Promise.all([
      typedClient.getPipeline(pipelineID),
      typedClient.getPipelineSourceFiles({ pipeline_id: pipelineID, limit: 1000 }),
    ]);
    if (pipelineResource === null || pipelineResource.data === undefined) return Err();
    const pipeline: PipelineRecord = pipelineResource.data;

    const sourceItems: PipelineSourceFileItem[] = sourceFiles.getItems();
    const source: PipelineSourceFileItem | undefined = sourceItems.find(
      (item: PipelineSourceFileItem): boolean => item.data.pipeline_id === pipelineID,
    )
      ?? sourceItems.find(
        (item: PipelineSourceFileItem): boolean => item.data.pipeline_name === pipeline.name,
      )
      ?? (sourceItems.length === 1 ? sourceItems[0] : undefined);
    const exactSlug: string = pipelineSlug_create(pipeline, source?.data.fname);
    if (exactSlug !== slug) return Err();
    const record: PipelineRecord = { ...pipeline, slug: exactSlug };
    cache.set(slug, {
      record,
      resource: pipelineResource,
      expiresAt: Date.now() + PIPELINE_SLUG_TTL_MS,
    });
    return pipelineManifestForPipeline_get(record, pipelineResource, { detail: 'registered' });
  } catch (error: unknown) {
    const message: string = error instanceof Error ? error.message : String(error);
    errorStack.stack_push('error', `pipelineManifestBySlug_get: ${message}`);
    return Err();
  }
}

/** Runtime overlays accepted by `pipeline_run`. */
export interface PipelineRunOptions {
  /** Compute placement baseline applied before node-specific overlays. */
  globalCompute?: string;
  /** Parsed sparse or complete registered-manifest YAML overlay. */
  parameterFile?: unknown;
  /** Explicit node-qualified values, with highest precedence. */
  cliBindings?: PipelineInvocationBinding[];
}

/**
 * Run a pipeline by name or ID, attaching it to a previous plugin instance.
 *
 * @param nameOrId - Pipeline name or numeric ID string.
 * @param previousPluginInstId - Plugin instance to which pipeline roots attach.
 * @param invocationOptions - Runtime overlays, or the legacy global compute string.
 * @returns Result containing Workflow ID and created plugin instance IDs.
 */
export async function pipeline_run(
  nameOrId: string,
  previousPluginInstId: number,
  invocationOptions: PipelineRunOptions | string = {},
): Promise<Result<WorkflowResult>> {
  const normalized: PipelineRunOptions = typeof invocationOptions === 'string'
    ? { globalCompute: invocationOptions }
    : invocationOptions;
  const manifestResult: Result<PipelineManifest> = await pipelineManifest_get(nameOrId);
  if (!manifestResult.ok) return Err();
  const prepared: Result<PreparedPipelineInvocation> = pipelineInvocation_prepare({
    manifest: manifestResult.value,
    globalCompute: normalized.globalCompute,
    parameterFile: normalized.parameterFile,
    cliBindings: normalized.cliBindings,
  });
  if (!prepared.ok) return Err();
  const options: WorkflowCreateOptions = {
    previousPluginInstId,
    nodeOverrides: prepared.value.nodeOverrides,
  };
  return pipeline_createWorkflow(prepared.value.pipelineID, options);
}

/**
 * Fetches the YAML source of a registered pipeline by searching /PIPELINES/ for
 * a file whose basename matches the pipeline name.
 *
 * @param nameOrId - Pipeline name or numeric ID string.
 * @returns Result containing YAML source string.
 */
export async function pipeline_sourceGet(
  nameOrId: string
): Promise<Result<string>> {
  const pipelineResult: Result<PipelineRecord> = await pipeline_resolve(nameOrId);
  if (!pipelineResult.ok) return Err();

  const pipeline: PipelineRecord = pipelineResult.value;

  const client = await chrisConnection.client_get();
  if (!client) {
    errorStack.stack_push('error', 'Not connected to ChRIS');
    return Err();
  }

  try {
    const sourceFiles = await (client as unknown as {
      getPipelineSourceFiles: (opts: Record<string, unknown>) => Promise<{
        getItems: () => Array<{ data: { fname: string } }>;
      }>;
    }).getPipelineSourceFiles({ pipeline_id: pipeline.id, limit: 1 });

    const items = sourceFiles.getItems();

    if (items.length === 0) {
      errorStack.stack_push(
        'error',
        `No source file registered for pipeline '${pipeline.name}' (id=${pipeline.id})`
      );
      return Err();
    }

    return pipelineFile_getTextByPath('/' + items[0].data.fname);
  } catch (error: unknown) {
    const msg: string = error instanceof Error ? error.message : String(error);
    errorStack.stack_push('error', `pipeline_sourceGet: ${msg}`);
    return Err();
  }
}

/**
 * Gets raw content from a pipeline source URL (legacy helper).
 *
 * @param url - Direct URL to the pipeline source file.
 */
export async function pipeline_getContent(url: string): Promise<Result<string>> {
  const token: string | null = await chrisConnection.authToken_get();
  if (!token) {
    errorStack.stack_push('error', 'Not connected to ChRIS');
    return Err();
  }

  try {
    const response = await axios.get(url, {
      headers: { Authorization: `Token ${token}` },
    });
    return Ok(response.data);
  } catch (error: unknown) {
    const msg: string = error instanceof Error ? error.message : String(error);
    errorStack.stack_push('error', `pipeline_getContent: ${msg}`);
    return Err();
  }
}
