/**
 * @file A space of many molecules laid out as a hierarchy: each molecule
 * keeps its own shape, molecules do not sit inside each other, a space
 * that stood everywhere does not move, and it is quick at the size of a
 * real lab.
 */
import { describe, it, expect } from '@jest/globals';
import { hierarchy_layout, type HierarchyNode } from '../../src/scene/hierarchy.js';

const PHYSICS = { charge: true, link: true, collide: true, gravity: false };

/** A space: `feeds` feeds of `chain` spheres each, every root hung from one anchor per shape. */
function space_make(feeds: number, chain: number, shapes: number = 3): HierarchyNode[] {
  const nodes: HierarchyNode[] = [];
  for (let s = 0; s < shapes; s++) nodes.push({ id: `anchor:${s}`, parents: [], radius: 0.3, group: null });
  for (let f = 0; f < feeds; f++) {
    for (let k = 0; k < chain; k++) {
      nodes.push({ id: `feed:${f}:${k}`, parents: [k === 0 ? `anchor:${f % shapes}` : `feed:${f}:${k - 1}`], radius: 0.4, group: `feed:${f}` });
    }
  }
  return nodes;
}

const distance = (a: [number, number, number], b: [number, number, number]): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

describe('hierarchy_layout', () => {
  it('places every node, and keeps a molecule\'s spheres together', () => {
    const at = hierarchy_layout(space_make(40, 5), PHYSICS);
    expect(Object.keys(at).length).toBe(3 + 40 * 5);
    for (let f = 0; f < 40; f++) {
      for (let k = 1; k < 5; k++) expect(distance(at[`feed:${f}:${k}`]!, at[`feed:${f}:${k - 1}`]!)).toBeLessThan(6);
    }
  });

  it('does not put one molecule inside another', () => {
    const at = hierarchy_layout(space_make(60, 4), PHYSICS);
    const centre = (f: number): [number, number, number] => {
      const c: [number, number, number] = [0, 0, 0];
      for (let k = 0; k < 4; k++) { c[0] += at[`feed:${f}:${k}`]![0] / 4; c[1] += at[`feed:${f}:${k}`]![1] / 4; c[2] += at[`feed:${f}:${k}`]![2] / 4; }
      return c;
    };
    let closest: number = Infinity;
    for (let a = 0; a < 60; a++) for (let b = a + 1; b < 60; b++) closest = Math.min(closest, distance(centre(a), centre(b)));
    expect(closest).toBeGreaterThan(0.5);
  });

  it('moves nothing when every node stood somewhere and is held', () => {
    const first = hierarchy_layout(space_make(20, 3), PHYSICS);
    const held: HierarchyNode[] = space_make(20, 3).map((node: HierarchyNode): HierarchyNode => ({ ...node, seed: first[node.id], frozen: true }));
    const again = hierarchy_layout(held, PHYSICS);
    for (const node of held) expect(distance(again[node.id]!, first[node.id]!)).toBeLessThan(1e-6);
  });

  it('settles a space the size of a real lab in seconds, not minutes', () => {
    const started: number = Date.now();
    hierarchy_layout(space_make(2400, 11, 36), PHYSICS);
    expect(Date.now() - started).toBeLessThan(20000);
  }, 60000);
});
