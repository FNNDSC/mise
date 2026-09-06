/**
 * @file The ranked layout, declared once.
 *
 * A DAG drawn as the tree it is: every node hangs beneath its anchor parent
 * (a join's extra parents are edges, not placement), a subtree occupies a
 * contiguous span of leaf slots and its root sits over the middle of that
 * span, tiers by depth from the roots. The same graph always lands the same
 * way — sibling order is settled by id, so nothing depends on the order
 * nodes happened to arrive in.
 *
 * This module exists because the layout was written twice. The stage drew a
 * pipeline with the algorithm below; the preview card drew the same
 * pipeline by spreading each tier evenly, and the two agreed on nothing —
 * so a card and the detail it previewed were visibly different graphs. They
 * were not made to differ; they were written separately and could not help
 * it.
 *
 * The output is in LAYOUT UNITS — slot columns and tier rows — not in
 * scene units or pixels. Each renderer scales them for the medium it
 * paints: three.js on the stage, SVG in a card that cannot hold a WebGL
 * context, since a grid of ninety previews would want ninety of them and a
 * browser grants about a dozen.
 *
 * Deliberately dependency-free, so it can be unit tested where the scene
 * itself cannot: three.js will not load under jest.
 *
 * @module
 */

/** What the layout needs of a node: who it is, and what it hangs from. */
export interface RankedInput {
  id: string;
  parentIds: string[];
}

/** Where one node landed, in layout units. */
export interface RankedPlacement {
  id: string;
  /** Slot column. Fractional for a node centred over a subtree span. */
  x: number;
  /** Tier row, zero at the roots and increasing with depth. */
  tier: number;
}

/** A whole graph placed, with the extents a renderer needs to fit it. */
export interface RankedLayout {
  placements: RankedPlacement[];
  /** Distance between the leftmost and rightmost slot; zero for one column. */
  width: number;
  /** How many tiers deep the graph runs; at least one. */
  tierCount: number;
}

/**
 * Places a graph as ranked tiers.
 *
 * @param nodes - The graph. Parent ids naming absent nodes are ignored, so
 *   a partial graph still places.
 * @returns Every node's slot and tier, with the extents to fit them by.
 */
export function rankedLayout_compute(nodes: ReadonlyArray<RankedInput>): RankedLayout {
  const byId: Map<string, RankedInput> = new Map(
    nodes.map((node: RankedInput): [string, RankedInput] => [node.id, node]),
  );

  // Depth is the longest path from a root, so a join sits below everything
  // it waits for rather than beside its shallowest parent.
  const depths: Map<string, number> = new Map();
  const depth_find = (node: RankedInput, trail: Set<string>): number => {
    const known: number | undefined = depths.get(node.id);
    if (known !== undefined) return known;
    if (trail.has(node.id) || node.parentIds.length === 0) {
      depths.set(node.id, 0);
      return 0;
    }
    trail.add(node.id);
    let deepest: number = 0;
    for (const parentId of node.parentIds) {
      const parent: RankedInput | undefined = byId.get(parentId);
      if (parent) deepest = Math.max(deepest, depth_find(parent, trail) + 1);
    }
    depths.set(node.id, deepest);
    return deepest;
  };
  for (const node of nodes) depth_find(node, new Set());

  // The anchor tree: each node under its first parent present in the graph;
  // anything without one is a root. Sibling order is settled by id so the
  // same graph lands the same way whatever order it arrived in.
  const children: Map<string, RankedInput[]> = new Map();
  const roots: RankedInput[] = [];
  const byIdSort = (a: RankedInput, b: RankedInput): number =>
    a.id.localeCompare(b.id, undefined, { numeric: true });
  for (const node of nodes) {
    const anchor: string | undefined = node.parentIds.find((id: string): boolean => byId.has(id));
    if (anchor === undefined) { roots.push(node); continue; }
    const siblings: RankedInput[] = children.get(anchor) ?? [];
    siblings.push(node);
    children.set(anchor, siblings);
  }
  roots.sort(byIdSort);
  for (const siblings of children.values()) siblings.sort(byIdSort);

  // Leaf slots: a subtree spans as many slots as it has leaves, and its
  // root sits over the middle of that span. One walk assigns every x.
  const xs: Map<string, number> = new Map();
  let slot: number = 0;
  const seen: Set<string> = new Set();
  const place = (node: RankedInput): [number, number] => {
    seen.add(node.id);
    const kids: RankedInput[] = (children.get(node.id) ?? [])
      .filter((kid: RankedInput): boolean => !seen.has(kid.id));
    if (kids.length === 0) {
      const x: number = slot++;
      xs.set(node.id, x);
      return [x, x];
    }
    let first: number = Number.POSITIVE_INFINITY;
    let last: number = Number.NEGATIVE_INFINITY;
    for (const kid of kids) {
      const [low, high]: [number, number] = place(kid);
      first = Math.min(first, low);
      last = Math.max(last, high);
    }
    const x: number = (first + last) / 2;
    xs.set(node.id, x);
    return [first, last];
  };
  for (const root of roots) place(root);
  // A cycle leaves nodes the walk never reached; they still land.
  for (const node of nodes) if (!xs.has(node.id)) place(node);

  const tierCount: number = Math.max(...Array.from(depths.values()), 0) + 1;
  const width: number = Math.max(slot - 1, 0);
  const placements: RankedPlacement[] = nodes.map((node: RankedInput): RankedPlacement => ({
    id: node.id,
    x: xs.get(node.id) ?? 0,
    tier: depths.get(node.id) ?? 0,
  }));
  return { placements, width, tierCount };
}
