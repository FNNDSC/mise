/**
 * @file The drawn nodes looked up by id: a sphere's world place and radius,
 * a star's, a census member's as a dive target, and the reaches a frame is
 * fitted to; and a placement as the census reads it.
 */
import { describe, it, expect } from '@jest/globals';
import * as THREE from 'three';
import type { CensusField, StarField } from '../src/draw/index.js';
import { DrawnNodes, censusNodes_of } from '../src/scene/drawn.js';
import type { SpaceNode } from '../src/scene/node.js';
import type { PlacedNode } from '../src/scene/settle.js';
import type { Palette } from '../src/draw/index.js';

function palette_make(): Palette {
  const grey: THREE.Color = new THREE.Color('#555555');
  return { running: new THREE.Color('#ff7700'), done: grey, error: grey, template: grey, unknown: grey, edge: grey, join: grey, root: grey, pulse: grey };
}

function node_make(id: string, extra: Partial<SpaceNode> = {}): SpaceNode {
  return { id, label: id, parentIds: [], joinParentIds: [], look: { state: 'live', paint: { token: 'running' }, ember: true, waved: false }, ...extra };
}

function scene_make(): { drawn: DrawnNodes; group: THREE.Group } {
  const group: THREE.Group = new THREE.Group();
  group.position.set(10, 0, 0);
  const sphere: THREE.Mesh = new THREE.Mesh(new THREE.SphereGeometry(0.5), new THREE.MeshStandardMaterial());
  sphere.position.set(1, 0, 0);
  group.add(sphere);
  const meshes: Map<string, THREE.Mesh> = new Map([['sphere', sphere]]);
  const stars = {
    ids: (): string[] => ['star'],
    entry: (id: string) => (id === 'star' ? { id, position: new THREE.Vector3(2, 0, 0), radius: 0.25 } : undefined),
  } as unknown as StarField;
  const census = {
    ids: (): string[] => ['member'],
    positions: (): THREE.Vector3[] => [new THREE.Vector3(3, 0, 0)],
  } as unknown as CensusField;
  group.updateMatrixWorld(true);
  return { drawn: new DrawnNodes({ meshes: () => meshes, stars, census, group }), group };
}

describe('DrawnNodes', () => {
  it('lists spheres and stars', () => {
    expect(scene_make().drawn.ids()).toEqual(['sphere', 'star']);
  });

  it('places a sphere and a star in the world, through the group', () => {
    const { drawn } = scene_make();
    const sphere = drawn.world_of('sphere');
    expect(sphere?.position.x).toBeCloseTo(11);
    expect(sphere?.radius).toBeCloseTo(0.5);
    const star = drawn.world_of('star');
    expect(star?.position.x).toBeCloseTo(12);
    expect(star?.radius).toBe(0.25);
    expect(drawn.world_of('nowhere')).toBeNull();
  });

  it('dives to a sphere, to a census member, and nowhere else', () => {
    const { drawn } = scene_make();
    expect(drawn.diveTarget_of('sphere')?.x).toBeCloseTo(11);
    expect(drawn.diveTarget_of('member')?.x).toBeCloseTo(13);
    expect(drawn.diveTarget_of('nowhere')).toBeNull();
  });

  it('reaches the nodes asked for, or every drawn node', () => {
    const { drawn } = scene_make();
    expect(drawn.reaches_of([]).length).toBe(2);
    expect(drawn.reaches_of(['star']).map((reach) => reach.radius)).toEqual([0.25]);
    expect(drawn.reaches_of(['nowhere']).length).toBe(0);
  });
});

describe('censusNodes_of', () => {
  it('reads a placement as the census does: counts floored at one, ghosts named', () => {
    const placed: PlacedNode[] = [
      { node: node_make('a', { count: 0, ghost: true }), position: new THREE.Vector3(1, 2, 3), radius: 0.4 },
      { node: node_make('b', { count: 7, dim: true, parentIds: ['a'] }), position: new THREE.Vector3(), radius: 0.6 },
    ];
    const nodes = censusNodes_of(placed, palette_make());
    expect(nodes.map((n) => n.count)).toEqual([1, 7]);
    expect(nodes[0]?.ghost).toBe(true);
    expect(nodes[1]?.ghost).toBe(false);
    expect(nodes[1]?.dim).toBe(true);
    expect(nodes[1]?.parents).toEqual(['a']);
    expect(nodes[0]?.position.y).toBe(2);
    expect(nodes[1]?.state).toBe('live');
    expect(nodes[1]?.color.getHexString()).toBe('ff7700');
  });
});
