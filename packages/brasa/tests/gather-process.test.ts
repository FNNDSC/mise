/**
 * @file Unit tests for `gather process`: one run over the whole cohort, off
 * the cohort's own feed when it has one, refusing what it cannot process.
 */
import { describe, it, expect, jest, beforeEach } from '@jest/globals';

/** The cohort the fake store holds, and what was written back. */
let cohort: { version: number; name: string | null; feed: { feedId: number; rootInstanceId: number; path: string } | null; series: Array<Record<string, unknown>> };
const written: unknown[] = [];
jest.unstable_mockModule('../src/builtins/res/gather.store.js', () => ({
  cohort_read: async () => cohort,
  cohort_write: async (state: unknown): Promise<void> => { written.push(state); },
}));

const mockFeedCreate = jest.fn();
jest.unstable_mockModule('@fnndsc/salsa', () => ({ feed_create: mockFeedCreate }));

let bin: { plugin?: { name: string }; pipeline?: { name: string } } = {};
jest.unstable_mockModule('../src/chris/binExecutables.js', () => ({ binExecutableMatches_get: async () => bin }));

const mockExecutePlugin = jest.fn();
jest.unstable_mockModule('../src/builtins/pluginExecute.js', () => ({ builtin_executePlugin: mockExecutePlugin }));
const mockPipeline = jest.fn();
jest.unstable_mockModule('../src/builtins/res/pipeline.js', () => ({ builtin_pipeline: mockPipeline }));
jest.unstable_mockModule('../src/builtins/feedCreation.js', () => ({ newFeed_cacheAdd: jest.fn(), run_follow: jest.fn() }));
const lines: string[] = [];
jest.unstable_mockModule('../src/core/sink.js', () => ({ sink_dataLine: (line: string): void => { lines.push(line); } }));

const { gather_process, gatherProcessArgs_parse } = await import('../src/builtins/res/gather.process.js');

const RUN = { kind: 'run.scheduled', data: { pluginName: 'pl-x', instanceId: 9, feedId: 300, newFeed: false, outputPath: '/o', status: 'finishedSuccessfully' } };

beforeEach(() => {
  cohort = {
    version: 1, name: 'sag cohort', feed: null,
    series: [
      { vfsPath: '/net/pacs/q/S1', kind: 'series', folderPath: '/home/u/SERVICES/PACS/s1' },
      { vfsPath: '/home/u/uploads/brain', kind: 'dir' },
    ],
  };
  written.length = 0;
  lines.length = 0;
  bin = { plugin: { name: 'pl-x' } };
  mockFeedCreate.mockReset();
  mockFeedCreate.mockResolvedValue({ id: 300, owner_username: 'u', pluginInstance: { data: { id: 400 } } });
  mockExecutePlugin.mockReset();
  mockExecutePlugin.mockResolvedValue({ status: 'ok', rendered: '', model: RUN });
  mockPipeline.mockReset();
  mockPipeline.mockResolvedValue({ status: 'ok', rendered: '', model: { kind: 'pipeline.scheduled', data: { feedId: 300, newFeed: false } } });
  process.exitCode = 0;
});

describe('gatherProcessArgs_parse', () => {
  it('takes a name, a title and --detach, and hands what follows -- to the run', () => {
    expect(gatherProcessArgs_parse(['pl-x', '--title', 'T', '--detach', '--', '--threshold', '0.5'])).toEqual({
      name: 'pl-x', title: 'T', detach: true, forwarded: ['--threshold', '0.5'], error: null,
    });
  });

  it('refuses no name, a second name, and an option of the run given before --', () => {
    expect(gatherProcessArgs_parse([]).error).toContain('name the plugin or pipeline');
    expect(gatherProcessArgs_parse(['pl-x', 'pl-y']).error).toContain('one plugin or pipeline at a time');
    expect(gatherProcessArgs_parse(['pl-x', '--threshold', '1']).error).toContain("--threshold: unknown option; the run's own arguments go after --");
  });
});

describe('gather process', () => {
  it('makes one feed holding every member, notes it on the cohort, and runs the plugin once off its root', async () => {
    const envelope = await gather_process(['pl-x', '--', '--threshold', '0.5']);
    expect(mockFeedCreate).toHaveBeenCalledWith(['/home/u/SERVICES/PACS/s1', '/home/u/uploads/brain'], { title: 'sag cohort' });
    expect(written).toEqual([{ ...cohort, feed: { feedId: 300, rootInstanceId: 400, path: '/home/u/feeds/feed_300/pl-dircopy_400/data' } }]);
    expect(mockExecutePlugin).toHaveBeenCalledWith('pl-x', ['--threshold', '0.5'], '/home/u/feeds/feed_300/pl-dircopy_400/data');
    // The feed was made by this line, so the answer says so.
    expect(envelope.model).toEqual({ ...RUN, data: { ...RUN.data, newFeed: true } });
  });

  it("runs off the cohort's own feed when it has one, copying nothing", async () => {
    cohort.feed = { feedId: 77, rootInstanceId: 78, path: '/home/u/feeds/feed_77/pl-dircopy_78/data' };
    const envelope = await gather_process(['pl-x', '--detach']);
    expect(mockFeedCreate).not.toHaveBeenCalled();
    expect(written).toEqual([]);
    expect(mockExecutePlugin).toHaveBeenCalledWith('pl-x', ['--detach'], '/home/u/feeds/feed_77/pl-dircopy_78/data');
    expect(envelope.model).toEqual(RUN);
  });

  it('runs a pipeline off the root by --previous', async () => {
    bin = { pipeline: { name: 'dcm-pipe' } };
    cohort.feed = { feedId: 77, rootInstanceId: 78, path: '/p' };
    await gather_process(['dcm-pipe', '--', '--x.memory_limit=8Gi']);
    expect(mockPipeline).toHaveBeenCalledWith(['run', 'dcm-pipe', '--previous', '78', '--x.memory_limit=8Gi']);
  });

  it('refuses an unpulled series by name, before it makes anything', async () => {
    cohort.series.push({ vfsPath: '/net/pacs/q/S2', kind: 'series', description: 'SAG T1' });
    const envelope = await gather_process(['pl-x']);
    expect(envelope.status).toBe('error');
    expect(envelope.renderedErr).toContain('1 series is not pulled yet (SAG T1); pull ${gather} first');
    expect(mockFeedCreate).not.toHaveBeenCalled();
  });

  it('refuses an empty cohort, a name /bin lacks, and a name that is both', async () => {
    cohort.series = [];
    expect((await gather_process(['pl-x'])).renderedErr).toContain('the cohort is empty');
    cohort.series = [{ vfsPath: '/d', kind: 'dir' }];
    bin = {};
    expect((await gather_process(['pl-nope'])).renderedErr).toContain('no plugin or pipeline named pl-nope in /bin');
    bin = { plugin: { name: 'x' }, pipeline: { name: 'x' } };
    expect((await gather_process(['x'])).renderedErr).toContain('names both a plugin and a pipeline');
    expect(mockFeedCreate).not.toHaveBeenCalled();
  });
});
