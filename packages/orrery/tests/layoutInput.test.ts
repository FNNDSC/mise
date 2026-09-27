/**
 * @file The engines' input, built one way for a browser and a session:
 * radii against the space's largest metric, joins as parents, anchors in no
 * molecule, attrs carried, seeds and holds applied.
 */
import { describe, it, expect } from '@jest/globals';
import { layoutInput_build } from '../src/layout/layoutInput.js';
import { NODE_RADIUS } from '../src/layout/types.js';

describe('layoutInput_build', () => {
  it('sizes, groups, joins and carries as the engines expect', () => {
    const nodes = [
      { id: 'hub', parentIds: [], joinParentIds: [], metric: 1, ghost: true },
      { id: 'feed:1:0', parentIds: ['hub'], joinParentIds: [], metric: 4, attrs: { plugin: 'pl-a' } },
      { id: 'feed:1:1', parentIds: ['feed:1:0'], joinParentIds: ['feed:2:0'], metric: 2 },
    ];
    const keyOf = (n: { id: string }): string | null => (n.id.startsWith('feed:') ? n.id.split(':').slice(0, 2).join(':') : null);
    const input = layoutInput_build(nodes, keyOf, new Map([['feed:1:0', [1, 2, 3] as [number, number, number]]]), new Set(['feed:1:0']));
    expect(input[0]).toEqual({ id: 'hub', parents: [], radius: NODE_RADIUS * (0.5 + (1 / 4) * 1.2), group: null });
    expect(input[1]).toEqual({ id: 'feed:1:0', parents: ['hub'], radius: NODE_RADIUS * 1.7, group: 'feed:1', attrs: { plugin: 'pl-a' }, seed: [1, 2, 3], frozen: true });
    expect(input[2]?.parents).toEqual(['feed:1:0', 'feed:2:0']);
    expect(input[2]?.group).toBe('feed:1');
  });
});
