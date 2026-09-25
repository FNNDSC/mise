/**
 * @file The hand-off, with the real fields it draws with: a molecule close
 * enough turns solid (spheres, tubes, stars faded out), one drawn back
 * fades to stars and lets its spheres and tubes go, and dimmed stars never
 * take part.
 */
import { describe, it, expect } from '@jest/globals';
import * as THREE from 'three';
import { HandoffField } from '../src/draw/handoffField.js';
import { SphereField } from '../src/draw/sphereField.js';
import { StarField } from '../src/draw/starField.js';
import { TubeField, type TubeNode } from '../src/draw/tubeField.js';
import type { StarEntry } from '../src/draw/stars.js';
import type { Palette } from '../src/draw/palette.js';

const c = (): THREE.Color => new THREE.Color(1, 1, 1);
const palette: Palette = { running: c(), done: c(), error: c(), template: c(), unknown: c(), edge: c(), join: c(), root: c(), pulse: c() };

/** A two-node molecule 'm' at depth `z`, and a dimmed star beside it. */
function world() {
  const parent = new THREE.Group();
  const spheres = new SphereField(parent);
  const stars = new StarField(parent);
  const nodes: Map<string, TubeNode> = new Map([
    ['a', { position: new THREE.Vector3(0, 0, -5), radius: 0.5, parents: [], joins: [], state: 'done' }],
    ['b', { position: new THREE.Vector3(0, 1, -5), radius: 0.5, parents: ['a'], joins: [], state: 'done' }],
  ]);
  const tubes = new TubeField({ parent, node: (id) => nodes.get(id), sphere: (id) => spheres.map.get(id), palette: () => palette });
  const handoff = new HandoffField({ spheres, stars, tubes, look: (id) => { const n = nodes.get(id); return n === undefined ? undefined : { position: n.position, radius: n.radius, color: c() }; } });
  const entries: StarEntry[] = [
    { id: 'a', position: new THREE.Vector3(0, 0, -5), radius: 0.5, color: c(), dim: false, ember: false },
    { id: 'b', position: new THREE.Vector3(0, 1, -5), radius: 0.5, color: c(), dim: false, ember: false },
    { id: 'x', position: new THREE.Vector3(3, 0, -5), radius: 0.5, color: c(), dim: true, ember: false },
  ];
  stars.draw(entries, 1, 1000, 50);
  handoff.gather(entries, (id: string): string | null => (id === 'x' ? 'other' : 'm'));
  return { parent, spheres, stars, tubes, handoff };
}

describe('HandoffField', () => {
  it('gathers molecules from their stars, leaving dimmed scenery out', () => {
    const { handoff } = world();
    expect(handoff.size()).toBe(1);
    expect(handoff.solidCount()).toBe(0);
  });

  it('turns a close molecule solid: spheres, tubes, its stars faded out', () => {
    const { handoff, spheres, stars, tubes } = world();
    handoff.step(new THREE.Matrix4(), 1000, 1000);
    expect(handoff.solidCount()).toBe(1);
    expect(spheres.map.has('a') && spheres.map.has('b')).toBe(true);
    expect(tubes.materialCount()).toBe(1);
    const glow = (stars.entry('a') as StarEntry);
    expect(glow.slot).toBe(0);
  });

  it('fades a molecule drawn back to stars, then lets its spheres and tubes go', () => {
    const { handoff, spheres, tubes } = world();
    handoff.step(new THREE.Matrix4(), 1000, 1000);
    const far = new THREE.Matrix4().makeTranslation(0, 0, -100000);
    handoff.step(far, 1000, 1100);
    expect(handoff.solidCount()).toBe(1);
    expect(spheres.map.has('a')).toBe(true);
    for (let t = 1200; t <= 1600; t += 100) handoff.step(far, 1000, t);
    expect(handoff.solidCount()).toBe(0);
    expect(spheres.map.has('a')).toBe(false);
    expect(tubes.materialCount()).toBe(0);
  });

  it('forgets everything on a redraw', () => {
    const { handoff } = world();
    handoff.clear();
    expect(handoff.size()).toBe(0);
  });
});
