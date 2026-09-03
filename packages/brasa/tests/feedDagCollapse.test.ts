import { describe, it, expect, jest } from '@jest/globals';

// The salsa/cumin dist barrels defeat jest's CJS export scanner
// (RangeError); the projection under test needs none of their runtime.
jest.unstable_mockModule('@fnndsc/salsa', () => ({
  feedGraphData_ensure: jest.fn(),
  feedGraph_build: jest.fn(),
}));
jest.unstable_mockModule('@fnndsc/cumin', () => ({
  envelope_ok: (rendered: string, model?: unknown) => ({ status: 'ok', rendered, model }),
  envelope_error: (rendered: string) => ({ status: 'error', rendered }),
}));

const { feedDagModel_build } = await import('../src/builtins/res/feed.diagram.js');
type FeedNode = {
  id: number; pluginName: string; parentID: number | null; signature: string;
  joinParentIDs: number[]; status: string | null;
  startedAt?: string; finishedAt?: string; outputBytes?: number; computeResource?: string;
};
type FeedGraph = { feedID: number; title: string; rootIDs: number[]; nodes: FeedNode[] };

function node_make(overrides: Partial<FeedNode> & { id: number }): FeedNode {
  return {
    pluginName: 'pl-work',
    parentID: null,
    signature: 'sig',
    joinParentIDs: [],
    status: 'finishedSuccessfully',
    ...overrides,
  };
}

describe('feedDagModel_build (collapsed projection)', () => {
  const graph: FeedGraph = {
    feedID: 9,
    title: 'fan',
    rootIDs: [1],
    nodes: [
      node_make({ id: 1, pluginName: 'pl-dircopy', signature: 'root' }),
      node_make({
        id: 2, parentID: 1, signature: 'leafA',
        startedAt: '2026-01-01T00:00:00Z', finishedAt: '2026-01-01T00:00:10Z', outputBytes: 100, computeResource: 'host',
      }),
      node_make({
        id: 3, parentID: 1, signature: 'leafA',
        startedAt: '2026-01-01T00:00:00Z', finishedAt: '2026-01-01T00:00:20Z', outputBytes: 50, computeResource: 'galena',
      }),
      node_make({ id: 4, parentID: 1, signature: 'leafA', status: 'finishedWithError' }),
      node_make({ id: 5, parentID: 1, pluginName: 'pl-other', signature: 'leafB' }),
    ],
  };

  const model = feedDagModel_build(graph);

  it('collapses isomorphic siblings into one ×N node', () => {
    expect(model.nodes).toHaveLength(3);
    const group = model.nodes.find((n) => n.tally !== undefined);
    expect(group?.tally?.count).toBe(3);
    expect(group?.label).toBe('pl-work ×3');
    expect(group?.parentIds).toEqual(['1']);
  });

  it('a group wears its worst member status and lists anomalies', () => {
    const group = model.nodes.find((n) => n.tally !== undefined);
    expect(group?.status).toBe('finishedWithError');
    expect(group?.tally?.error).toBe(1);
    expect(group?.tally?.anomalies?.[0]?.id).toBe('4');
  });

  it('group metrics are member sums', () => {
    const group = model.nodes.find((n) => n.tally !== undefined);
    expect(group?.metrics?.computeSeconds).toBe(30);
    expect(group?.metrics?.dataBytes).toBe(150);
    // Members on different resources: the group says so rather than picking one.
    expect(group?.computeResource).toBe('mixed');
  });

  it('singletons pass through untouched (no tally, own status)', () => {
    const single = model.nodes.find((n) => n.pluginName === 'pl-other');
    expect(single?.tally).toBeUndefined();
    expect(single?.label).toBe('pl-other');
    const root = model.nodes.find((n) => n.id === '1');
    expect(root?.parentIds).toEqual([]);
  });
});
