/**
 * @file Lazy resolution of topological-join (`ts`) edges for a feed.
 *
 * A `ts` node's extra parents are NOT on the instance object — they live in its
 * `plugininstances` string parameter (a comma-separated list of source instance IDs,
 * which includes the anchor parent). This module fetches that parameter sub-resource for
 * a feed's join nodes and records the OVERLAY (sources minus the anchor) into ProcCache.
 *
 * Network-bound and lazy: called on demand (e.g. when building a FeedGraph for display),
 * scoped to one feed, and only for nodes not yet resolved. Kept separate from the pure
 * {@link module:dag/feedGraph} projection.
 *
 * @module
 */
import { chrisConnection, procCache_get, ProcCache, ProcInstance } from '@fnndsc/cumin';

/** One parameter row from a plugin instance's parameter sub-resource. */
interface ParamItem {
  param_name?: string;
  value?: unknown;
}

interface ParamList {
  data?: ParamItem[];
  getItems?: () => Array<{ data: ParamItem }>;
}

interface InstanceResource {
  getParameters(params?: { limit?: number; offset?: number }): Promise<ParamList>;
}

interface JoinClient {
  getPluginInstance(id: number): Promise<InstanceResource | null>;
}

/** Matches the canonical topological-copy plugin when `pluginType` is unavailable. */
const TS_NAME_PATTERN: RegExp = /topologicalcopy/i;

/** Whether an instance is a topological-join node (authoritative by type, name fallback). */
function node_isJoin(inst: ProcInstance): boolean {
  if (inst.pluginType) return inst.pluginType === 'ts';
  return TS_NAME_PATTERN.test(inst.pluginName);
}

/** Parses a `plugininstances` param value ("12,34,56") into numeric IDs. */
function joinIDs_parse(value: unknown): number[] {
  return String(value ?? '')
    .split(',')
    .map((s: string): number => parseInt(s.trim(), 10))
    .filter((n: number): boolean => !Number.isNaN(n));
}

/**
 * Resolves and caches the join overlay for a single `ts` instance. No-op for non-join
 * nodes, already-resolved nodes, or when disconnected.
 *
 * @param id - Instance ID of a candidate join node.
 */
export async function nodeJoins_resolve(id: number): Promise<void> {
  const cache: ProcCache = procCache_get();
  const inst: ProcInstance | undefined = cache.instance_get(id);
  if (!inst || !node_isJoin(inst) || inst.joinParentIDs !== undefined) return;

  const client = await chrisConnection.client_get();
  if (!client) return;

  const typedClient: JoinClient = client as unknown as JoinClient;
  const resource: InstanceResource | null = await typedClient.getPluginInstance(id);
  if (!resource) {
    cache.joinParents_update(id, []);
    return;
  }

  const list: ParamList = await resource.getParameters({ limit: 100 });
  const items: ParamItem[] = list.data ?? (list.getItems ? list.getItems().map((i) => i.data) : []);
  const param: ParamItem | undefined = items.find((p: ParamItem): boolean => p.param_name === 'plugininstances');

  // Overlay = the join's sources minus its anchor parent (which is also in the list).
  const sources: number[] = param ? joinIDs_parse(param.value) : [];
  const overlay: number[] = sources.filter((n: number): boolean => n !== inst.parentID);
  cache.joinParents_update(id, overlay);
}

/**
 * Ensures every `ts` node in a feed has its join overlay resolved. Idempotent — already
 * resolved nodes are skipped, so re-calling is cheap.
 *
 * @param feedID - Feed whose join edges to resolve.
 */
export async function feedJoins_ensure(feedID: number): Promise<void> {
  const cache: ProcCache = procCache_get();
  for (const id of cache.feedInstanceIDs_get(feedID)) {
    const inst: ProcInstance | undefined = cache.instance_get(id);
    if (inst && node_isJoin(inst) && inst.joinParentIDs === undefined) {
      await nodeJoins_resolve(id);
    }
  }
}
