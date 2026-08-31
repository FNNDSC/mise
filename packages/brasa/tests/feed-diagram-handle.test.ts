import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { load as yamlLoad } from 'js-yaml';

const feedGraphData_ensure = jest.fn(async (_id: number): Promise<void> => undefined);
const feedGraph_build = jest.fn();

jest.unstable_mockModule('@fnndsc/salsa', () => ({ feedGraphData_ensure, feedGraph_build }));
jest.unstable_mockModule('@fnndsc/cumin', () => ({
  envelope_ok: (rendered: string, model?: unknown) => ({ status: 'ok', rendered, model }),
  envelope_error: (rendered: string, _e?: unknown, renderedErr?: string) => ({ status: 'error', rendered, renderedErr }),
}));

const { feedDiagram_handle, feedDag_handle, feedDagModel_build } = await import('../src/builtins/res/feed.diagram.js');

// eslint-disable-next-line no-control-regex
const strip = (s: string): string => s.replace(/\[[0-9;]*m/g, '');

function graph_fixture() {
  return {
    feedID: 5, title: 'brain', feedStatus: 'x', total: 2, shown: 2, truncated: false, rootIDs: [1],
    nodes: [
      { id: 1, pluginName: 'pl-a', parentID: null, signature: 'A', joinParentIDs: [], status: 'finishedSuccessfully' },
      { id: 2, pluginName: 'pl-b', parentID: 1, signature: 'B', joinParentIDs: [], status: 'started' },
    ],
  };
}

beforeEach(() => { jest.clearAllMocks(); process.exitCode = 0; feedGraph_build.mockReturnValue(graph_fixture()); });

describe('feedDagModel_build metrics', () => {
  it('projects wall time and output bytes when the cache observed them', () => {
    const graph = graph_fixture();
    graph.nodes[0] = {
      ...graph.nodes[0],
      startedAt: '2026-08-31T10:00:00Z',
      finishedAt: '2026-08-31T10:02:30Z',
      outputBytes: 4096,
    };
    const model = feedDagModel_build(graph);
    expect(model.nodes[0].metrics).toEqual({ computeSeconds: 150, dataBytes: 4096 });
    // A node the cache never timed carries no metrics at all.
    expect(model.nodes[1].metrics).toBeUndefined();
  });
});

describe('feedDiagram_handle', () => {
  it('emits a valid SignalFlow YAML document to stdout', async () => {
    const env = await feedDiagram_handle(5, 'signalflow') as { status: string; rendered: string; model: { kind: string; data: { dialect: string; nodes: number } } };
    expect(feedGraphData_ensure).toHaveBeenCalledWith(5);
    expect(env.status).toBe('ok');
    expect(env.model.kind).toBe('feed.dag');
    expect(env.model.data).toMatchObject({ feedId: 5, feedName: 'brain' });

    // The rendered text is parseable YAML describing a SignalFlow doc.
    const doc = yamlLoad(env.rendered) as { world: unknown; tree: { func: string; calls: Array<{ func: string }> } };
    expect(doc.world).toBeDefined();
    expect(doc.tree.func).toBe('pl-a_1');
    expect(doc.tree.calls[0].func).toBe('pl-b_2');
  });

  it('does not shell out — no renderer invoked, just text', async () => {
    const env = await feedDiagram_handle(5, 'signalflow') as { rendered: string };
    // Pure data: no "wrote to", no path, no degrade notice.
    expect(env.rendered).not.toMatch(/wrote|not found|signalflow renderer/i);
    expect(env.rendered).toContain('tree:');
  });

  it('errors when the feed is not found', async () => {
    feedGraph_build.mockReturnValue(null);
    const env = await feedDiagram_handle(999, 'signalflow') as { status: string; renderedErr: string };
    expect(env.status).toBe('error');
    expect(strip(env.renderedErr)).toContain('not found');
    expect(process.exitCode).toBe(1);
  });
});

describe('feedDagModel_build', () => {
  it('projects nodes with status, string edges, and the /proc data address', () => {
    const model = feedDagModel_build(graph_fixture() as never) as {
      feedId: number; nodes: Array<Record<string, unknown>>;
    };
    expect(model.feedId).toBe(5);
    expect(model.nodes[0]).toMatchObject({
      id: '1',
      parentIds: [],
      status: 'finishedSuccessfully',
      vfsPath: '/proc/jobs/feed_5/pl-a_1/data',
    });
    expect(model.nodes[1]).toMatchObject({ id: '2', parentIds: ['1'], status: 'started' });
  });

  it('degrades a status the vocabulary does not know to unknown', () => {
    const graph = graph_fixture();
    graph.nodes[0].status = 'transwarp';
    const model = feedDagModel_build(graph as never) as { nodes: Array<{ status: string }> };
    expect(model.nodes[0].status).toBe('unknown');
  });
});

describe('feedDag_handle', () => {
  it('renders the tree and carries the feed.dag model on one envelope', async () => {
    const env = await feedDag_handle(5, undefined, 500) as {
      status: string; rendered: string; model: { kind: string; data: { nodes: unknown[] } };
    };
    expect(env.status).toBe('ok');
    expect(env.rendered.length).toBeGreaterThan(0);
    expect(env.model.kind).toBe('feed.dag');
    expect(env.model.data.nodes).toHaveLength(2);
  });

  it('errors when the feed is not found', async () => {
    feedGraph_build.mockReturnValue(null);
    const env = await feedDag_handle(999, undefined, 500) as { status: string };
    expect(env.status).toBe('error');
  });
});
