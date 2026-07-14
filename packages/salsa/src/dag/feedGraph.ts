/**
 * @file FeedGraph — a flat, surface-agnostic projection of a feed's plugin-instance DAG.
 *
 * Built entirely from the in-memory {@link ProcCache} (no network). The model carries
 * MECHANISM, not presentation: a per-node topology **signature** so any surface can group
 * isomorphic siblings (`×N`) with one pass, while the collapse POLICY stays surface-side.
 *
 * Two edge sets: the anchor tree (single `parentID`, drives signature + layout) and the
 * topological-join overlay (`joinParentIDs`, excluded from the signature). Status is a
 * point-in-time snapshot from the cache; live transitions ride the progress channel.
 *
 * @module
 */
import { createHash } from 'crypto';
import { procCache_get, ProcCache, ProcInstance } from '@fnndsc/cumin';
import { feedStatus_derive } from '../vfs/providers/proc.js';

/** One node of a feed DAG, as it crosses the wire to a surface. */
export interface FeedNode {
  id: number;
  pluginName: string;
  /** Anchor parent (single `previous_id`); null at a feed root. */
  parentID: number | null;
  /** Topology signature — equal signatures mark isomorphic subtrees (status excluded). */
  signature: string;
  /** Join overlay: extra parents merged by a `ts` node. Empty for ordinary nodes. */
  joinParentIDs: number[];
  /** Status snapshot at build time; null when not yet observed. */
  status: string | null;
}

/** A whole feed's DAG skeleton — flat node list plus feed-level metadata. */
export interface FeedGraph {
  feedID: number;
  title: string;
  /** Aggregate feed status derived from job counters (free — no per-node call). */
  feedStatus: string;
  /** Total nodes in the feed. */
  total: number;
  /** Nodes actually included in `nodes` (equals `total` until a caller truncates). */
  shown: number;
  /** True when a caller has dropped nodes for size (see the payload guard). */
  truncated: boolean;
  rootIDs: number[];
  nodes: FeedNode[];
}

/**
 * Computes a node's topology signature: a hash of its plugin name plus the **sorted**
 * (multiset) signatures of its anchor-tree children. Status and join edges are excluded,
 * so isomorphic fan-out branches share a signature regardless of order or run state.
 *
 * Memoized by instance ID; the anchor tree is acyclic (single parent), so recursion
 * terminates in O(n) across a feed.
 *
 * @param cache - Source topology cache.
 * @param id - Instance ID to sign.
 * @param memo - Shared per-build memo of already-computed signatures.
 * @returns Hex signature string.
 */
export function signature_compute(cache: ProcCache, id: number, memo: Map<number, string>): string {
  const cached: string | undefined = memo.get(id);
  if (cached !== undefined) return cached;

  const inst: ProcInstance | undefined = cache.instance_get(id);
  const name: string = inst?.pluginName ?? '?';
  const childSignatures: string[] = cache
    .children_get(id)
    .map((childID: number): string => signature_compute(cache, childID, memo))
    .sort();
  const canonical: string = `${name}(${childSignatures.join(',')})`;
  const signature: string = createHash('sha1').update(canonical).digest('hex');

  memo.set(id, signature);
  return signature;
}

/**
 * Projects a feed's cached topology into a {@link FeedGraph}. Returns the full graph
 * (no truncation — that is a caller/surface concern). Pure over the cache; no network.
 *
 * @param feedID - Feed to project.
 * @returns The feed's DAG, or null when the feed is not in the cache.
 */
export function feedGraph_build(feedID: number): FeedGraph | null {
  const cache: ProcCache = procCache_get();
  const feed = cache.feed_get(feedID);
  if (!feed) return null;

  const ids: number[] = cache.feedInstanceIDs_get(feedID);
  const memo: Map<number, string> = new Map<number, string>();

  const nodes: FeedNode[] = ids.map((id: number): FeedNode => {
    const inst: ProcInstance | undefined = cache.instance_get(id);
    return {
      id,
      pluginName: inst?.pluginName ?? '?',
      parentID: inst?.parentID ?? null,
      signature: signature_compute(cache, id, memo),
      joinParentIDs: cache.joinParents_get(id),
      status: inst?.status ?? null,
    };
  });

  return {
    feedID,
    title: feed.title,
    feedStatus: feedStatus_derive(feed),
    total: nodes.length,
    shown: nodes.length,
    truncated: false,
    rootIDs: cache.feedRoots_get(feedID),
    nodes,
  };
}
