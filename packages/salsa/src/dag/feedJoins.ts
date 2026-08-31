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
import {
  chrisConnection,
  procCache_get,
  errorStack,
  ProcCache,
  ProcInstance,
  pluginInstance_get,
  type PluginInstanceHandle,
  type ListPage,
  type InstanceParameterData,
} from '@fnndsc/cumin';

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

  const handle: PluginInstanceHandle | null = await pluginInstance_get(client, id);
  if (!handle) {
    // A failed fetch must not be recorded as "no joins": writing an empty
    // overlay here would be permanent, since resolved nodes are never
    // retried. Leave the node unresolved so the next resolve attempts again.
    errorStack.stack_push("warning", `Could not fetch instance ${id} to resolve join edges; will retry on next resolve.`);
    return;
  }

  const page: ListPage<InstanceParameterData> = await handle.parametersPage_get({ limit: 100, offset: 0 });
  const param: InstanceParameterData | undefined = page.data.find(
    (p: InstanceParameterData): boolean => p.param_name === 'plugininstances',
  );

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

/**
 * Resolves every unresolved `ts` join in the whole cache — the warm-up tail.
 *
 * Runs quietly after the topology sweep settles, so the first diagram of any
 * feed finds its joins already cached; the checkpoint writer then persists
 * them, making the resolution once-ever per node. Sequential awaits are the
 * throttle. Failures leave nodes unresolved for the lazy path to retry.
 */
export async function procJoins_sweep(): Promise<void> {
  const cache: ProcCache = procCache_get();
  for (const feedID of cache.feedIDs_get()) {
    await feedJoins_ensure(feedID);
  }
}
