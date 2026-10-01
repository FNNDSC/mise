/**
 * @file ChRIS Pipeline and Workflow operations.
 *
 * Provides functions to list registered pipelines, resolve them by name or ID,
 * and create workflow instances (the runtime execution of a pipeline on a feed node).
 *
 * Terminology:
 *   Pipeline  — the registered DAG template in CUBE
 *   Workflow  — a pipeline instantiated on a specific plugin instance node
 *
 * @module
 */

import { chrisConnection } from "../connect/chrisConnection.js";
import { itemData_get, items_get, listData_get, resource_call, type Client } from "../chrisapi/adapter.js";
import { pipelineRecord_keep, pipelineRecord_recall, pipelineResource_keep } from "./pipelineMemo.js";
import { listPages_drain, type ListPage } from "../chrisapi/contract.js";
import { ChRISResourceGroup } from "../resources/chrisResourceGroup.js";
import { errorStack } from "../error/errorStack.js";
import { Result, Ok, Err } from "../utils/result.js";

/** Optional name filter for pipeline list queries. */
interface PipelineSearchParams {
  name?: string;
  [key: string]: unknown;
}

/** Slice of a pipeline source file item as returned by the API. */
interface PipelineSourceFileItem {
  data: { fname: string; pipeline_name?: string };
}

/** Slice of a list resource that only exposes its items. */
interface ItemListSlice {
  getItems: () => unknown[];
  hasNextPage?: boolean;
}

/** Record slice carrying just a numeric id. */
interface IdRecord {
  id: number;
}

/** How many pipelines a name search reads: exact names seldom collide. */
const PIPELINE_SEARCH_LIMIT: number = 100;


/**
 * Group handler for ChRIS pipelines.
 */
export class ChRISPipelineGroup extends ChRISResourceGroup {
  constructor() {
    super('Pipelines', 'getPipelines');
  }
}

/**
 * Minimal shape of a pipeline record as returned by the ChRIS API.
 */
export interface PipelineRecord {
  id: number;
  name: string;
  description?: string;
  authors?: string;
  category?: string;
  locked?: boolean;
  /** Filesystem-safe slug derived from the pipeline source filename (e.g. "Varus_valgus_full_4crg2N7"). */
  slug?: string;
  [key: string]: unknown;
}

/**
 * Per-node override for a workflow execution.
 * All fields are optional — omitted fields use the pipeline's defaults.
 */
export interface WorkflowNodeOverride {
  piping_id: number;
  compute_resource_name?: string;
  title?: string;
  cpu_limit?: unknown;
  memory_limit?: unknown;
  gpu_limit?: unknown;
  number_of_workers?: unknown;
  plugin_parameter_defaults?: Array<{ name: string; default: unknown }>;
}

/**
 * Options for creating a workflow.
 */
export interface WorkflowCreateOptions {
  /** Numeric ID of the previous plugin instance to attach the workflow root to. */
  previousPluginInstId: number;
  /** Per-node overrides. If omitted, all nodes run with pipeline defaults. */
  nodeOverrides?: WorkflowNodeOverride[];
}

/**
 * Result of a successful workflow creation.
 */
export interface WorkflowResult {
  workflowId: number;
  /** Plugin instance IDs created by this workflow, in DAG order. */
  pluginInstanceIds: number[];
}

/**
 * Lists all registered pipelines, optionally filtered by name substring.
 *
 * @param search - Optional name substring filter.
 * @returns Result containing array of PipelineRecord on success.
 */
export async function pipelines_list(
  search?: string
): Promise<Result<PipelineRecord[]>> {
  try {
    const group: ChRISPipelineGroup = new ChRISPipelineGroup();
    const params: PipelineSearchParams = search ? { name: search } : {};
    const result = await group.asset.resources_getAll(params);
    if (!result || !result.tableData) return Ok([]);
    return Ok(listData_get<PipelineRecord>({ data: result.tableData }));
  } catch (error: unknown) {
    const msg: string = error instanceof Error ? error.message : String(error);
    errorStack.stack_push('error', `pipelines_list: ${msg}`);
    return Err();
  }
}

/**
 * Resolves a pipeline by name (exact match first, then substring) or numeric ID string.
 *
 * One resolution per specifier per session: the answer is kept on the
 * connection's client (see pipelineMemo), so a diagram asked again — the
 * browser asks one per pipeline card on every visit to /bin — costs no
 * search. A miss is never kept.
 *
 * @param nameOrId - Pipeline name or numeric ID.
 * @returns Result containing the matched PipelineRecord.
 */
export async function pipeline_resolve(
  nameOrId: string
): Promise<Result<PipelineRecord>> {
  const client = await chrisConnection.client_get();
  if (!client) {
    errorStack.stack_push('error', 'Not connected to ChRIS');
    return Err();
  }
  const kept: PipelineRecord | null = pipelineRecord_recall(client, nameOrId);
  if (kept !== null) return Ok(kept);
  const resolved: Result<PipelineRecord> = await pipelineResolve_fetch(client, nameOrId);
  if (resolved.ok) pipelineRecord_keep(client, nameOrId, resolved.value);
  return resolved;
}

/**
 * Keeps the chrisapi items a pipeline listing served, by id, so the
 * pipings can be read off them without listing the pipeline again.
 *
 * @param client - The connection's client.
 * @param page - The list response.
 */
function pipelineItems_keep(client: Client, page: unknown): void {
  const items: Array<{ data?: unknown }> = items_get<{ data?: unknown }>(page as { getItems(): unknown });
  for (const item of items) {
    const data: IdRecord | null = itemData_get<IdRecord>(item);
    if (data && typeof data.id === 'number') pipelineResource_keep(client, data.id, item);
  }
}

/**
 * Resolves a pipeline against CUBE: the wire half of pipeline_resolve.
 *
 * @param client - The connection's client.
 * @param nameOrId - Pipeline name or numeric ID.
 * @returns Result containing the matched PipelineRecord.
 */
async function pipelineResolve_fetch(
  client: Client,
  nameOrId: string
): Promise<Result<PipelineRecord>> {
  const isNumericID: boolean = /^\d+$/.test(nameOrId);
  if (isNumericID) {
    const numericId: number = parseInt(nameOrId, 10);
    try {
      const pipeline = await client.getPipeline(numericId);
      const data: PipelineRecord | null = itemData_get<PipelineRecord>(pipeline);
      if (!data) {
        errorStack.stack_push('error', `Pipeline with ID ${numericId} not found`);
        return Err();
      }
      pipelineResource_keep(client, data.id, pipeline as object);
      return Ok(data);
    } catch (error: unknown) {
      const msg: string = error instanceof Error ? error.message : String(error);
      errorStack.stack_push('error', `pipeline_resolve: ${msg}`);
      return Err();
    }
  }

  // A /bin slug names its pipeline's id (`<base>_id<N>`, minted by the
  // listing from the record), so the id is the identity: one list by id
  // answers, where a name search for the slug is a certain miss and the
  // id only its fallback — two requests. A pipeline CUBE itself named
  // `..._idN` is listed in /bin under its own id, so a bare slug never
  // means it.
  const slugID: RegExpMatchArray | null = nameOrId.match(/_id(\d+)$/);
  if (slugID) {
    try {
      const pipeline = await client.getPipeline(parseInt(slugID[1], 10));
      const data: PipelineRecord | null = itemData_get<PipelineRecord>(pipeline);
      if (data) {
        pipelineResource_keep(client, data.id, pipeline as object);
        return Ok(data);
      }
    } catch (_e: unknown) {}
  }

  // The search is read as a page, not through pipelines_list, so the items
  // it served can be kept: a pipeline's pipings hang off its item.
  let page: unknown;
  try {
    page = await resource_call<unknown>(client, 'getPipelines', { name: nameOrId, limit: PIPELINE_SEARCH_LIMIT });
  } catch (error: unknown) {
    const msg: string = error instanceof Error ? error.message : String(error);
    errorStack.stack_push('error', `pipelines_list: ${msg}`);
    return Err();
  }
  pipelineItems_keep(client, page);
  const found: PipelineRecord[] = listData_get<PipelineRecord>(page as { data?: unknown });
  const exact: PipelineRecord | undefined = found.find(
    (p: PipelineRecord) => p.name === nameOrId
  );
  if (exact) return Ok(exact);
  if (found.length === 1) return Ok(found[0]);
  if (found.length === 0) {
    const fallbackClient: Client = client;
    // ID-suffix fallback: slug of form "{name}_id{N}" generated for pipelines without source files
    const idSuffixMatch: RegExpMatchArray | null = nameOrId.match(/_id(\d+)$/);
    if (idSuffixMatch) {
      const directId: number = parseInt(idSuffixMatch[1], 10);
      try {
        const pipeline = await fallbackClient.getPipeline(directId);
        const directData: PipelineRecord | null = itemData_get<PipelineRecord>(pipeline);
        if (directData) {
          pipelineResource_keep(client, directData.id, pipeline as object);
          return Ok(directData);
        }
      } catch (_e: unknown) {}
    }

    // Slug fallback: treat nameOrId as a source file fname fragment
    try {
      const sfList: ItemListSlice = await resource_call<ItemListSlice>(
        fallbackClient, 'getPipelineSourceFiles', { fname: nameOrId, limit: 1 }
      );
      const sfItems: PipelineSourceFileItem[] = items_get<PipelineSourceFileItem>(sfList).filter(
        (item: PipelineSourceFileItem) => {
          const base: string = item.data.fname.split('/').pop() ?? '';
          return base.replace(/\.(ya?ml)$/i, '') === nameOrId;
        }
      );
      if (sfItems.length > 0 && sfItems[0].data.pipeline_name) {
        const byName: Result<PipelineRecord[]> = await pipelines_list(sfItems[0].data.pipeline_name);
        if (byName.ok) {
          const exactByName: PipelineRecord | undefined = byName.value.find(
            (p: PipelineRecord) => p.name === sfItems[0].data.pipeline_name
          );
          if (exactByName) return Ok(exactByName);
        }
      }
    } catch (_e: unknown) {}
    
    errorStack.stack_push('error', `No pipeline matching '${nameOrId}'`);
    return Err();
  }

  errorStack.stack_push(
    'error',
    `Ambiguous: ${found.length} pipelines match '${nameOrId}'. Use ID or full name.`
  );
  return Err();
}

/**
 * Creates a workflow — instantiates a pipeline on a specific plugin instance node.
 *
 * @param pipelineId - Numeric ID of the registered pipeline.
 * @param options - Execution options including the previous node and optional overrides.
 * @returns Result containing workflow ID and created plugin instance IDs.
 */
export async function pipeline_createWorkflow(
  pipelineId: number,
  options: WorkflowCreateOptions
): Promise<Result<WorkflowResult>> {
  const client = await chrisConnection.client_get();
  if (!client) {
    errorStack.stack_push('error', 'Not connected to ChRIS');
    return Err();
  }

  try {
    let nodes_info: WorkflowNodeOverride[];

    if (options.nodeOverrides && options.nodeOverrides.length > 0) {
      nodes_info = options.nodeOverrides;
    } else {
      const pipeline = await client.getPipeline(pipelineId);
      if (!pipeline) {
        errorStack.stack_push('error', `Pipeline ${pipelineId} not found`);
        return Err();
      }

      const pipings: Array<{ data: IdRecord }> = await listPages_drain(
        async (offset: number, limit: number): Promise<ListPage<{ data: IdRecord }>> => {
          const response: ItemListSlice = await resource_call<ItemListSlice>(
            pipeline, 'getPluginPipings', { limit, offset }
          );
          return { data: items_get<{ data: IdRecord }>(response), totalCount: null, hasMore: response.hasNextPage };
        },
      );
      nodes_info = pipings.map((p: { data: IdRecord }) => ({ piping_id: p.data.id }));
    }

    const workflow: object | null = await resource_call<object | null>(client, 'createWorkflow', pipelineId, {
      previous_plugin_inst_id: options.previousPluginInstId,
      nodes_info: JSON.stringify(nodes_info),
    });

    if (!workflow) {
      errorStack.stack_push('error', 'createWorkflow returned empty response');
      return Err();
    }

    const workflowRecord: IdRecord | null = itemData_get<IdRecord>(workflow);
    if (!workflowRecord) {
      errorStack.stack_push('error', 'createWorkflow response carried no data');
      return Err();
    }
    const workflowId: number = workflowRecord.id;

    const instances: Array<{ data: IdRecord }> = await listPages_drain(
      async (offset: number, limit: number): Promise<ListPage<{ data: IdRecord }>> => {
        const response: ItemListSlice = await resource_call<ItemListSlice>(
          workflow, 'getPluginInstances', { limit, offset }
        );
        return { data: items_get<{ data: IdRecord }>(response), totalCount: null, hasMore: response.hasNextPage };
      },
    );
    const pluginInstanceIds: number[] = instances.map(
      (inst: { data: IdRecord }) => inst.data.id
    );

    return Ok({ workflowId, pluginInstanceIds });
  } catch (error: unknown) {
    const msg: string = error instanceof Error ? error.message : String(error);
    errorStack.stack_push('error', `pipeline_createWorkflow: ${msg}`);
    return Err();
  }
}
