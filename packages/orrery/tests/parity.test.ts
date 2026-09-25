/**
 * @file The layouts, pinned: every engine run on fixed graphs must place
 * every node exactly where the scene placed it before the layouts moved
 * into orrery. The fixtures were recorded from the scene's own code; a
 * change that moves one node by a float fails here, not in a screenshot.
 */
import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { hierarchy_layout, type HierarchyNode } from '../src/layout/hierarchy.js';
import { galaxy_layout } from '../src/layout/galaxy.js';
import { molecule_prepare, moleculeRadii_of, type MoleculeNode } from '../src/layout/molecule.js';
import { ranked_layout } from '../src/layout/ranked.js';
import type { PhysicsTerms, Vec3 } from '../src/layout/types.js';

const molecule: Record<string, unknown> = JSON.parse(readFileSync(new URL('./fixtures/molecule-baseline.json', import.meta.url), 'utf8'));
const hierarchy: Record<string, unknown> = JSON.parse(readFileSync(new URL('./fixtures/hierarchy-baseline.json', import.meta.url), 'utf8'));

interface Fixture { id: string; parentIds: string[]; joinParentIds: string[]; metric?: number }

/** The graphs the baseline was recorded on. */
function graphs(): Record<string, Fixture[]> {
  const n = (id: string, parents: string[] = [], extra: Partial<Fixture> = {}): Fixture => ({ id, parentIds: parents, joinParentIds: [], ...extra });
  const chain: Fixture[] = [n('a'), n('b', ['a']), n('c', ['b']), n('d', ['c'])];
  const fan: Fixture[] = [n('r'), ...Array.from({ length: 12 }, (_: unknown, i: number) => n('f' + i, ['r'], { metric: i + 1 }))];
  const join: Fixture[] = [n('x'), n('y', ['x']), n('z', ['x']), { ...n('w', ['y']), joinParentIds: ['z'] }];
  const big: Fixture[] = [n('s0')];
  for (let i = 1; i < 120; i++) big.push(n('s' + i, ['s' + Math.floor((i - 1) / 3)], { metric: (i * 7) % 11 }));
  return { chain, fan, join, big };
}

/** A fixture node as the molecule reads it: joins among its parents, as the scene passes them. */
function moleculeNode_of(f: Fixture): MoleculeNode {
  const out: MoleculeNode = { id: f.id, parents: [...f.parentIds, ...f.joinParentIds] };
  if (f.metric !== undefined) out.metric = f.metric;
  return out;
}

/** The small universe the hierarchy baseline was recorded on. */
function universeNodes(): HierarchyNode[] {
  const nodes: HierarchyNode[] = [];
  const shapes: string[] = ['s0', 's1', 's2', 's3', 's4'];
  for (const s of shapes) nodes.push({ id: 'shape:' + s, parents: [], radius: 0.3, group: null });
  for (let f = 0; f < 60; f++) {
    const s: string = shapes[f % shapes.length] as string;
    const len: number = 1 + (f % 4);
    for (let k = 0; k < len; k++) {
      nodes.push({ id: `feed:${f}:${k}`, parents: k === 0 ? ['shape:' + s] : [`feed:${f}:${k - 1}`], radius: 0.4 + 0.1 * ((f + k) % 5), group: 'feed:' + f });
    }
  }
  return nodes;
}

/** A value as JSON carries it: the baseline was written as JSON, which drops the sign of a zero. */
function asJson(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}

/**
 * How far apart two position maps are: the largest difference on any axis
 * of any node, or Infinity when they place different nodes. The hierarchy's
 * settle is not bit-exact run to run — d3 parts coincident starting points
 * with a random jiggle of 1e-6 — so the same code lands a few 1e-14 apart;
 * a real change moves nodes by whole units.
 */
function positions_deviation(received: Record<string, Vec3>, expected: unknown): number {
  const want = expected as Record<string, Vec3>;
  const ids: string[] = Object.keys(received).sort();
  if (ids.join('|') !== Object.keys(want).sort().join('|')) return Infinity;
  let worst: number = 0;
  for (const id of ids) {
    const at: Vec3 = received[id] as Vec3;
    const ref: Vec3 = want[id] as Vec3;
    for (let axis = 0; axis < 3; axis++) worst = Math.max(worst, Math.abs((at[axis] as number) - (ref[axis] as number)));
  }
  return worst;
}

const PHYS: PhysicsTerms = { link: true, charge: true, collide: true, gravity: false };

describe('molecule parity', () => {
  for (const [name, fixture] of Object.entries(graphs())) {
    const nodes: MoleculeNode[] = fixture.map(moleculeNode_of);
    it(`${name}: 3D settle`, () => {
      const settle = molecule_prepare(nodes, 3, new Map(), PHYS, new Set());
      settle.step(settle.total);
      expect(asJson(settle.place().map((p) => [p.id, ...p.position, p.radius]))).toEqual(molecule[`molecule3d:${name}`]);
    });
    it(`${name}: 2D settle with gravity`, () => {
      const settle = molecule_prepare(nodes, 2, new Map(), { ...PHYS, gravity: true }, new Set());
      settle.step(settle.total);
      expect(asJson(settle.place().map((p) => [p.id, ...p.position]))).toEqual(molecule[`molecule2d:${name}`]);
    });
    it(`${name}: warm start with frozen nodes and bounded reach`, () => {
      const seed: Map<string, Vec3> = new Map(nodes.map((m: MoleculeNode, i: number): [string, Vec3] => [m.id, [i, -i, i * 0.5]]));
      const frozen: Set<string> = new Set(nodes.slice(0, 2).map((m: MoleculeNode): string => m.id));
      const settle = molecule_prepare(nodes, 3, seed, { ...PHYS, reach: 12 }, frozen);
      settle.step(settle.total);
      expect(asJson(settle.place().map((p) => [p.id, ...p.position]))).toEqual(molecule[`moleculeFrozen:${name}`]);
    });
    it(`${name}: ranked`, () => {
      const placed = ranked_layout(fixture);
      expect(asJson(placed.map((p) => [p.id, ...p.position, p.radius]))).toEqual(molecule[`ranked:${name}`]);
    });
    it(`${name}: radii`, () => {
      expect(asJson([...moleculeRadii_of(nodes)])).toEqual(molecule[`radii:${name}`]);
    });
  }
});

/*
 * The hierarchy and galaxy turn each reused molecule by a chance seeded from
 * the molecule's own key, so the same space lands the same way every time;
 * they are pinned here as they land by default.
 */
describe('hierarchy and galaxy, pinned', () => {
  const physics: PhysicsTerms = { link: true, charge: true, collide: true, gravity: true, reach: 12 };
  const golden: Record<string, unknown> = JSON.parse(readFileSync(new URL('./fixtures/hierarchy-seeded.json', import.meta.url), 'utf8'));
  const run = (which: string): Record<string, Vec3> => {
    if (which === 'galaxy') return galaxy_layout(universeNodes(), physics, () => {});
    return hierarchy_layout(universeNodes(), physics, () => {}, which as 'spokes' | 'clumps');
  };
  for (const which of ['spokes', 'clumps', 'galaxy']) {
    it(`${which}: the same space lands the same way every time`, () => {
      expect(asJson(run(which))).toEqual(asJson(run(which)));
    });
    it(`${which}: matches its pinned layout`, () => {
      expect(positions_deviation(run(which), golden[which])).toBeLessThan(1e-4);
    });
  }
  it('a fully seeded galaxy needs no random source and matches the scene exactly', () => {
    const seeded: HierarchyNode[] = universeNodes().map((n: HierarchyNode, i: number): HierarchyNode => ({ ...n, seed: [i * 0.1, -i * 0.2, i * 0.05], frozen: i % 7 === 0 }));
    expect(positions_deviation(galaxy_layout(seeded, physics, () => {}), hierarchy['galaxySeeded'])).toBeLessThan(1e-4);
  });
});
