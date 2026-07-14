/**
 * @file Collapse transform for `feed tree` — groups isomorphic sibling subtrees.
 *
 * Pure over a {@link FeedGraph} (salsa types only). Turns the flat anchor tree into a tree
 * of {@link CollapsedNode}s where structurally-identical siblings (equal signature) are
 * merged into one `×N` template node carrying a status distribution and the ids of any
 * anomalous (non-done) members — so scale compresses but failures stay addressable.
 *
 * @module
 */
import type { FeedGraph, FeedNode } from '@fnndsc/salsa';

/** Job statuses treated as "still working" for the status distribution. */
const ACTIVE_STATUSES: ReadonlySet<string> = new Set<string>([
  'started', 'scheduled', 'created', 'registeringFiles', 'waiting', 'copying', 'running',
]);

/** A bucketed count of statuses across a set of instances. */
export interface StatusTally {
  done: number;
  error: number;
  running: number;
  other: number;
  total: number;
}

/** A node in the collapsed tree — either a singleton (count 1) or a `×N` group. */
export interface CollapsedNode {
  pluginName: string;
  signature: string;
  /** Number of original instances merged here. */
  count: number;
  /** Original instance ids in this set (sorted). */
  memberIds: number[];
  tally: StatusTally;
  /** Non-done members (error first), addressable for `--focus`. */
  anomalies: Array<{ id: number; status: string | null }>;
  /** True if any member carries topological-join edges. */
  hasJoin: boolean;
  /** Join sources for a singleton (empty for groups). */
  joinParentIDs: number[];
  children: CollapsedNode[];
}

/** Buckets a single status into the tally categories. */
function status_bucket(status: string | null): keyof Omit<StatusTally, 'total'> {
  if (status === 'finishedSuccessfully') return 'done';
  if (status === 'finishedWithError') return 'error';
  if (status !== null && ACTIVE_STATUSES.has(status)) return 'running';
  return 'other';
}

/** Tallies statuses across a set of nodes. */
function tally_of(nodes: FeedNode[]): StatusTally {
  const t: StatusTally = { done: 0, error: 0, running: 0, other: 0, total: nodes.length };
  for (const n of nodes) t[status_bucket(n.status)]++;
  return t;
}

/**
 * Builds a collapsed node from a set of member ids that share a signature (and therefore
 * plugin name and subtree shape). Pools the members' children and regroups them by
 * signature, recursing.
 */
function set_collapse(
  memberIds: number[],
  byId: Map<number, FeedNode>,
  childrenOf: Map<number, number[]>,
): CollapsedNode {
  const sorted: number[] = [...memberIds].sort((a: number, b: number): number => a - b);
  const nodes: FeedNode[] = sorted.map((id: number): FeedNode => byId.get(id)!);
  const tally: StatusTally = tally_of(nodes);

  const anomalies: Array<{ id: number; status: string | null }> = nodes
    .filter((n: FeedNode): boolean => status_bucket(n.status) !== 'done')
    .map((n: FeedNode): { id: number; status: string | null } => ({ id: n.id, status: n.status }))
    // error first, then everything else, each by id
    .sort((a, b): number => {
      const ea: number = a.status === 'finishedWithError' ? 0 : 1;
      const eb: number = b.status === 'finishedWithError' ? 0 : 1;
      return ea !== eb ? ea - eb : a.id - b.id;
    });

  // Pool all members' children, group by signature, recurse.
  const childIds: number[] = sorted.flatMap((id: number): number[] => childrenOf.get(id) ?? []);
  const bySig: Map<string, number[]> = new Map<string, number[]>();
  for (const cid of childIds) {
    const sig: string = byId.get(cid)!.signature;
    const bucket: number[] = bySig.get(sig) ?? [];
    bucket.push(cid);
    bySig.set(sig, bucket);
  }

  const children: CollapsedNode[] = [...bySig.values()]
    .map((ids: number[]): CollapsedNode => set_collapse(ids, byId, childrenOf))
    // deterministic: by descending count, then plugin name
    .sort((a: CollapsedNode, b: CollapsedNode): number =>
      b.count - a.count || a.pluginName.localeCompare(b.pluginName) || a.memberIds[0] - b.memberIds[0]);

  return {
    pluginName: nodes[0].pluginName,
    signature: nodes[0].signature,
    count: sorted.length,
    memberIds: sorted,
    tally,
    anomalies,
    hasJoin: nodes.some((n: FeedNode): boolean => n.joinParentIDs.length > 0),
    joinParentIDs: sorted.length === 1 ? nodes[0].joinParentIDs : [],
    children,
  };
}

/**
 * Collapses a feed graph (from the given roots) into a tree of {@link CollapsedNode}s,
 * merging isomorphic siblings. Singletons come through as `count === 1` nodes.
 *
 * @param graph - The feed's DAG.
 * @param roots - Root instance ids to start from (feed roots, or a focus node).
 * @returns Top-level collapsed nodes.
 */
export function collapse_build(graph: FeedGraph, roots: number[]): CollapsedNode[] {
  const byId: Map<number, FeedNode> = new Map(graph.nodes.map((n: FeedNode): [number, FeedNode] => [n.id, n]));
  const childrenOf: Map<number, number[]> = new Map<number, number[]>();
  for (const n of graph.nodes) {
    if (n.parentID !== null) {
      const kids: number[] = childrenOf.get(n.parentID) ?? [];
      kids.push(n.id);
      childrenOf.set(n.parentID, kids);
    }
  }

  const present: number[] = roots.filter((id: number): boolean => byId.has(id));
  const bySig: Map<string, number[]> = new Map<string, number[]>();
  for (const id of present) {
    const sig: string = byId.get(id)!.signature;
    const bucket: number[] = bySig.get(sig) ?? [];
    bucket.push(id);
    bySig.set(sig, bucket);
  }

  return [...bySig.values()]
    .map((ids: number[]): CollapsedNode => set_collapse(ids, byId, childrenOf))
    .sort((a: CollapsedNode, b: CollapsedNode): number =>
      b.count - a.count || a.pluginName.localeCompare(b.pluginName) || a.memberIds[0] - b.memberIds[0]);
}
