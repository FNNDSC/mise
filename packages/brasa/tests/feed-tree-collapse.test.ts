import { describe, it, expect } from '@jest/globals';
import { collapse_build, CollapsedNode } from '../src/builtins/res/feed.tree.collapse.js';
import type { FeedGraph, FeedNode } from '@fnndsc/salsa';

function node(id: number, parentID: number | null, pluginName: string, signature: string, status: string | null, joins: number[] = []): FeedNode {
  return { id, pluginName, parentID, signature, joinParentIDs: joins, status };
}

function graph(nodes: FeedNode[], rootIDs: number[]): FeedGraph {
  return { feedID: 1, title: 't', feedStatus: 'x', total: nodes.length, shown: nodes.length, truncated: false, rootIDs, nodes };
}

describe('collapse_build', () => {
  it('merges isomorphic siblings into one ×N group with a status tally', () => {
    const g = graph([
      node(1, null, 'pl-root', 'r', 'finishedSuccessfully'),
      node(10, 1, 'pl-a', 'A', 'finishedSuccessfully'),
      node(11, 1, 'pl-a', 'A', 'finishedSuccessfully'),
      node(12, 1, 'pl-a', 'A', 'finishedWithError'),
    ], [1]);

    const roots: CollapsedNode[] = collapse_build(g, [1]);
    expect(roots).toHaveLength(1);
    const group = roots[0].children[0];
    expect(group.pluginName).toBe('pl-a');
    expect(group.count).toBe(3);
    expect(group.memberIds).toEqual([10, 11, 12]);
    expect(group.tally).toEqual({ done: 2, error: 1, running: 0, other: 0, total: 3 });
  });

  it('surfaces anomalies error-first, and keeps a singleton as count 1', () => {
    const g = graph([
      node(1, null, 'pl-root', 'r', 'finishedSuccessfully'),
      node(10, 1, 'pl-a', 'A', 'started'),
      node(11, 1, 'pl-a', 'A', 'finishedWithError'),
      node(12, 1, 'pl-solo', 'S', 'finishedSuccessfully'),
    ], [1]);

    const roots = collapse_build(g, [1]);
    const group = roots[0].children.find((c) => c.pluginName === 'pl-a')!;
    expect(group.count).toBe(2);
    expect(group.anomalies.map((a) => a.id)).toEqual([11, 10]); // error (11) before running (10)

    const solo = roots[0].children.find((c) => c.pluginName === 'pl-solo')!;
    expect(solo.count).toBe(1);
  });

  it('pools and regroups children under a collapsed parent', () => {
    const g = graph([
      node(1, null, 'pl-root', 'r', 'finishedSuccessfully'),
      node(10, 1, 'pl-a', 'A', 'finishedSuccessfully'),
      node(11, 1, 'pl-a', 'A', 'finishedSuccessfully'),
      node(20, 10, 'pl-b', 'B', 'finishedSuccessfully'),
      node(21, 11, 'pl-b', 'B', 'finishedSuccessfully'),
    ], [1]);

    const group = collapse_build(g, [1])[0].children[0];
    expect(group.count).toBe(2);
    expect(group.children).toHaveLength(1);
    expect(group.children[0].pluginName).toBe('pl-b');
    expect(group.children[0].count).toBe(2);
    expect(group.children[0].memberIds).toEqual([20, 21]);
  });

  it('keeps join sources on a singleton', () => {
    const g = graph([
      node(1, null, 'pl-root', 'r', 'finishedSuccessfully'),
      node(9, 1, 'pl-topologicalcopy', 'T', 'finishedSuccessfully', [7, 8]),
    ], [1]);
    const ts = collapse_build(g, [1])[0].children[0];
    expect(ts.count).toBe(1);
    expect(ts.joinParentIDs).toEqual([7, 8]);
    expect(ts.hasJoin).toBe(true);
  });
});
