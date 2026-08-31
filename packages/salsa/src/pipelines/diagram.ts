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
  pipeline_get,
  pipeline_resolve,
  listPages_drain,
  type PipelineHandle,
  type PluginPipingItem,
  type PipingDefaultParameterData,
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

/**
 * Narrows a wire default-parameter row to the diagram's required shape.
 *
 * @param row - Stored default row from the contract.
 * @returns The narrowed row, or null when required fields are absent.
 */
function defaultParameter_narrow(row: PipingDefaultParameterData): DefaultParameterData | null {
  if (typeof row.plugin_piping_id !== 'number' || typeof row.param_name !== 'string') return null;
  return { plugin_piping_id: row.plugin_piping_id, param_name: row.param_name, value: row.value };
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
 * Built diagrams by pipeline id, per client. A registered pipeline's
 * topology is immutable, so an entry never expires: the first build is the
 * only CUBE traffic a pipeline's diagram ever costs a session.
 */
const diagramCaches: WeakMap<object, Map<number, PipelineDiagram>> = new WeakMap();

/**
 * Fetches a registered pipeline as a diagram-ready flat DAG.
 *
 * @param specifier - Pipeline numeric ID, exact name, slug, or unambiguous search.
 * @returns The pipeline DAG, or Err when resolution or retrieval fails.
 */
export async function pipelineDiagram_get(specifier: string): Promise<Result<PipelineDiagram>> {
  const resolved: Result<PipelineRecord> = await pipeline_resolve(specifier);
  if (!resolved.ok) return Err();

  const client = await chrisConnection.client_get();
  if (!client) {
    errorStack.stack_push('error', 'Not connected to ChRIS. Cannot draw pipeline.');
    return Err();
  }

  let diagramCache: Map<number, PipelineDiagram> | undefined = diagramCaches.get(client as object);
  if (diagramCache === undefined) {
    diagramCache = new Map();
    diagramCaches.set(client as object, diagramCache);
  }
  const cached: PipelineDiagram | undefined = diagramCache.get(resolved.value.id);
  if (cached !== undefined) return Ok(cached);

  try {
    const pipeline: PipelineHandle | null = await pipeline_get(client, resolved.value.id);
    if (!pipeline) {
      errorStack.stack_push('error', `Pipeline ${resolved.value.id} not found.`);
      return Err();
    }

    const [pipingItems, defaultRows] = await Promise.all([
      listPages_drain((offset: number, limit: number) => pipeline.pluginPipingsPage_get({ limit, offset })),
      listPages_drain((offset: number, limit: number) => pipeline.defaultParametersPage_get({ limit, offset })),
    ]);
    const pipings: PipingData[] = pipingItems.map((item: PluginPipingItem): PipingData => item.data);
    const defaults: DefaultParameterData[] = defaultRows
      .map((row: PipingDefaultParameterData): DefaultParameterData | null => defaultParameter_narrow(row))
      .filter((row: DefaultParameterData | null): row is DefaultParameterData => row !== null);
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

    const diagram: PipelineDiagram = {
      pipelineID: resolved.value.id,
      name: resolved.value.name,
      rootIDs: nodes.filter((node: PipelineDiagramNode): boolean => node.parentID === null)
        .map((node: PipelineDiagramNode): number => node.id),
      nodes,
    };
    diagramCache.set(resolved.value.id, diagram);
    return Ok(diagram);
  } catch (error: unknown) {
    const msg: string = error instanceof Error ? error.message : String(error);
    errorStack.stack_push('error', `pipelineDiagram_get: ${msg}`);
    return Err();
  }
}
