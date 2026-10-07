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
