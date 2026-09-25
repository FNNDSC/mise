/**
 * @file The layout layer's public face: the engines, their contract, and
 * the pure layouts a surface may call directly.
 *
 * This entry imports no renderer, so a worker that settles a space loads
 * only the gearing, never the brass.
 *
 * @module
 */
export * from './types.js';
export { galaxy_layout } from './galaxy.js';
export { hierarchy_layout, type HierarchyArrangement, type HierarchyNode, type HierarchyPhysics, type HierarchyPositions } from './hierarchy.js';
export { molecule_prepare, molecule_layout, moleculeRadii_of, type MoleculeNode, type MoleculePlace, type MoleculeSettle } from './molecule.js';
export { rankedLayout_compute, ranked_layout, type RankedInput, type RankedPlacement, type RankedLayout, type RankedSceneNode } from './ranked.js';
export { layoutEngines_list, layoutEngine_get, layoutNeeds_missing } from './registry.js';
