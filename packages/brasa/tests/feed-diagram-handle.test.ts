import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { existsSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

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

const saved = process.env.SIGNALFLOW_BIN;
beforeEach(() => { jest.clearAllMocks(); process.exitCode = 0; feedGraph_build.mockReturnValue(graph_fixture()); });
afterEach(() => { if (saved === undefined) delete process.env.SIGNALFLOW_BIN; else process.env.SIGNALFLOW_BIN = saved; });

describe('feedDiagram_handle', () => {
  it('degrades gracefully when SignalFlow is not found', async () => {
    process.env.SIGNALFLOW_BIN = '/no/such/signalflow-xyz';
    const env = await feedDiagram_handle(5, {}) as { status: string; rendered: string };
    expect(env.status).toBe('ok');
    expect(strip(env.rendered)).toContain('not found');
    expect(strip(env.rendered)).toContain('feed tree 5');
  });

  it('writes an ASCII diagram to a file via the renderer', async () => {
    process.env.SIGNALFLOW_BIN = 'cat'; // stand-in: echoes the input doc as "render"
    const out = join(tmpdir(), `feed-test-${Date.now()}.txt`);
    const env = await feedDiagram_handle(5, { out }) as { status: string; rendered: string; model: { data: { outPath: string } } };
    expect(env.status).toBe('ok');
    expect(strip(env.rendered)).toContain('Wrote diagram (2 nodes)');
    expect(env.model.data.outPath).toBe(out);
    expect(existsSync(out)).toBe(true);
    expect(readFileSync(out, 'utf8')).toContain('"tree"'); // the SignalFlow doc round-tripped
    rmSync(out, { force: true });
  });

  it('returns the ASCII inline in --stdout mode', async () => {
    process.env.SIGNALFLOW_BIN = 'cat';
    const env = await feedDiagram_handle(5, { toStdout: true }) as { status: string; rendered: string };
    expect(env.rendered).toContain('"module"'); // doc content, not a "wrote to" message
    expect(env.rendered).not.toContain('Wrote diagram');
  });

  it('reports an SVG write', async () => {
    process.env.SIGNALFLOW_BIN = 'true'; // exits 0, writes nothing
    const env = await feedDiagram_handle(5, { svg: true, out: '/tmp/x.svg' }) as { status: string; rendered: string };
    expect(strip(env.rendered)).toContain('Wrote SVG diagram');
  });

  it('surfaces a SignalFlow non-zero exit as an error', async () => {
    process.env.SIGNALFLOW_BIN = 'false'; // exits 1
    const env = await feedDiagram_handle(5, {}) as { status: string; renderedErr: string };
    expect(env.status).toBe('error');
    expect(strip(env.renderedErr)).toContain('SignalFlow error');
    expect(process.exitCode).toBe(1);
  });

  it('errors when the feed is not found', async () => {
    feedGraph_build.mockReturnValue(null);
    const env = await feedDiagram_handle(999, {}) as { status: string; renderedErr: string };
    expect(env.status).toBe('error');
    expect(strip(env.renderedErr)).toContain('not found');
    expect(process.exitCode).toBe(1);
  });
});
