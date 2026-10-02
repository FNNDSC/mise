/**
 * @file The settle, as the scene holds it: orrery's layout engines placing
 * nodes, the scene keeping the places as vectors beside the nodes.
 *
 * Pure over the graph — no renderer, no camera — so a settle can be read
 * and tested without a scene. The scene composes it (`Orrery.rebuild`).
 */
import * as THREE from 'three';
import {
  NODE_RADIUS,
  PHYSICS_DEFAULT,
  molecule_prepare,
  moleculeRadii_of as orreryRadii_of,
  ranked_layout,
  type MoleculeNode,
  type MoleculeSettle as OrreryMoleculeSettle,
  type PhysicsTerms,
} from '../layout/index.js';
import type { Vec3 } from '../types/space.js';
import type { SpaceNode } from './node.js';

/** A positioned node during layout. */
export interface PlacedNode {
  node: SpaceNode;
  position: THREE.Vector3;
  radius: number;
}

/**
 * A molecule settle that can be run in slices, holding its places as the
 * scene's vectors: orrery settles, the scene draws.
 */
export interface MoleculeSettle {
  total: number;
  moving: number;
  step: (ticks: number) => void;
  place: () => PlacedNode[];
}

/** Settles smaller than this many ticks × nodes run in one go. */
export const SLICE_MIN_WORK: number = 90 * 400;
/** Time a settle may take from one frame before it yields to the next. */
export const SLICE_BUDGET_MS: number = 12;

/**
 * A scene node as orrery's molecule reads it: its parents with its joins
 * after them, and its metric.
 *
 * @param node - The scene node.
 * @returns The molecule node.
 */
function moleculeNode_of(node: SpaceNode): MoleculeNode {
  const out: MoleculeNode = { id: node.id, parents: [...node.parentIds, ...node.joinParentIds] };
  if (node.metric !== undefined) out.metric = node.metric;
  return out;
}

/**
 * The ranked layout, placed in the scene: orrery places the tiers, the scene
 * holds them as vectors beside their nodes. The tree is a sheet, every node
 * at z = 0, so an orbit reads as turning the sheet and never scrambles the
 * hierarchy.
 *
 * @param nodes - The graph's nodes.
 * @returns Every node placed.
 */
export function layout_ranked(nodes: SpaceNode[]): PlacedNode[] {
  const places = ranked_layout(nodes.map((node: SpaceNode) => {
    const out: { id: string; parentIds: string[]; metric?: number } = { id: node.id, parentIds: node.parentIds };
    if (node.metric !== undefined) out.metric = node.metric;
    return out;
  }));
  return nodes.map((node: SpaceNode, index: number): PlacedNode => {
    const at = places[index];
    return { node, position: new THREE.Vector3(...(at?.position ?? [0, 0, 0])), radius: at?.radius ?? NODE_RADIUS };
  });
}

/**
 * Each node's radius, as the molecule settle sizes it.
 *
 * @param nodes - The graph's nodes.
 * @returns Radius by id.
 */
export function moleculeRadii_of(nodes: ReadonlyArray<SpaceNode>): Map<string, number> {
  return orreryRadii_of(nodes.map(moleculeNode_of));
}

/**
 * Builds orrery's molecule settle over the scene's nodes and seeds.
 *
 * @param nodes - The graph's nodes.
 * @param dimensions - 2 or 3.
 * @param seed - Where nodes stood last.
 * @param physics - The terms of this settle.
 * @param frozen - Nodes that stand where their seed put them.
 * @returns The settle, placing into the scene's vectors.
 */
export function moleculeScene_prepare(
  nodes: SpaceNode[],
  dimensions: 2 | 3 = 3,
  seed: Map<string, THREE.Vector3> = new Map(),
  physics: PhysicsTerms = PHYSICS_DEFAULT,
  frozen: ReadonlySet<string> = new Set(),
): MoleculeSettle {
  const seeds: Map<string, Vec3> = new Map([...seed].map(([id, at]: [string, THREE.Vector3]): [string, Vec3] => [id, [at.x, at.y, at.z]]));
  const settle: OrreryMoleculeSettle = molecule_prepare(nodes.map(moleculeNode_of), dimensions, seeds, physics, frozen);
  return {
    total: settle.total,
    moving: settle.moving,
    step: settle.step,
    place: (): PlacedNode[] => settle.place().map((place, index: number): PlacedNode => ({
      node: nodes[index] as SpaceNode,
      position: new THREE.Vector3(...place.position),
      radius: place.radius,
    })),
  };
}

/**
 * Lays out a molecule in one go.
 *
 * @returns Every node placed.
 */
export function layout_molecule(
  nodes: SpaceNode[],
  dimensions: 2 | 3 = 3,
  seed: Map<string, THREE.Vector3> = new Map(),
  physics: PhysicsTerms = PHYSICS_DEFAULT,
  frozen: ReadonlySet<string> = new Set(),
): PlacedNode[] {
  const settle: MoleculeSettle = moleculeScene_prepare(nodes, dimensions, seed, physics, frozen);
  settle.step(settle.total);
  return settle.place();
}
