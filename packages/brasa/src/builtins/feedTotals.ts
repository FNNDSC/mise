/**
 * @file A feed's totals, derived from resident nodes: the roster's SIZE and
 * TIME. Pure over the cache, no wire, no imports beyond types — so a test
 * can load it without the proc builtin's whole graph.
 *
 * @module
 */
import type { ProcCache, ProcInstance } from '@fnndsc/cumin';

/** A feed's totals as the roster reports them. */
export interface FeedTotals {
  sizeBytes?: number;
  wallSeconds?: number;
}

/**
 * Derives a feed's totals from its resident nodes — no wire: the sum of
 * output bytes, and the wall span from the first start to the last end
 * (to now while a node still runs). A feed whose topology is not resident
 * has no totals, and says so by their absence — never a zero.
 *
 * @param cache - The process cache.
 * @param feedID - The feed.
 * @returns The totals that could be derived.
 */
export function feedTotals_derive(
  cache: Pick<ProcCache, 'topologyLoaded_has' | 'feedInstanceIDs_get' | 'instance_get'>,
  feedID: number,
): FeedTotals {
  if (!cache.topologyLoaded_has(feedID)) return {};
  let bytes: number = 0;
  let hasBytes: boolean = false;
  let start: string | undefined;
  let end: string | undefined;
  let allEnded: boolean = true;
  for (const id of cache.feedInstanceIDs_get(feedID)) {
    const inst: ProcInstance | undefined = cache.instance_get(id);
    if (!inst) continue;
    if (inst.outputBytes !== undefined) { bytes += inst.outputBytes; hasBytes = true; }
    if (inst.startedAt && (start === undefined || inst.startedAt < start)) start = inst.startedAt;
    if (inst.finishedAt) {
      if (end === undefined || inst.finishedAt > end) end = inst.finishedAt;
    } else if (inst.startedAt) {
      allEnded = false;
    }
  }
  const totals: FeedTotals = {};
  if (hasBytes) totals.sizeBytes = bytes;
  if (start !== undefined) {
    const until: number = allEnded && end !== undefined ? Date.parse(end) : Date.now();
    totals.wallSeconds = Math.max(0, Math.round((until - Date.parse(start)) / 1000));
  }
  return totals;
}
