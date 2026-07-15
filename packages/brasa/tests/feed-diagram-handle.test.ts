import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { load as yamlLoad } from 'js-yaml';

const feedGraphData_ensure = jest.fn(async (_id: number): Promise<void> => undefined);
const feedGraph_build = jest.fn();

jest.unstable_mockModule('@fnndsc/salsa', () => ({ feedGraphData_ensure, feedGraph_build }));
jest.unstable_mockModule('@fnndsc/cumin', () => ({
  envelope_ok: (rendered: string, model?: unknown) => ({ status: 'ok', rendered, model }),
  envelope_error: (rendered: string, _e?: unknown, renderedErr?: string) => ({ status: 'error', rendered, renderedErr }),
}));

const { feedDiagram_handle } = await import('../src/builtins/res/feed.diagram.js');

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

describe('feedDiagram_handle', () => {
  it('emits a valid SignalFlow YAML document to stdout', async () => {
    const env = await feedDiagram_handle(5, 'signalflow') as { status: string; rendered: string; model: { kind: string; data: { dialect: string; nodes: number } } };
    expect(feedGraphData_ensure).toHaveBeenCalledWith(5);
    expect(env.status).toBe('ok');
    expect(env.model.kind).toBe('feed.diagram');
    expect(env.model.data).toMatchObject({ feedID: 5, dialect: 'signalflow', nodes: 2 });

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
