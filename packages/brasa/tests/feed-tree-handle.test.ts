import { jest, describe, it, expect, beforeEach } from '@jest/globals';

const feedGraphData_ensure = jest.fn(async (_id: number): Promise<void> => undefined);
const feedGraph_build = jest.fn();

jest.unstable_mockModule('@fnndsc/salsa', () => ({ feedGraphData_ensure, feedGraph_build }));
jest.unstable_mockModule('@fnndsc/cumin', () => ({
  envelope_ok: (rendered: string, model?: unknown) => ({ status: 'ok', rendered, model }),
  envelope_error: (rendered: string, _errors?: unknown, renderedErr?: string) => ({ status: 'error', rendered, renderedErr }),
}));

const { feedTree_handle } = await import('../src/builtins/res/feed.tree.js');

// eslint-disable-next-line no-control-regex
const strip = (s: string): string => s.replace(/\[[0-9;]*m/g, '');

function graph_fixture() {
  return {
    feedID: 5, title: 'brain', feedStatus: 'finishedSuccessfully',
    total: 2, shown: 2, truncated: false, rootIDs: [10],
    nodes: [
      { id: 10, pluginName: 'pl-root', parentID: null, signature: 'a', joinParentIDs: [], status: 'finishedSuccessfully' },
      { id: 11, pluginName: 'pl-a', parentID: 10, signature: 'b', joinParentIDs: [], status: 'started' },
    ],
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  process.exitCode = 0;
  feedGraph_build.mockReturnValue(graph_fixture());
});

describe('feedTree_handle', () => {
  it('loads metadata + joins then returns a feed.tree envelope', async () => {
    const env = await feedTree_handle(5, undefined, 0) as { status: string; rendered: string; model: { kind: string; data: { total: number } } };
    expect(feedGraphData_ensure).toHaveBeenCalledWith(5);
    expect(env.status).toBe('ok');
    expect(env.model.kind).toBe('feed.tree');
    expect(env.model.data.total).toBe(2);
    expect(strip(env.rendered)).toContain('pl-root_10');
  });

  it('errors when the feed is not found', async () => {
    feedGraph_build.mockReturnValue(null);
    const env = await feedTree_handle(999, undefined, 0) as { status: string; renderedErr: string };
    expect(env.status).toBe('error');
    expect(strip(env.renderedErr)).toContain('not found');
    expect(process.exitCode).toBe(1);
  });

  it('errors when the focus node is absent', async () => {
    const env = await feedTree_handle(5, 4242, 0) as { status: string; renderedErr: string };
    expect(env.status).toBe('error');
    expect(strip(env.renderedErr)).toContain('not in feed');
    expect(process.exitCode).toBe(1);
  });
});
