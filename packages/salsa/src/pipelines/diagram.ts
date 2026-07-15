/**
 * @file Read-only projection of a registered CUBE pipeline for diagram rendering.
 *
 * Resolves a pipeline, fetches its pipings and stored default parameters, and
 * returns a flat DAG. Topological `plugininstances` defaults contain piping IDs;
 * the anchor parent is removed so `joinParentIDs` carries only additional edges.
 *
 * @module
 */
import {
  Err,
  Ok,
  Result,
  chrisConnection,
  errorStack,
  items_get,
  listData_get,
  pipeline_resolve,
  type PipelineRecord,
} from '@fnndsc/cumin';

/** One stored plugin argument default. */
export interface PipelineDiagramArgument {
  name: string;
  value: unknown;
}

/** One authored piping in a registered pipeline DAG. */
export interface PipelineDiagramNode {
  id: number;
  title: string;
  pluginName: string;
  parentID: number | null;
  joinParentIDs: number[];
  arguments: PipelineDiagramArgument[];
}

/** A registered pipeline projected as a flat, surface-agnostic DAG. */
export interface PipelineDiagram {
  pipelineID: number;
  name: string;
  rootIDs: number[];
  nodes: PipelineDiagramNode[];
}

/** CUBE plugin-piping payload used by the projection. */
interface PipingData {
  id: number;
  title?: string;
  plugin_name?: string;
  previous_id?: number | null;
}

/** CUBE default-parameter payload used by the projection. */
interface DefaultParameterData {
  plugin_piping_id: number;
  param_name: string;
  value: unknown;
}

/** Item wrapper returned by chrisapi piping lists. */
interface PipingItem {
  data: PipingData;
}

/** Piping collection returned by one pipeline resource. */
interface PipingListSlice {
  getItems: () => unknown[];
}

/** Default-parameter collection returned by one pipeline resource. */
interface DefaultParameterListSlice {
  data?: unknown;
}

/** Pipeline resource methods missing from the published chrisapi typings. */
interface PipelineResourceSlice {
  getPluginPipings: (options: Record<string, unknown>) => Promise<PipingListSlice>;
  getDefaultParameters: (options: Record<string, unknown>) => Promise<DefaultParameterListSlice>;
}

/** Client operation used to retrieve a registered pipeline resource. */
interface PipelineClientSlice {
  getPipeline: (id: number) => Promise<PipelineResourceSlice | null>;
}

/**
 * Parses the additional parents stored in a `plugininstances` default.
 *
 * @param value - Comma-separated piping IDs from CUBE.
 * @param anchorID - The piping's ordinary `previous_id` parent.
 * @returns Additional parent IDs with the anchor removed.
 */
function joinParentIDs_parse(value: unknown, anchorID: number | null): number[] {
  if (typeof value !== 'string') return [];
  return value
    .split(',')
    .map((token: string): number => parseInt(token.trim(), 10))
    .filter((id: number): boolean => !isNaN(id) && id !== anchorID);
}

/**
 * Fetches a registered pipeline as a diagram-ready flat DAG.
 *
 * @param specifier - Pipeline numeric ID, exact name, slug, or unambiguous search.
 * @returns The pipeline DAG, or Err when resolution or retrieval fails.
 */
export async function pipelineDiagram_get(specifier: string): Promise<Result<PipelineDiagram>> {
  const resolved: Result<PipelineRecord> = await pipeline_resolve(specifier);
  if (!resolved.ok) return Err();

  const client: PipelineClientSlice | null = await chrisConnection.client_get() as unknown as PipelineClientSlice | null;
  if (!client) {
    errorStack.stack_push('error', 'Not connected to ChRIS. Cannot draw pipeline.');
    return Err();
  }

  try {
    const pipeline: PipelineResourceSlice | null = await client.getPipeline(resolved.value.id);
    if (!pipeline) {
      errorStack.stack_push('error', `Pipeline ${resolved.value.id} not found.`);
      return Err();
    }

    const collections: [PipingListSlice, DefaultParameterListSlice] = await Promise.all([
      pipeline.getPluginPipings({ limit: 1000 }),
      pipeline.getDefaultParameters({ limit: 1000 }),
    ]);
    const pipingList: PipingListSlice = collections[0];
    const defaultList: DefaultParameterListSlice = collections[1];
    const pipings: PipingData[] = items_get<PipingItem>(pipingList)
      .map((item: PipingItem): PipingData => item.data);
    const defaults: DefaultParameterData[] = listData_get<DefaultParameterData>(defaultList);
    const defaultsByPiping: Map<number, PipelineDiagramArgument[]> = new Map<number, PipelineDiagramArgument[]>();
    const joinsByPiping: Map<number, unknown> = new Map<number, unknown>();

    for (const parameter of defaults) {
      const argumentsForPiping: PipelineDiagramArgument[] = defaultsByPiping.get(parameter.plugin_piping_id) ?? [];
      argumentsForPiping.push({ name: parameter.param_name, value: parameter.value });
      defaultsByPiping.set(parameter.plugin_piping_id, argumentsForPiping);
      if (parameter.param_name === 'plugininstances') {
        joinsByPiping.set(parameter.plugin_piping_id, parameter.value);
      }
    }

    const nodes: PipelineDiagramNode[] = pipings.map((piping: PipingData): PipelineDiagramNode => {
      const parentID: number | null = piping.previous_id ?? null;
      return {
        id: piping.id,
        title: piping.title ?? `piping_${piping.id}`,
        pluginName: piping.plugin_name ?? '?',
        parentID,
        joinParentIDs: joinParentIDs_parse(joinsByPiping.get(piping.id), parentID),
        arguments: defaultsByPiping.get(piping.id) ?? [],
      };
    });

    return Ok({
      pipelineID: resolved.value.id,
      name: resolved.value.name,
      rootIDs: nodes.filter((node: PipelineDiagramNode): boolean => node.parentID === null)
        .map((node: PipelineDiagramNode): number => node.id),
      nodes,
    });
  } catch (error: unknown) {
    const msg: string = error instanceof Error ? error.message : String(error);
    errorStack.stack_push('error', `pipelineDiagram_get: ${msg}`);
    return Err();
  }
}
