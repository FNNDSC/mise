/**
 * @file The engine registry: every engine keeps the contract, is found by
 * name, and says what it needs before it runs.
 */
import { describe, it, expect } from '@jest/globals';
import { layoutEngines_list, layoutEngine_get, layoutNeeds_missing } from '../src/layout/registry.js';
import { PHYSICS_DEFAULT, type LayoutEngine, type LayoutNode } from '../src/layout/types.js';

/** A small space: one anchor, two molecules of two. */
function space(): LayoutNode[] {
  return [
    { id: 'hub', parents: [], radius: 0.3, group: null },
    { id: 'a0', parents: ['hub'], radius: 0.5, group: 'a', attrs: { metric: 3 } },
    { id: 'a1', parents: ['a0'], radius: 0.4, group: 'a', attrs: { metric: 1 } },
    { id: 'b0', parents: ['hub'], radius: 0.5, group: 'b' },
    { id: 'b1', parents: ['b0'], radius: 0.4, group: 'b' },
  ];
}

describe('layout registry', () => {
  it('offers the settled engines in order', () => {
    expect(layoutEngines_list().map((engine: LayoutEngine): string => engine.id)).toEqual(['galaxy', 'spokes', 'clumps', 'ranked', 'molecule']);
  });

  it('finds an engine by name and nothing by an unknown one', () => {
    expect(layoutEngine_get('spokes')?.label).toBe('SPOKES');
    expect(layoutEngine_get('nebula')).toBeUndefined();
  });

  it('places every node, and says when it is done', () => {
    for (const engine of layoutEngines_list()) {
      let last: number = 0;
      const result = engine.run({ nodes: space(), physics: PHYSICS_DEFAULT }, (fraction: number): void => { last = fraction; });
      expect(Object.keys(result.positions).sort()).toEqual(['a0', 'a1', 'b0', 'b1', 'hub']);
      for (const at of Object.values(result.positions)) expect(at.every((v: number): boolean => Number.isFinite(v))).toBe(true);
      expect(last).toBe(1);
    }
  });

  it('names what an engine needs and the nodes do not carry', () => {
    const needy: LayoutEngine = { id: 'constellations', label: 'CONSTELLATIONS', needs: ['plugins', 'metric'], run: () => ({ positions: {} }) };
    expect(layoutNeeds_missing(needy, space())).toEqual(['plugins']);
    expect(layoutNeeds_missing(layoutEngine_get('galaxy') as LayoutEngine, space())).toEqual([]);
  });
});
