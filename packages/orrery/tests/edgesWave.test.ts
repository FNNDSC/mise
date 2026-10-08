/**
 * @file Under stars, every thread carries the wave a tube would: a finished
 * run replays stage by stage, a live stage streams, faint scenery rests.
 */
import { describe, it, expect, beforeAll } from '@jest/globals';
import * as THREE from 'three';
import { edges_draw, type DrawPorts } from '../src/scene/bodies.js';
import { StarField } from '../src/draw/starField.js';
import type { Palette } from '../src/draw/palette.js';
import type { SpaceNode } from '../src/scene/node.js';
import type { PlacedNode } from '../src/scene/settle.js';
import type { NodeState } from '../src/types/encoding.js';

beforeAll(() => {
  (globalThis as { document?: unknown }).document ??= { createElement: () => ({ width: 0, height: 0, getContext: () => null }) };
});

const c = (): THREE.Color => new THREE.Color(0.6, 0.6, 0.6);
const palette: Palette = { running: c(), done: c(), error: c(), template: c(), unknown: c(), edge: c(), join: c(), root: c(), pulse: c() };

const placed = (id: string, parents: string[], state: NodeState, y: number, extra: Partial<SpaceNode> = {}): PlacedNode => ({
  node: { id, label: id, parentIds: parents, joinParentIds: [], look: { state, paint: { kind: 'status' }, ember: false, waved: false }, ...extra } as unknown as SpaceNode,
  position: new THREE.Vector3(0, y, 0),
  radius: 0.5,
});

describe('edges_draw under stars', () => {
  it('gives every thread its wave: replay into a finished stage at its depth, stream into a live one, rest for scenery', () => {
    const nodes: PlacedNode[] = [
      placed('root', [], 'done', 0),
      placed('mid', ['root'], 'done', -1),
      placed('leaf', ['mid'], 'live', -2),
      placed('faint', ['root'], 'done', -3, { dim: true }),
    ];
    const byId: Map<string, PlacedNode> = new Map(nodes.map((n) => [n.node.id, n]));
    const parent = new THREE.Group();
    const stars = new StarField(parent);
    const ports = { stars, starring: true, handoffKey: undefined, spheres: { edge_add: () => undefined } } as unknown as DrawPorts;
    edges_draw(nodes, byId, palette, ports);
    expect(stars.threadsCarryWave()).toBe(true);
    const lines = parent.children.find((child) => child instanceof THREE.LineSegments) as THREE.LineSegments;
    const modes = [...(lines.geometry.getAttribute('aMode').array as Float32Array)].filter((_v, i) => i % 2 === 0);
    const starts = [...(lines.geometry.getAttribute('aStart').array as Float32Array)].filter((_v, i) => i % 2 === 0);
    // root→mid replays from the start, mid→leaf streams one step in, root→faint rests.
    expect(modes).toEqual([2, 1, 0]);
    expect(starts[0]).toBe(0);
    expect(starts[1]).toBeGreaterThan(0);
    const material = lines.material as THREE.ShaderMaterial;
    expect(material.uniforms['cycle']?.value).toBeGreaterThan(0);
  });
});
