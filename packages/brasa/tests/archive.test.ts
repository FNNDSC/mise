/**
 * @file Tests for the directory-archive workflow.
 *
 * The archive exists because CUBE cannot hand over a directory (issue #233),
 * so what matters here is not only that it works but that every way it can
 * fail says which part of the platform is missing. A run that dies silently
 * leaves an operator with an unexplained feed and no file.
 */
import { jest, describe, it, expect, beforeEach } from '@jest/globals';

const dataGet = jest.fn();
const feedCreate = jest.fn();
const pipelineRun = jest.fn();
const pipelineReadiness = jest.fn();
const feedDelete = jest.fn();
const statusFetch = jest.fn();
const listRecursive = jest.fn();
const stackPush = jest.fn();

jest.unstable_mockModule('../src/lib/vfs/vfs.js', () => ({
  vfs: { data_get: dataGet },
}));
jest.unstable_mockModule('@fnndsc/salsa', () => ({
  feed_create: feedCreate,
  pipeline_run: pipelineRun,
  pipeline_readiness: pipelineReadiness,
  feed_delete: feedDelete,
  job_statusFetch: statusFetch,
  files_listRecursive: listRecursive,
}));
jest.unstable_mockModule('@fnndsc/cumin', () => ({
  errorStack: { stack_push: stackPush },
}));

const { directory_archive } = await import('../src/builtins/fs/archive.js');

/** A `/bin` listing containing pl-dircopy, which feed creation requires. */
const binWithDircopy = { ok: true, value: [{ name: 'pl-dircopy-v1.1.0' }] };

/** A feed whose pl-dircopy instance is 41. */
const feed = { id: 9, pluginInstance: { data: { id: 41 } } };

describe('directory_archive', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    dataGet.mockResolvedValue(binWithDircopy as never);
    feedCreate.mockResolvedValue(feed as never);
    pipelineReadiness.mockResolvedValue({ ready: true } as never);
    pipelineRun.mockResolvedValue({ ok: true, value: { workflowId: 3, pluginInstanceIds: [42] } } as never);
    feedDelete.mockResolvedValue(true as never);
    statusFetch.mockResolvedValue({ ok: true, value: 'finishedSuccessfully' } as never);
    listRecursive.mockResolvedValue([
      { path: 'feeds/feed_9/pl-dircopy_41/data/scan.dcm', type: 'file', size: 10 },
      { path: 'feeds/feed_9/pl-dircopy_41/pl-pfdorun_42/data/series.zip', type: 'file', size: 4096 },
    ] as never);
  });

  it('returns the file the pipeline produced', async () => {
    const result = await directory_archive('/home/me/series');

    expect(feedCreate).toHaveBeenCalledWith(['/home/me/series'], { title: 'Archive of series' });
    expect(pipelineRun).toHaveBeenCalledWith('zip v20240311', 41);
    expect(result).toEqual({
      path: 'feeds/feed_9/pl-dircopy_41/pl-pfdorun_42/data/series.zip',
      filename: 'series.zip',
      size: 4096,
    });
  });

  it('takes the archive from the pipeline output, not the copied input', async () => {
    // The dircopy stage republishes every source file. Matching on the archive
    // instance is what distinguishes the result from its own input.
    const result = await directory_archive('/home/me/series');

    expect(result?.filename).toBe('series.zip');
  });

  it('names the missing pipeline and where to get it', async () => {
    pipelineReadiness.mockResolvedValueOnce({ ready: false, reason: 'unregistered' } as never);

    const result = await directory_archive('/home/me/series');

    expect(result).toBeNull();
    const [, message] = stackPush.mock.calls.at(-1) as [string, string];
    expect(message).toContain('zip v20240311');
    expect(message).toContain('store');
  });

  it('distinguishes a pipeline that will not run from one that is absent', async () => {
    // Sending someone to the store for a pipeline already registered wastes
    // their time and contradicts the reason printed directly above.
    pipelineReadiness.mockResolvedValueOnce({ ready: false, reason: 'unpreparable' } as never);

    const result = await directory_archive('/home/me/series');

    expect(result).toBeNull();
    const [, message] = stackPush.mock.calls.at(-1) as [string, string];
    expect(message).toContain('registered but cannot run');
    expect(message).toContain('compute');
  });

  it('creates no feed when the pipeline cannot run', async () => {
    // A feed for a run that never happens is litter in someone's feed list and
    // an analysis in the compute graph that produced nothing.
    pipelineReadiness.mockResolvedValueOnce({ ready: false, reason: 'unpreparable' } as never);

    await directory_archive('/home/me/series');

    expect(feedCreate).not.toHaveBeenCalled();
  });

  it('removes the feed when the run fails after it was created', async () => {
    pipelineRun.mockResolvedValueOnce({ ok: false } as never);

    const result = await directory_archive('/home/me/series');

    expect(result).toBeNull();
    expect(feedDelete).toHaveBeenCalledWith(9);
  });

  it('names a feed it could not remove, so someone can', async () => {
    pipelineRun.mockResolvedValueOnce({ ok: false } as never);
    feedDelete.mockResolvedValueOnce(false as never);

    await directory_archive('/home/me/series');

    const [, message] = stackPush.mock.calls.at(-1) as [string, string];
    expect(message).toContain('feed 9');
  });

  it('names pl-dircopy when a feed cannot be created at all', async () => {
    dataGet.mockResolvedValueOnce({ ok: true, value: [{ name: 'pl-dcm2niix-v1.0.0' }] } as never);

    const result = await directory_archive('/home/me/series');

    expect(result).toBeNull();
    expect(feedCreate).not.toHaveBeenCalled();
    const [, message] = stackPush.mock.calls.at(-1) as [string, string];
    expect(message).toContain('pl-dircopy');
  });

  it('reports a failed archive job rather than looking for its output', async () => {
    statusFetch.mockResolvedValue({ ok: true, value: 'finishedWithError' } as never);

    const result = await directory_archive('/home/me/series');

    expect(result).toBeNull();
    expect(listRecursive).not.toHaveBeenCalled();
    expect(feedDelete).toHaveBeenCalledWith(9);
    const messages = stackPush.mock.calls.map((call) => (call as [string, string])[1]);
    expect(messages.some((m) => m.includes('finishedWithError'))).toBe(true);
  });

  it('leaves the feed alone when the job merely ran out of time', async () => {
    // It may yet finish. Deleting the feed would remove it from under a job
    // that is still going.
    statusFetch.mockResolvedValue({ ok: true, value: 'started' } as never);
    jest.useFakeTimers();
    const pending = directory_archive('/home/me/series');
    await jest.advanceTimersByTimeAsync(16 * 60 * 1000);
    const result = await pending;
    jest.useRealTimers();

    expect(result).toBeNull();
    expect(feedDelete).not.toHaveBeenCalled();
  });

  it('reports an empty output rather than returning a directory as the archive', async () => {
    listRecursive.mockResolvedValueOnce([
      { path: 'feeds/feed_9/pl-dircopy_41/pl-pfdorun_42/data', type: 'dir' },
    ] as never);

    const result = await directory_archive('/home/me/series');

    expect(result).toBeNull();
    const [, message] = stackPush.mock.calls.at(-1) as [string, string];
    expect(message).toContain('produced no file');
  });

  it('honours a deployment own archive pipeline', async () => {
    const previous: string | undefined = process.env['CHRIS_ARCHIVE_PIPELINE'];
    process.env['CHRIS_ARCHIVE_PIPELINE'] = 'local-zip v1';
    jest.resetModules();
    try {
      const fresh = await import('../src/builtins/fs/archive.js');
      await fresh.directory_archive('/home/me/series');
      expect(pipelineRun).toHaveBeenCalledWith('local-zip v1', 41);
    } finally {
      if (previous === undefined) delete process.env['CHRIS_ARCHIVE_PIPELINE'];
      else process.env['CHRIS_ARCHIVE_PIPELINE'] = previous;
    }
  });
});
