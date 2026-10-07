/**
 * @file One molecule laid flat inside a standing space: every node on the
 * plane facing the eye, the molecule where it stood.
 */
import { describe, it, expect } from '@jest/globals';
import * as THREE from 'three';
import { PHYSICS_DEFAULT } from '../src/layout/index.js';
import { FlatMolecule, flatPositions_of } from '../src/scene/flat.js';
import type { SpaceNode } from '../src/scene/node.js';

function node_make(id: string, parents: string[] = []): SpaceNode {
  return { id, label: id, look: {} as SpaceNode['look'], parentIds: parents, joinParentIds: [] } as unknown as SpaceNode;
}

describe('a molecule laid flat', () => {
  const nodes: SpaceNode[] = [node_make('a'), node_make('b', ['a']), node_make('c', ['a']), node_make('d', ['b', 'outside'])];
  const standing: Map<string, THREE.Vector3> = new Map([
    ['a', new THREE.Vector3(10, 0, 0)],
    ['b', new THREE.Vector3(11, 1, 2)],
    ['c', new THREE.Vector3(9, -1, -2)],
    ['d', new THREE.Vector3(12, 2, 4)],
  ]);

  it('lies on the plane through its centre that faces the eye', () => {
    const normal: THREE.Vector3 = new THREE.Vector3(1, 1, 1).normalize();
    const flat: Map<string, THREE.Vector3> = flatPositions_of(nodes, standing, normal, new THREE.Vector3(0, 1, 0), PHYSICS_DEFAULT);
    expect(flat.size).toBe(4);
    const centre: THREE.Vector3 = new THREE.Vector3(10.5, 0.5, 1);
    for (const at of flat.values()) expect(Math.abs(at.clone().sub(centre).dot(normal))).toBeLessThan(1e-6);
  });

  it('stays centred where it stood', () => {
    const flat: Map<string, THREE.Vector3> = flatPositions_of(nodes, standing, new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 1, 0), PHYSICS_DEFAULT);
    const centre: THREE.Vector3 = new THREE.Vector3();
    for (const at of flat.values()) centre.add(at);
    centre.divideScalar(flat.size);
    expect(centre.distanceTo(new THREE.Vector3(10.5, 0.5, 1))).toBeLessThan(1e-6);
  });

  it('keeps the spread the molecule had', () => {
    const centre: THREE.Vector3 = new THREE.Vector3(10.5, 0.5, 1);
    const rms = (points: THREE.Vector3[]): number => Math.sqrt(points.reduce((sum, p) => sum + p.distanceToSquared(centre), 0) / points.length);
    const flat: Map<string, THREE.Vector3> = flatPositions_of(nodes, standing, new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 1, 0), PHYSICS_DEFAULT);
    expect(rms([...flat.values()])).toBeCloseTo(rms([...standing.values()]), 6);
  });

  it('leaves out a node with nowhere to stand', () => {
    const flat: Map<string, THREE.Vector3> = flatPositions_of([...nodes, node_make('e')], standing, new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 1, 0), PHYSICS_DEFAULT);
    expect(flat.has('e')).toBe(false);
  });

  it('stands the molecule back up where it stood, and leaves the rest alone', () => {
    const flat: FlatMolecule = new FlatMolecule();
    const positions: Map<string, THREE.Vector3> = new Map([...standing].map(([id, at]) => [id, at.clone()]));
    positions.set('far', new THREE.Vector3(-50, 3, 7));
    const camera: THREE.PerspectiveCamera = new THREE.PerspectiveCamera();
    camera.position.set(0, 0, 30);
    const eye = { camera, focus: new THREE.Vector3(), world: new THREE.Object3D() };
    expect(flat.set(['a', 'b', 'c', 'd'], nodes, positions, eye, PHYSICS_DEFAULT)).toBe(true);
    expect(flat.active()).toBe(true);
    expect(positions.get('far')).toEqual(new THREE.Vector3(-50, 3, 7));
    expect(positions.get('d')?.z).toBeCloseTo(1, 6);
    expect(flat.set(null, nodes, positions, eye, PHYSICS_DEFAULT)).toBe(true);
    expect(flat.active()).toBe(false);
    for (const [id, at] of standing) expect(positions.get(id)?.distanceTo(at)).toBeLessThan(1e-9);
  });
});

describe('rootsTop_of', () => {
  it('a tree with its root above its children stands root on top; a burst does not; a lone node is not judged', async () => {
    const { rootsTop_of } = await import('../src/scene/tree.js');
    expect(rootsTop_of([{ id: 'r', parentIds: [], y: 2 }, { id: 'a', parentIds: ['r'], y: 0 }, { id: 'b', parentIds: ['a'], y: -2 }])).toBe(true);
    expect(rootsTop_of([{ id: 'r', parentIds: [], y: -1 }, { id: 'a', parentIds: ['r'], y: 1.5 }])).toBe(false);
    expect(rootsTop_of([{ id: 'r', parentIds: [], y: 0 }])).toBe(false);
    // A parent outside the lit set (a dimmed anchor) leaves its child a root.
    expect(rootsTop_of([{ id: 'r', parentIds: ['anchor'], y: 3 }, { id: 'a', parentIds: ['r'], y: 1 }])).toBe(true);
  });
});
