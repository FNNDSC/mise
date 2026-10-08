/**
 * @file How a drawn graph stands: a readout the scene publishes on its
 * canvas beside the fit count, so a smoke can say a feed opened as its
 * tree, root on top, through either door.
 *
 * @module
 */
/**
 * Whether a graph stands as a tree with its roots on top: every node with
 * no parent among the given ones sits at or above every node that has one.
 * Fewer than two nodes, or no child among them, is not a tree to judge.
 *
 * @param nodes - The lit nodes, each with its parents and its height.
 * @returns True when the roots are on top.
 */
export function rootsTop_of(nodes: ReadonlyArray<{ id: string; parentIds: ReadonlyArray<string>; y: number }>): boolean {
  const ids: Set<string> = new Set(nodes.map((node) => node.id));
  const isRoot = (node: { parentIds: ReadonlyArray<string> }): boolean => !node.parentIds.some((parent: string): boolean => ids.has(parent));
  const roots = nodes.filter(isRoot);
  const children = nodes.filter((node) => !isRoot(node));
  if (roots.length === 0 || children.length === 0) return false;
  const lowestRoot: number = Math.min(...roots.map((node) => node.y));
  const highestChild: number = Math.max(...children.map((node) => node.y));
  return lowestRoot >= highestChild - 1e-6;
}

/**
 * How long the graph's edges run where the nodes stand: the median, and
 * the longest with the two nodes it joins. A surface asked for its state
 * says it, so an edge flung far from its molecule (a tendril across the
 * space) can be named rather than guessed at. Anchors and halos are left
 * out: a feed's tie to its shape is not one of its edges.
 *
 * @param nodes - The graph's nodes.
 * @param at - Where each stands.
 * @returns The median and the longest edge, or nothing for a graph without edges.
 */
export function edgeSpan_of(
  nodes: ReadonlyArray<{ id: string; parentIds: ReadonlyArray<string>; ghost?: boolean; halo?: boolean }>,
  at: ReadonlyMap<string, { x: number; y: number; z: number }>,
): { edgeMedian?: string; edgeLongest?: string } {
  const skip: Set<string> = new Set(nodes.filter((node) => node.ghost === true || node.halo === true).map((node) => node.id));
  const lengths: number[] = [];
  let longest: { length: number; from: string; to: string } | null = null;
  for (const node of nodes) {
    if (skip.has(node.id)) continue;
    const a = at.get(node.id);
    if (a === undefined) continue;
    for (const parent of node.parentIds) {
      if (skip.has(parent)) continue;
      const b = at.get(parent);
      if (b === undefined) continue;
      const length: number = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
      lengths.push(length);
      if (longest === null || length > longest.length) longest = { length, from: parent, to: node.id };
    }
  }
  if (lengths.length === 0 || longest === null) return {};
  lengths.sort((x: number, y: number): number => x - y);
  return {
    edgeMedian: (lengths[Math.floor(lengths.length / 2)] ?? 0).toFixed(1),
    edgeLongest: `${longest.length.toFixed(1)}(${longest.from}->${longest.to})`,
  };
}
