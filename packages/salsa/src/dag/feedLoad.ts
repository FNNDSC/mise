/**
 * @file Cache-first data preparation for a feed's DAG.
 *
 * Prepares ProcCache for {@link module:dag/feedGraph.feedGraph_build} by REUSING the warm
 * cache and only fetching what's missing — never a blind re-crawl:
 *
 * - topology: loaded once via {@link feedInstances_ensureLoaded} (no-op if already warm);
 * - feed metadata (counters → aggregate status): fetched only if missing/placeholder;
 * - volatile status: refreshed cheaply (one feed-scoped list call) only when the topology
 *   was already warm — a cold load already carried fresh status;
 * - join edges: resolved lazily for the feed's `ts` nodes.
 *
 * @module
 */
import { procCache_get, ProcCache, status_isTerminal, type ProcInstance } from '@fnndsc/cumin';
import { feedInstances_ensureLoaded, feedMeta_ensure, feedStatus_refresh } from '../vfs/providers/proc.js';
import { feedJoins_ensure } from './feedJoins.js';

/**
 * Whether every cached instance of a feed carries a terminal status. A feed
 * that has fully settled can never change again, so a status refresh for it
 * is pure waste — and for a feed of thousands of nodes, that waste is
 * dozens of list calls on every diagram render.
 *
 * @param cache - The process cache.
 * @param feedID - The feed to inspect.
 * @returns True when no instance could still change status.
 */
function feed_isSettled(cache: ProcCache, feedID: number): boolean {
  for (const id of cache.feedInstanceIDs_get(feedID)) {
    const inst: ProcInstance | undefined = cache.instance_get(id);
    if (inst === undefined || !status_isTerminal(inst.status)) return false;
  }
  return true;
}

/**
 * Ensures a feed's topology, metadata, current status, and join edges are in ProcCache,
 * reusing anything already warm.
 *
 * @param feedID - Feed to prepare.
 */
export async function feedGraphData_ensure(feedID: number): Promise<void> {
  const cache: ProcCache = procCache_get();
  const wasWarm: boolean = cache.topologyLoaded_has(feedID);

  await feedInstances_ensureLoaded(feedID);
  await feedMeta_ensure(feedID);
  // A cold load just fetched fresh status with the topology. A warm reuse
  // refreshes status only while something can still change: a fully settled
  // feed renders from cache alone, with zero CUBE traffic.
  if (wasWarm && !feed_isSettled(cache, feedID)) await feedStatus_refresh(feedID);
  await feedJoins_ensure(feedID);
}
