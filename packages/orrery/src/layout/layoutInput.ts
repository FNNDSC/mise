/**
 * @file What a layout engine is handed, built one way for every caller.
 *
 * A scene settling a space in the browser and a session laying the same
 * space out once for every browser must hand the engines the same input, or
 * the session's places are not the places a browser would have found: each
 * node's radius (sized by its metric against the space's largest), its
 * parents (joins included), its molecule (the surface names it; an anchor
 * has none), what it carries for an engine that needs more, and where it
 * stood if anywhere. Built here, once, for both.
 *
 * @module
 */
import { moleculeRadii_of, type MoleculeNode } from './molecule.js';
import { NODE_RADIUS, type LayoutNode, type Vec3 } from './types.js';

/**
 * A node as a surface describes it to a layout.
 *
 * @property id - Its id.
 * @property parentIds - Its parents.
 * @property joinParentIds - Its joins: edges that are not its parent chain.
 * @property metric - What sizes it; absent sizes it by its degree.
 * @property ghost - An anchor: in the settle, belonging to no molecule.
 * @property attrs - What an engine that needs more reads.
 */
export interface LayoutSource {
  id: string;
  parentIds: ReadonlyArray<string>;
  joinParentIds: ReadonlyArray<string>;
  metric?: number;
  ghost?: boolean;
  attrs?: Record<string, number | string | string[]>;
}

/**
 * The engines' input for a space.
 *
 * @param nodes - The space's nodes.
 * @param keyOf - The molecule a node belongs to, as the surface names it.
 * @param seeds - Where nodes stood last, if anywhere.
 * @param frozen - Nodes held where they stand.
 * @returns One layout node per node, in order.
 */
export function layoutInput_build<N extends LayoutSource>(
  nodes: ReadonlyArray<N>,
  keyOf: (node: N) => string | null,
  seeds: ReadonlyMap<string, Vec3> = new Map(),
  frozen: ReadonlySet<string> = new Set(),
): LayoutNode[] {
  const radii: Map<string, number> = moleculeRadii_of(nodes.map((node: N): MoleculeNode => {
    const out: MoleculeNode = { id: node.id, parents: [...node.parentIds, ...node.joinParentIds] };
    if (node.metric !== undefined) out.metric = node.metric;
    return out;
  }));
  return nodes.map((node: N): LayoutNode => {
    const seed: Vec3 | undefined = seeds.get(node.id);
    return {
      id: node.id,
      parents: [...node.parentIds, ...node.joinParentIds],
      radius: radii.get(node.id) ?? NODE_RADIUS,
      group: node.ghost === true ? null : keyOf(node),
      ...(node.attrs === undefined ? {} : { attrs: node.attrs }),
      ...(seed === undefined ? {} : { seed }),
      ...(frozen.has(node.id) ? { frozen: true } : {}),
    };
  });
}
