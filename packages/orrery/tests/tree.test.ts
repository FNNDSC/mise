/**
 * @file How long a graph's edges run: the median and the longest, named, with anchors and halos left out.
 */
import { describe, it, expect } from '@jest/globals';
import { edgeSpan_of } from '../src/scene/tree.js';

const at = (entries: Array<[string, number]>): Map<string, { x: number; y: number; z: number }> =>
  new Map(entries.map(([id, x]) => [id, { x, y: 0, z: 0 }]));

describe('edgeSpan_of', () => {
  it('names the longest edge and the median, leaving a feed\'s tie to its anchor out', () => {
    const nodes = [
      { id: 'shape:a', parentIds: [], ghost: true, halo: true },
      { id: 'feed:1:0', parentIds: ['shape:a'] },
      { id: 'feed:1:1', parentIds: ['feed:1:0'] },
      { id: 'feed:1:2', parentIds: ['feed:1:1'] },
      { id: 'feed:1:3', parentIds: ['feed:1:2'] },
    ];
    const span = edgeSpan_of(nodes, at([['shape:a', 1000], ['feed:1:0', 0], ['feed:1:1', 2], ['feed:1:2', 4], ['feed:1:3', 104]]));
    expect(span.edgeMedian).toBe('2.0');
    expect(span.edgeLongest).toBe('100.0(feed:1:2->feed:1:3)');
  });

  it('says nothing for a graph without placed edges', () => {
    expect(edgeSpan_of([{ id: 'a', parentIds: [] }], at([['a', 0]]))).toEqual({});
    expect(edgeSpan_of([{ id: 'b', parentIds: ['a'] }], at([['b', 0]]))).toEqual({});
  });
});
