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
import { procCache_get, ProcCache } from '@fnndsc/cumin';
import { feedInstances_ensureLoaded, feedMeta_ensure, feedStatus_refresh } from '../vfs/providers/proc.js';
import { feedJoins_ensure } from './feedJoins.js';

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
  // A cold load just fetched fresh status with the topology; only a warm reuse needs a
  // cheap status refresh (active nodes only — terminal status is frozen).
  if (wasWarm) await feedStatus_refresh(feedID);
  await feedJoins_ensure(feedID);
}
