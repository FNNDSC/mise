/**
 * Boundary-only tests for the /proc provider and its cache/warmup functions.
 * Seams: cumin chrisConnection.client_get (stub) and salsa jobs/index (stub).
 * Real procCache / Result run.
 */
const mockClientGet = jest.fn();
const mockJobs = {
  job_cancel: jest.fn(),
  job_delete: jest.fn(),
  job_statusFetch: jest.fn(),
  job_logFetch: jest.fn(),
  jobs_statusBatch: jest.fn(),
};

jest.mock('@fnndsc/cumin', () => ({
  ...jest.requireActual('@fnndsc/cumin'),
  chrisConnection: { client_get: mockClientGet },
}));
jest.mock('../src/jobs/index', () => mockJobs);

import { procCache_get, Ok, Err, ProcFeed } from '@fnndsc/cumin';
import {
  ProcVfsProvider,
  feedStatus_derive,
  procPath_parse,
  procTopology_warmup,
  procCache_refresh,
  procFeed_ensureLoaded,
} from '../src/vfs/providers/proc';

const cache = procCache_get();
const provider = new ProcVfsProvider();

function feed(over: Partial<ProcFeed> = {}): ProcFeed {
  return {
    id: 1, title: 'f', creationDate: '', finishedJobs: 0, erroredJobs: 0,
    startedJobs: 0, scheduledJobs: 0, cancelledJobs: 0, createdJobs: 0, ...over,
  };
}

/** Fake chrisapi client that paginates a fixed set of rows. */
function pagingClient(feeds: unknown[] = [], instances: unknown[] = []) {
  return {
    getFeeds: jest.fn().mockResolvedValue({ data: feeds }),
    getPluginInstances: jest.fn().mockResolvedValue({ data: instances }),
    getPluginInstance: jest.fn(),
  };
}

beforeEach(() => {
  cache.cache_clear();
  jest.clearAllMocks();
});

describe('feedStatus_derive', () => {
  it('prioritises errors', () => {
    expect(feedStatus_derive(feed({ erroredJobs: 1, finishedJobs: 5 }))).toBe('finishedWithError');
  });
  it('reports running when jobs are active', () => {
    expect(feedStatus_derive(feed({ startedJobs: 1 }))).toBe('running');
    expect(feedStatus_derive(feed({ scheduledJobs: 1 }))).toBe('running');
    expect(feedStatus_derive(feed({ createdJobs: 1 }))).toBe('running');
  });
  it('reports cancelled only when nothing finished', () => {
    expect(feedStatus_derive(feed({ cancelledJobs: 1 }))).toBe('cancelled');
  });
  it('reports success when finished', () => {
    expect(feedStatus_derive(feed({ finishedJobs: 2 }))).toBe('finishedSuccessfully');
  });
  it('reports empty otherwise', () => {
    expect(feedStatus_derive(feed())).toBe('empty');
  });
});

describe('procPath_parse', () => {
  it('parses a feed path', () => {
    expect(procPath_parse('/proc/feeds/feed_5')).toEqual({ feedID: 5, instanceID: null, virtualFile: null });
  });
  it('parses an instance path', () => {
    expect(procPath_parse('/proc/feeds/feed_5/pl-dircopy_10')).toEqual({
      feedID: 5, instanceID: 10, virtualFile: null,
    });
  });
  it('parses a feed virtual file', () => {
    expect(procPath_parse('/proc/feeds/feed_5/status')).toEqual({
      feedID: 5, instanceID: null, virtualFile: 'status',
    });
  });
  it('parses an instance virtual file', () => {
    expect(procPath_parse('/proc/feeds/feed_5/pl-x_10/status')).toEqual({
      feedID: 5, instanceID: 10, virtualFile: 'status',
    });
  });
  it('returns nulls for a non-feed path', () => {
    expect(procPath_parse('/proc/feeds/other')).toEqual({ feedID: null, instanceID: null, virtualFile: null });
  });
});

describe('ProcVfsProvider.list', () => {
  beforeEach(() => cache.built_set());

  it('lists all feeds at /proc/jobs with derived status', async () => {
    cache.feed_add(feed({ id: 1, title: 'brain', finishedJobs: 1 }));
    cache.feed_add(feed({ id: 2, title: 'spine', erroredJobs: 1 }));
    const r = await provider.list('/proc/jobs');
    expect(r.ok).toBe(true);
    const items = r.ok ? r.value : [];
    expect(items.map((i) => i.name).sort()).toEqual(['feed_1', 'feed_2']);
    expect(items.find((i) => i.name === 'feed_2')?.status).toBe('finishedWithError');
  });

  it('lists root instances + virtual files for a feed', async () => {
    cache.feed_add(feed({ id: 5 }));
    cache.instance_add({ id: 10, feedID: 5, parentID: null, pluginName: 'pl-dircopy', params: null });
    cache.topologyLoaded_mark(5);
    mockJobs.jobs_statusBatch.mockResolvedValue(new Map([[10, 'running']]));

    const r = await provider.list('/proc/feeds/feed_5');
    const items = r.ok ? r.value : [];
    expect(items.filter((i) => i.type === 'file').map((i) => i.name)).toEqual(['status', 'title']);
    expect(items.find((i) => i.type === 'job')).toMatchObject({ name: 'pl-dircopy_10', status: 'running' });
  });

  it('returns [] for an unknown feed', async () => {
    cache.topologyLoaded_mark(9);
    const r = await provider.list('/proc/feeds/feed_9');
    expect(r.ok && r.value).toEqual([]);
  });

  it('lists children + virtual files for an instance', async () => {
    cache.feed_add(feed({ id: 5 }));
    cache.instance_add({ id: 10, feedID: 5, parentID: null, pluginName: 'pl-root', params: null });
    cache.instance_add({ id: 11, feedID: 5, parentID: 10, pluginName: 'pl-child', params: null });
    cache.topologyLoaded_mark(5);
    mockJobs.jobs_statusBatch.mockResolvedValue(new Map([[11, 'finishedSuccessfully']]));

    const r = await provider.list('/proc/feeds/feed_5/pl-root_10');
    const items = r.ok ? r.value : [];
    expect(items.filter((i) => i.type === 'file').map((i) => i.name)).toEqual(['status', 'params', 'log']);
    expect(items.find((i) => i.type === 'job')).toMatchObject({ name: 'pl-child_11', status: 'finishedSuccessfully' });
  });
});

describe('ProcVfsProvider.read', () => {
  beforeEach(() => {
    cache.built_set();
    cache.feed_add(feed({ id: 5, title: 'brain', finishedJobs: 1 }));
    cache.instance_add({ id: 10, feedID: 5, parentID: null, pluginName: 'pl-x', params: null });
    cache.topologyLoaded_mark(5);
  });

  it('reads feed status and title', async () => {
    const s = await provider.read('/proc/feeds/feed_5/status');
    expect(s.ok && s.value).toBe('finishedSuccessfully');
    const t = await provider.read('/proc/feeds/feed_5/title');
    expect(t.ok && t.value).toBe('brain');
  });

  it('reads instance status live', async () => {
    mockJobs.job_statusFetch.mockResolvedValue(Ok('running'));
    const r = await provider.read('/proc/feeds/feed_5/pl-x_10/status');
    expect(r.ok && r.value).toBe('running');
  });

  it('falls back to "unknown" when status fetch fails', async () => {
    mockJobs.job_statusFetch.mockResolvedValue(Err());
    const r = await provider.read('/proc/feeds/feed_5/pl-x_10/status');
    expect(r.ok && r.value).toBe('unknown');
  });

  it('fetches + caches params on first read, filtering meta keys', async () => {
    mockClientGet.mockResolvedValue({
      getPluginInstance: jest.fn().mockResolvedValue({
        data: { id: 10, feed_id: 5, plugin_name: 'pl-x', status: 'x', previous_id: null, dir: '/in', k: 'v' },
      }),
    });
    const r = await provider.read('/proc/feeds/feed_5/pl-x_10/params');
    expect(r.ok && r.value).toContain('dir=/in');
    expect(r.ok && r.value).toContain('k=v');
    expect(r.ok && r.value).not.toContain('plugin_name');
    // cached now -> params_render from cache
    expect(cache.instance_get(10)?.params).toMatchObject({ dir: '/in' });
  });

  it('reads instance log', async () => {
    mockJobs.job_logFetch.mockResolvedValue(Ok('hello log'));
    const r = await provider.read('/proc/feeds/feed_5/pl-x_10/log');
    expect(r.ok && r.value).toBe('hello log');
  });

  it('returns "" for an unknown feed file', async () => {
    const r = await provider.read('/proc/feeds/feed_999/status');
    expect(r.ok && r.value).toBe('');
  });
});

describe('ProcVfsProvider.rm', () => {
  beforeEach(() => {
    cache.built_set();
    cache.feed_add(feed({ id: 5 }));
    cache.instance_add({ id: 10, feedID: 5, parentID: null, pluginName: 'pl-x', params: null });
    cache.topologyLoaded_mark(5);
  });

  it('cancels non-terminal jobs then removes a feed', async () => {
    mockJobs.jobs_statusBatch.mockResolvedValue(new Map([[10, 'running']]));
    mockJobs.job_cancel.mockResolvedValue(Ok(true));
    expect(await provider.rm('/proc/feeds/feed_5')).toBe(true);
    expect(mockJobs.job_cancel).toHaveBeenCalledWith(10);
    expect(cache.feed_get(5)).toBeUndefined();
  });

  it('cancels a non-terminal instance', async () => {
    mockJobs.job_statusFetch.mockResolvedValue(Ok('running'));
    mockJobs.job_cancel.mockResolvedValue(Ok(true));
    expect(await provider.rm('/proc/feeds/feed_5/pl-x_10')).toBe(true);
    expect(mockJobs.job_cancel).toHaveBeenCalledWith(10);
  });

  it('deletes a terminal instance and drops it from the cache', async () => {
    mockJobs.job_statusFetch.mockResolvedValue(Ok('finishedSuccessfully'));
    mockJobs.job_delete.mockResolvedValue(Ok(true));
    expect(await provider.rm('/proc/feeds/feed_5/pl-x_10')).toBe(true);
    expect(cache.instance_get(10)).toBeUndefined();
  });

  it('returns false for an unparseable path', async () => {
    expect(await provider.rm('/proc/feeds/garbage')).toBe(false);
  });

  it('cp/mv/mkdir/touch/upload/write are unsupported', async () => {
    expect(await provider.cp('a', 'b')).toBe(false);
    expect(await provider.mv('a', 'b')).toBe(false);
    expect(await provider.mkdir('a')).toBe(false);
    expect(await provider.touch('a')).toBe(false);
    expect(await provider.upload('a', 'b')).toBe(false);
    expect(await provider.write('a', 'b')).toBe(false);
  });
});

describe('cache build / warmup / refresh', () => {
  it('procTopology_warmup sweeps instances and completes', async () => {
    cache.built_set();
    mockClientGet.mockResolvedValue(
      pagingClient([], [{ id: 10, feed_id: 5, previous_id: null, plugin_name: 'pl-x', status: 's' }])
    );
    await procTopology_warmup();
    expect(cache.warmupComplete).toBe(true);
    expect(cache.instance_get(10)).toBeDefined();
    expect(cache.feed_get(5)).toBeDefined();
  });

  it('procTopology_warmup bails when not connected', async () => {
    cache.built_set();
    mockClientGet.mockResolvedValue(null);
    await procTopology_warmup();
    expect(cache.warmupComplete).toBe(false);
  });

  it('procFeed_ensureLoaded adds a placeholder feed and loads instances', async () => {
    cache.built_set();
    mockClientGet.mockResolvedValue(
      pagingClient([], [{ id: 20, feed_id: 7, previous_id: null, plugin_name: 'pl-y', status: 's' }])
    );
    await procFeed_ensureLoaded(7);
    expect(cache.feed_get(7)).toBeDefined();
    expect(cache.instance_get(20)).toBeDefined();
  });

  it('procCache_refresh(feedID) re-fetches a single feed', async () => {
    cache.built_set();
    cache.feed_add(feed({ id: 5, title: 'old' }));
    mockClientGet.mockResolvedValue(
      pagingClient([{ id: 5, name: 'new', finished_jobs: 3 }], [])
    );
    await procCache_refresh(5);
    expect(cache.feed_get(5)?.title).toBe('new');
  });

  it('procCache_refresh() rebuilds the whole feed index', async () => {
    mockClientGet.mockResolvedValue(pagingClient([{ id: 1, name: 'f1' }], []));
    await procCache_refresh();
    expect(cache.built).toBe(true);
    expect(cache.feed_get(1)).toBeDefined();
  });

  it('procCache_build (via refresh) records an error when not connected', async () => {
    const { errorStack } = jest.requireActual('@fnndsc/cumin');
    errorStack.stack_clear();
    mockClientGet.mockResolvedValue(null);
    await procCache_refresh();
    expect(errorStack.stack_search('not connected').length).toBeGreaterThan(0);
  });
});
