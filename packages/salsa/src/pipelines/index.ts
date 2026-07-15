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
import axios from 'axios';

export type { PipelineRecord, WorkflowResult };

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
  const client = await chrisConnection.client_get();
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

  const idToSlug: Map<number, string> = new Map<number, string>();
  if (sourceFilesResponse) {
    for (const item of sourceFilesResponse.getItems()) {
      const { fname, pipeline_id } = item.data;
      if (pipeline_id && fname) {
        const base: string = fname.split('/').pop() ?? '';
        const slug: string = base.replace(/\.(ya?ml)$/i, '');
        idToSlug.set(pipeline_id, slug);
      }
    }
  }

  const records = pipelinesResult.value.map((pipeline: PipelineRecord) => {
    const sourceSlug: string | undefined = idToSlug.get(pipeline.id);
    const generatedSlug: string = pipeline.name
      .replace(/[^a-zA-Z0-9]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '');
    const base: string = sourceSlug ?? generatedSlug;
    return {
      ...pipeline,
      slug: `${base}_id${pipeline.id}`,
    };
  });

  return Ok(records);
}

/**
 * Runs a pipeline by name or ID, attaching it to a previous plugin instance.
 *
 * @param nameOrId - Pipeline name or numeric ID string.
 * @param previousPluginInstId - The plugin instance to attach the pipeline root to.
 * @param computeOverride - Optional compute resource name applied to all nodes.
 * @returns Result containing workflow ID and created plugin instance IDs.
 */
export async function pipeline_run(
  nameOrId: string,
  previousPluginInstId: number,
  computeOverride?: string
): Promise<Result<WorkflowResult>> {
  const pipelineResult: Result<PipelineRecord> = await pipeline_resolve(nameOrId);
  if (!pipelineResult.ok) return Err();

  const pipeline: PipelineRecord = pipelineResult.value;

  const options: WorkflowCreateOptions = { previousPluginInstId };

  if (computeOverride) {
    const client = await chrisConnection.client_get();
    if (!client) {
      errorStack.stack_push('error', 'Not connected to ChRIS');
      return Err();
    }

    try {
      const pipelineObj = await (client as unknown as {
        getPipeline: (id: number) => Promise<{
          getPluginPipings: (opts: Record<string, unknown>) => Promise<{
            getItems: () => Array<{ data: { id: number } }>;
          }>;
        }>;
      }).getPipeline(pipeline.id);

      if (pipelineObj) {
        const pipingsResponse = await pipelineObj.getPluginPipings({ limit: 1000 });
        const pipings = pipingsResponse.getItems();
        options.nodeOverrides = pipings.map((p) => ({
          piping_id: p.data.id,
          compute_resource_name: computeOverride,
        }));
      }
    } catch (error: unknown) {
      const msg: string = error instanceof Error ? error.message : String(error);
      errorStack.stack_push('error', `pipeline_run: compute override failed: ${msg}`);
      return Err();
    }
  }

  return pipeline_createWorkflow(pipeline.id, options);
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
