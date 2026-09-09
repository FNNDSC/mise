/**
 * @file Cache-first data preparation for a feed's DAG.
 *
 * Prepares ProcCache for {@link module:dag/feedGraph.feedGraph_build} by REUSING the warm
 * cache and only fetching what's missing — never a blind re-crawl:
 *
 * - topology: a cold feed's walk is STARTED via {@link feedInstances_ensureStarted} and the
 *   caller is told `pending`; index movement never holds the session's lane;
 * - feed metadata (counters → aggregate status): fetched only if missing/placeholder;
 * - freshness: a warm reuse runs the visit delta ({@link feedVisit_sync}) — feed counters,
 *   then only the nodes created, finished, or still running since the last visit; a cold
 *   load already carried fresh status and topology;
 * - join edges: resolved lazily for the feed's `ts` nodes.
 *
 * @module
 */
import { procCache_get, ProcCache } from '@fnndsc/cumin';
import { feedInstances_ensureStarted, feedMeta_ensure, feedVisit_sync, type FeedTopologyReadiness } from '../vfs/providers/proc.js';
import { feedJoins_ensure } from './feedJoins.js';

/**
 * Ensures a feed's topology, metadata, current status, and join edges are in ProcCache,
 * reusing anything already warm.
 *
 * @param feedID - Feed to prepare.
 */
export async function feedGraphData_ensure(feedID: number): Promise<FeedTopologyReadiness> {
  const cache: ProcCache = procCache_get();
  const wasWarm: boolean = cache.topologyLoaded_has(feedID);

  // A cold feed's walk is started and left to run: the caller answers
  // `pending` now, and the graph follows when the walk lands.
  if (feedInstances_ensureStarted(feedID) === 'pending') return 'pending';
  await feedMeta_ensure(feedID);
  // A cold load just fetched fresh status with the topology. A warm reuse
  // pays only for what moved; a settled feed renders from cache alone for
  // the length of its re-check window.
  if (wasWarm) await feedVisit_sync(feedID);
  await feedJoins_ensure(feedID);
  return 'ready';
}
