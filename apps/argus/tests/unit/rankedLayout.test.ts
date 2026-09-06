/**
 * @file Unit tests for the ranked layout.
 *
 * This is the layout a preview card and the stage both draw, so the thing
 * worth pinning is not that it produces some arrangement but that it
 * produces the SAME one every time — a card and the detail it previews
 * disagreeing was the defect that made it shared in the first place.
 *
 * Testable at all only because it is dependency-free: the scene around it
 * needs three.js, which will not load here.
 */

import { describe, it, expect } from '@jest/globals';
import {
  rankedLayout_compute,
  type RankedInput,
  type RankedLayout,
  type RankedPlacement,
} from '../../src/scene/rankedLayout.js';

/** The tier a node landed on. */
function tier_of(layout: RankedLayout, id: string): number | undefined {
  return layout.placements.find((p: RankedPlacement): boolean => p.id === id)?.tier;
}

/** The slot a node landed on. */
function x_of(layout: RankedLayout, id: string): number | undefined {
  return layout.placements.find((p: RankedPlacement): boolean => p.id === id)?.x;
}

/** A linear chain a → b → c. */
const CHAIN: RankedInput[] = [
  { id: 'a', parentIds: [] },
  { id: 'b', parentIds: ['a'] },
  { id: 'c', parentIds: ['b'] },
];

describe('rankedLayout_compute', () => {
  it('places a chain one tier per step, all in one column', () => {
    const layout: RankedLayout = rankedLayout_compute(CHAIN);
    expect(tier_of(layout, 'a')).toBe(0);
    expect(tier_of(layout, 'b')).toBe(1);
    expect(tier_of(layout, 'c')).toBe(2);
    expect(layout.tierCount).toBe(3);
    expect(new Set(layout.placements.map((p: RankedPlacement): number => p.x)).size).toBe(1);
  });

  it('centres a parent over the span of its children', () => {
    const layout: RankedLayout = rankedLayout_compute([
      { id: 'root', parentIds: [] },
      { id: 'l', parentIds: ['root'] },
      { id: 'r', parentIds: ['root'] },
    ]);
    const left: number = x_of(layout, 'l') as number;
    const right: number = x_of(layout, 'r') as number;
    expect(x_of(layout, 'root')).toBeCloseTo((left + right) / 2);
  });

  it('gives a join the deepest of its parents, not the shallowest', () => {
    // c waits for both a (tier 0) and b (tier 1), so it belongs below b.
    const layout: RankedLayout = rankedLayout_compute([
      { id: 'a', parentIds: [] },
      { id: 'b', parentIds: ['a'] },
      { id: 'c', parentIds: ['a', 'b'] },
    ]);
    expect(tier_of(layout, 'c')).toBe(2);
  });

  it('lands the same graph the same way whatever order it arrives in', () => {
    const forward: RankedLayout = rankedLayout_compute([
      { id: 'root', parentIds: [] },
      { id: 'a', parentIds: ['root'] },
      { id: 'b', parentIds: ['root'] },
      { id: 'c', parentIds: ['root'] },
    ]);
    const shuffled: RankedLayout = rankedLayout_compute([
      { id: 'c', parentIds: ['root'] },
      { id: 'b', parentIds: ['root'] },
      { id: 'root', parentIds: [] },
      { id: 'a', parentIds: ['root'] },
    ]);
    for (const id of ['root', 'a', 'b', 'c']) {
      expect(x_of(shuffled, id)).toBe(x_of(forward, id));
      expect(tier_of(shuffled, id)).toBe(tier_of(forward, id));
    }
  });

  it('orders siblings numerically, so step 10 follows step 9', () => {
    const layout: RankedLayout = rankedLayout_compute([
      { id: 'root', parentIds: [] },
      { id: 'step9', parentIds: ['root'] },
      { id: 'step10', parentIds: ['root'] },
    ]);
    expect(x_of(layout, 'step9')).toBeLessThan(x_of(layout, 'step10') as number);
  });

  it('hangs a node from its first present parent, ignoring absent ones', () => {
    const layout: RankedLayout = rankedLayout_compute([
      { id: 'a', parentIds: [] },
      { id: 'b', parentIds: ['nowhere', 'a'] },
    ]);
    expect(tier_of(layout, 'b')).toBe(1);
  });

  it('treats a node whose parents are all absent as a root', () => {
    const layout: RankedLayout = rankedLayout_compute([
      { id: 'orphan', parentIds: ['gone'] },
    ]);
    expect(tier_of(layout, 'orphan')).toBe(0);
    expect(layout.tierCount).toBe(1);
  });

  it('still places every node when the graph contains a cycle', () => {
    const layout: RankedLayout = rankedLayout_compute([
      { id: 'a', parentIds: ['b'] },
      { id: 'b', parentIds: ['a'] },
    ]);
    expect(layout.placements).toHaveLength(2);
    for (const placement of layout.placements) {
      expect(Number.isFinite(placement.x)).toBe(true);
      expect(Number.isFinite(placement.tier)).toBe(true);
    }
  });

  it('answers an empty graph without throwing', () => {
    const layout: RankedLayout = rankedLayout_compute([]);
    expect(layout.placements).toHaveLength(0);
    expect(layout.tierCount).toBe(1);
    expect(layout.width).toBe(0);
  });

  it('reports a width a renderer can scale by', () => {
    const wide: RankedLayout = rankedLayout_compute([
      { id: 'root', parentIds: [] },
      { id: 'a', parentIds: ['root'] },
      { id: 'b', parentIds: ['root'] },
      { id: 'c', parentIds: ['root'] },
    ]);
    expect(wide.width).toBe(2);
    expect(rankedLayout_compute(CHAIN).width).toBe(0);
  });
});
