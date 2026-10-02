/**
 * @file A feed's DAG read into scene nodes under the pane's modes.
 */
import { describe, it, expect } from '@jest/globals';
import type { FeedDagModel, FeedDagNode } from '@fnndsc/menu';
import { HUE_UNKNOWN, dagGraph_build, dagMetric_of, hueLegend_build } from '../../src/features/dag/sceneGraph.js';

function node_make(id: string, extra: Partial<FeedDagNode> = {}): FeedDagNode {
  return { id, label: id, parentIds: [], joinParentIds: [], status: 'finishedSuccessfully', vfsPath: `/f/${id}`, instanceId: 1, ...extra } as FeedDagNode;
}

const model: FeedDagModel = {
  nodes: [
    node_make('a', { computeResource: 'host', metrics: { computeSeconds: 12, dataBytes: 400 } }),
    node_make('b', { parentIds: ['a'], computeResource: 'gpu', tally: { count: 3 } }),
    node_make('c', { parentIds: ['b'], computeResource: 'mixed' }),
    node_make('d', { parentIds: ['b'], joinParentIds: ['a'] }),
  ],
} as unknown as FeedDagModel;

describe('dagMetric_of', () => {
  it('reads the metric the mode names, or nothing when the cache lacks it', () => {
    const a: FeedDagNode = model.nodes[0] as FeedDagNode;
    expect(dagMetric_of(a, 'time')).toBe(12);
    expect(dagMetric_of(a, 'size')).toBe(400);
    expect(dagMetric_of(model.nodes[1] as FeedDagNode, 'time')).toBeUndefined();
  });
});

describe('hueLegend_build', () => {
  it('assigns the cycle in order of first appearance, skipping mixed and unknown', () => {
    const legend: Map<string, string> = hueLegend_build(model, ['#1', '#2']);
    expect([...legend]).toEqual([['host', '#1'], ['gpu', '#2']]);
  });

  it('wraps the cycle and survives an empty one', () => {
    const wide: FeedDagModel = { nodes: [node_make('x', { computeResource: 'r1' }), node_make('y', { computeResource: 'r2' }), node_make('z', { computeResource: 'r3' })] } as unknown as FeedDagModel;
    expect([...hueLegend_build(wide, ['#1', '#2']).values()]).toEqual(['#1', '#2', '#1']);
    expect([...hueLegend_build(wide, []).values()]).toEqual(['#888', '#888', '#888']);
  });
});

describe('dagGraph_build', () => {
  it('carries identity, edges, status, metric and count; no hue under status', () => {
    const graph = dagGraph_build(model, 'size', 'status', new Map());
    expect(graph.nodes.map((n) => n.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(graph.nodes[0]).toEqual({ id: 'a', label: 'a', parentIds: [], joinParentIds: [], status: 'finishedSuccessfully', metric: 400, count: undefined });
    expect(graph.nodes[1]?.count).toBe(3);
    expect(graph.nodes[3]?.joinParentIds).toEqual(['a']);
    expect(graph.nodes.every((n) => n.hue === undefined)).toBe(true);
  });

  it('under the compute hue, a node wears its resource colour, or the grey when none is known', () => {
    const graph = dagGraph_build(model, 'time', 'compute', hueLegend_build(model, ['#1', '#2']));
    expect(graph.nodes.map((n) => n.hue)).toEqual(['#1', '#2', HUE_UNKNOWN, HUE_UNKNOWN]);
  });
});
