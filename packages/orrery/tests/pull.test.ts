/**
 * @file The pull: the grabbed node's molecule and nothing else moves, never
 * across a halo or through a dimmed node; the grabbed node follows its pin;
 * released, the molecule cools to rest.
 */
import { describe, it, expect } from '@jest/globals';
import { PullSimulation, pullMolecule_of, type PullNode } from '../src/layout/pull.js';
import type { Vec3 } from '../src/types/space.js';

const node = (id: string, position: Vec3, marks: Partial<PullNode> = {}): PullNode => ({ id, position, radius: 0.5, dim: false, halo: false, ...marks });

/** a — b — c in a line; d apart; e joined to b but dimmed, f beyond e. */
const nodes: PullNode[] = [
  node('a', [0, 0, 0]),
  node('b', [2, 0, 0]),
  node('c', [4, 0, 0]),
  node('d', [20, 0, 0]),
  node('e', [2, 2, 0], { dim: true }),
  node('f', [2, 4, 0]),
  node('h', [0, -3, 0], { halo: true }),
];
const edges = [
  { from: 'a', to: 'b' },
  { from: 'b', to: 'c' },
  { from: 'b', to: 'e' },
  { from: 'e', to: 'f' },
  { from: 'h', to: 'a' },
  { from: 'a', to: 'ghost' },
];

describe('pullMolecule_of', () => {
  it('reaches along drawn edges, never through a dimmed node or across a halo', () => {
    const { ids, links } = pullMolecule_of({ grabbed: 'a', nodes, edges });
    expect([...ids].sort()).toEqual(['a', 'b', 'c']);
    expect(links).toEqual([{ source: 'a', target: 'b' }, { source: 'b', target: 'c' }]);
  });

  it('holds the grabbed node even alone', () => {
    expect([...pullMolecule_of({ grabbed: 'd', nodes, edges }).ids]).toEqual(['d']);
  });
});

describe('PullSimulation', () => {
  it('moves the molecule toward the pinned node and leaves the rest alone', () => {
    const pull = new PullSimulation({ grabbed: 'a', nodes, edges, dimensions: 3, baseRadius: 0.5 });
    const start = new Map(pull.positions().map((p) => [p.id, p.position]));
    expect([...start.keys()].sort()).toEqual(['a', 'b', 'c']);
    pull.pin([-6, 0, 0]);
    for (let i = 0; i < 60; i++) pull.step(true);
    const now = new Map(pull.positions().map((p) => [p.id, p.position]));
    expect(now.get('a')).toEqual([-6, 0, 0]);
    expect(now.get('b')![0]).toBeLessThan(start.get('b')![0] - 1);
    // Linked, so it stays within reach of what pulled it.
    expect(Math.abs(now.get('b')![0] - now.get('a')![0])).toBeLessThan(6);
  });

  it('keeps a flat pull flat', () => {
    const flat = nodes.map((n) => ({ ...n, position: [n.position[0], n.position[1], 0] as Vec3 }));
    const pull = new PullSimulation({ grabbed: 'a', nodes: flat, edges, dimensions: 2, baseRadius: 0.5 });
    pull.pin([-3, 1, 0]);
    for (let i = 0; i < 30; i++) pull.step(true);
    for (const { position } of pull.positions()) expect(position[2]).toBe(0);
  });

  it('cools to rest once released, and says so', () => {
    const pull = new PullSimulation({ grabbed: 'a', nodes, edges, dimensions: 3, baseRadius: 0.5 });
    pull.pin([-4, 0, 0]);
    expect(pull.step(true)).toBe(true);
    pull.release();
    let frames = 0;
    while (pull.step(false)) {
      frames += 1;
      if (frames > 2000) break;
    }
    expect(frames).toBeGreaterThan(0);
    expect(frames).toBeLessThan(2000);
    const rest = pull.positions().map((p) => p.position);
    expect(pull.step(false)).toBe(false);
    expect(pull.positions().map((p) => p.position)).toEqual(rest);
  });
});
