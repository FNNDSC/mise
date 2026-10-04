/**
 * @file One molecule laid flat inside a standing space.
 *
 * The 2D projection flattens a whole scene. Inside the universe, the
 * operator looks at one feed among thousands, and the flat reading they ask
 * for is that feed's, not the space's: the rest must stand where it is. This
 * lays a subset of nodes out in two dimensions on the plane through their
 * centre that faces the eye, so the camera already looks at it square, and
 * the space behind keeps its depth.
 *
 * The flat layout is a settle, not a squash: projecting a sculpted molecule
 * onto a plane stacks nodes that stood one behind another. The settle starts
 * from that projection, so the picture keeps its rough arrangement, and
 * spreads it in the plane.
 *
 * @module
 */
import * as THREE from 'three';
import type { PhysicsTerms } from '../layout/index.js';
import type { SpaceNode } from './node.js';
import { layout_molecule, type PlacedNode } from './settle.js';

/**
 * Where each of a subset of nodes stands once laid flat on the plane through
 * their centre with the given normal.
 *
 * @param nodes - The nodes to lay flat (their links to nodes outside the set
 *   are dropped for this settle).
 * @param standing - Where each stands now, by id.
 * @param normal - The plane's normal (toward the eye), in the nodes' space.
 * @param up - Which way is up on screen, in the nodes' space.
 * @param physics - The terms of the settle.
 * @returns The flat positions, by id; a node with no standing position is left out.
 */
export function flatPositions_of(
  nodes: ReadonlyArray<SpaceNode>,
  standing: ReadonlyMap<string, THREE.Vector3>,
  normal: THREE.Vector3,
  up: THREE.Vector3,
  physics: PhysicsTerms,
): Map<string, THREE.Vector3> {
  const placed: SpaceNode[] = nodes.filter((node: SpaceNode): boolean => standing.has(node.id));
  const out: Map<string, THREE.Vector3> = new Map();
  if (placed.length === 0) return out;
  const centre: THREE.Vector3 = new THREE.Vector3();
  for (const node of placed) centre.add(standing.get(node.id) as THREE.Vector3);
  centre.divideScalar(placed.length);
  // The plane's axes: across and up as the eye sees them.
  const n: THREE.Vector3 = normal.clone().normalize();
  const across: THREE.Vector3 = new THREE.Vector3().crossVectors(up, n);
  if (across.lengthSq() < 1e-9) across.set(1, 0, 0).cross(n);
  across.normalize();
  const upright: THREE.Vector3 = new THREE.Vector3().crossVectors(n, across).normalize();
  // Seeds: each node's projection onto the plane, in the plane's own axes.
  const seeds: Map<string, THREE.Vector3> = new Map();
  for (const node of placed) {
    const offset: THREE.Vector3 = (standing.get(node.id) as THREE.Vector3).clone().sub(centre);
    seeds.set(node.id, new THREE.Vector3(offset.dot(across), offset.dot(upright), 0));
  }
  const inSet: Set<string> = new Set(placed.map((node: SpaceNode): string => node.id));
  const own: SpaceNode[] = placed.map((node: SpaceNode): SpaceNode => ({
    ...node,
    parentIds: node.parentIds.filter((id: string): boolean => inSet.has(id)),
    joinParentIds: node.joinParentIds.filter((id: string): boolean => inSet.has(id)),
  }));
  const laid: PlacedNode[] = layout_molecule(own, 2, seeds, { ...physics, gravity: false });
  // The settle may drift; the molecule stays centred where it stood. And
  // a free settle in the plane spreads wider than the sculpted molecule:
  // the flat one keeps the spread it had, so it stays in the frame the
  // descent gave it.
  const drift: THREE.Vector3 = new THREE.Vector3();
  for (const item of laid) drift.add(item.position);
  drift.divideScalar(laid.length);
  const spread = (offsets: number[]): number => Math.sqrt(offsets.reduce((sum: number, d: number): number => sum + d * d, 0) / Math.max(1, offsets.length));
  const before: number = spread(placed.map((node: SpaceNode): number => (standing.get(node.id) as THREE.Vector3).distanceTo(centre)));
  const after: number = spread(laid.map((item: PlacedNode): number => Math.hypot(item.position.x - drift.x, item.position.y - drift.y)));
  const scale: number = after > 1e-9 && before > 1e-9 ? before / after : 1;
  for (const item of laid) {
    const x: number = (item.position.x - drift.x) * scale;
    const y: number = (item.position.y - drift.y) * scale;
    out.set(item.node.id, centre.clone().addScaledVector(across, x).addScaledVector(upright, y));
  }
  return out;
}
