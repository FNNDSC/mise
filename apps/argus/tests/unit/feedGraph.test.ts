/**
 * @file A feed read into scene nodes the one way, for the RUNS pane and the
 * universe's descent alike (law a-feed-has-one-view).
 */
import { describe, it, expect } from '@jest/globals';
import type { FeedDagModel, FeedDagNode } from '@fnndsc/menu';
import { HUE_UNKNOWN, feedGraph_build, feedMetric_of, hueLegend_build } from '../../src/scene/feedGraph.js';

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

describe('feedMetric_of', () => {
  it('reads the metric the mode names, or nothing when the cache lacks it', () => {
    const a: FeedDagNode = model.nodes[0] as FeedDagNode;
    expect(feedMetric_of(a, 'time')).toBe(12);
    expect(feedMetric_of(a, 'size')).toBe(400);
    expect(feedMetric_of(model.nodes[1] as FeedDagNode, 'time')).toBeUndefined();
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

describe('feedGraph_build', () => {
  it('carries identity, edges, status, metric and count; every node solid; no hue under status', () => {
    const graph = feedGraph_build(model, { metric: 'size', hue: 'status', legend: new Map() });
    expect(graph.nodes.map((n) => n.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(graph.nodes[0]).toEqual({ id: 'a', label: 'a', parentIds: [], joinParentIds: [], status: 'finishedSuccessfully', metric: 400, solid: true });
    expect(graph.nodes.every((n) => n.solid === true)).toBe(true);
    expect(graph.payloads.get('b')?.tally?.count).toBe(3);
    expect(graph.nodes[1]?.count).toBe(3);
    expect(graph.nodes[3]?.joinParentIds).toEqual(['a']);
    expect(graph.nodes.every((n) => n.hue === undefined)).toBe(true);
  });

  it('under the compute hue, a node wears its resource colour, or the grey when none is known', () => {
    const graph = feedGraph_build(model, { metric: 'time', hue: 'compute', legend: hueLegend_build(model, ['#1', '#2']) });
    expect(graph.nodes.map((n) => n.hue)).toEqual(['#1', '#2', HUE_UNKNOWN, HUE_UNKNOWN]);
  });
});

describe('one reading for both doors', () => {
  it('the descent\'s door scopes the ids and its edges with them; the look is the same as the roster\'s', () => {
    const roster = feedGraph_build(model, { metric: 'time', hue: 'status', legend: new Map() });
    const descent = feedGraph_build(model, { metric: 'time', hue: 'status', legend: new Map(), id_of: (id: string): string => `inst:7:${id}` });
    expect(descent.nodes.map((n) => n.id)).toEqual(['inst:7:a', 'inst:7:b', 'inst:7:c', 'inst:7:d']);
    expect(descent.nodes[3]?.parentIds).toEqual(['inst:7:b']);
    expect(descent.nodes[3]?.joinParentIds).toEqual(['inst:7:a']);
    const look = (n: { status?: string; metric?: number; count?: number; solid?: boolean; hue?: string; label?: string }) => ({ status: n.status, metric: n.metric, count: n.count, solid: n.solid, hue: n.hue, label: n.label });
    expect(descent.nodes.map(look)).toEqual(roster.nodes.map(look));
    expect(descent.payloads.get('inst:7:b')?.id).toBe('b');
  });

  it('a ×N group wears its errored share; a parent beyond the model is no edge', () => {
    const grouped: FeedDagModel = { nodes: [
      node_make('r'),
      node_make('g', { parentIds: ['r', 'gone'], status: 'finishedWithError', tally: { count: 10, done: 6, error: 4, running: 0, other: 0 } }),
    ] } as unknown as FeedDagModel;
    const graph = feedGraph_build(grouped, { metric: 'time', hue: 'status', legend: new Map() });
    expect(graph.nodes[1]).toMatchObject({ count: 10, share: 0.4, parentIds: ['r'] });
    expect(graph.nodes[0]?.share).toBeUndefined();
  });
});
