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
  procTopology_status,
  procTopology_await,
  procCache_refresh,
  procFeed_ensureLoaded,
  feedInstances_ensureLoaded,
  feedMeta_ensure,
  feedStatus_refresh,
} from '../src/vfs/providers/proc';

const cache = procCache_get();
const provider = new ProcVfsProvider();

function feed(over: Partial<ProcFeed> = {}): ProcFeed {
  return {
    id: 1, title: 'f', creationDate: '', finishedJobs: 0, erroredJobs: 0,
    startedJobs: 0, scheduledJobs: 0, cancelledJobs: 0, createdJobs: 0, ...over,
    ownerUsername: over.ownerUsername ?? '', public: over.public ?? false,
  };
}

/** Fake chrisapi client that paginates a fixed set of rows. */
function pagingClient(feeds: unknown[] = [], instances: unknown[] = []) {
  return {
    getFeeds: jest.fn().mockResolvedValue({ data: feeds, totalCount: feeds.length }),
    getPluginInstances: jest.fn().mockResolvedValue({ data: instances, totalCount: instances.length }),
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
    expect(procPath_parse('/proc/jobs/feed_5')).toEqual({ feedID: 5, instanceID: null, virtualFile: null });
  });
  it('parses an instance path', () => {
    expect(procPath_parse('/proc/jobs/feed_5/pl-dircopy_10')).toEqual({
      feedID: 5, instanceID: 10, virtualFile: null,
    });
  });
  it('parses a feed virtual file', () => {
    expect(procPath_parse('/proc/jobs/feed_5/status')).toEqual({
      feedID: 5, instanceID: null, virtualFile: 'status',
    });
  });
  it('parses an instance virtual file', () => {
    expect(procPath_parse('/proc/jobs/feed_5/pl-x_10/status')).toEqual({
      feedID: 5, instanceID: 10, virtualFile: 'status',
    });
  });
  it('returns nulls for a non-feed path', () => {
    expect(procPath_parse('/proc/jobs/other')).toEqual({ feedID: null, instanceID: null, virtualFile: null });
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

  it('lists root instances from cache; terminal status needs no API call', async () => {
    cache.feed_add(feed({ id: 5 }));
    cache.instance_add({ id: 10, feedID: 5, parentID: null, pluginName: 'pl-dircopy', params: null, status: 'finishedSuccessfully' });
    cache.topologyLoaded_mark(5);
    const client = pagingClient([], []);
    mockClientGet.mockResolvedValue(client);

    const r = await provider.list('/proc/jobs/feed_5');
    const items = r.ok ? r.value : [];
    expect(items.filter((i) => i.type === 'file').map((i) => i.name)).toEqual(['status', 'title']);
    expect(items.find((i) => i.type === 'job')).toMatchObject({ name: 'pl-dircopy_10', status: 'finishedSuccessfully' });
    expect(client.getPluginInstances).not.toHaveBeenCalled();
    expect(mockJobs.jobs_statusBatch).not.toHaveBeenCalled();
  });

  it('refreshes active status via one feed-scoped list call, freezing terminal', async () => {
    cache.feed_add(feed({ id: 5 }));
    cache.instance_add({ id: 10, feedID: 5, parentID: null, pluginName: 'pl-dircopy', params: null, status: 'started' });
    cache.topologyLoaded_mark(5);
    const client = pagingClient([], [
      { id: 10, feed_id: 5, previous_id: null, plugin_name: 'pl-dircopy', status: 'finishedSuccessfully' },
    ]);
    mockClientGet.mockResolvedValue(client);

    const r = await provider.list('/proc/jobs/feed_5');
    const items = r.ok ? r.value : [];
    expect(client.getPluginInstances).toHaveBeenCalledTimes(1);
    expect(mockJobs.jobs_statusBatch).not.toHaveBeenCalled();
    expect(items.find((i) => i.type === 'job')).toMatchObject({ name: 'pl-dircopy_10', status: 'finishedSuccessfully' });
  });

  it('returns [] for an unknown feed', async () => {
    cache.topologyLoaded_mark(9);
    const r = await provider.list('/proc/jobs/feed_9');
    expect(r.ok && r.value).toEqual([]);
  });

  it('lists children from cache; terminal status needs no API call', async () => {
    cache.feed_add(feed({ id: 5 }));
    cache.instance_add({ id: 10, feedID: 5, parentID: null, pluginName: 'pl-root', params: null, status: 'finishedSuccessfully' });
    cache.instance_add({ id: 11, feedID: 5, parentID: 10, pluginName: 'pl-child', params: null, status: 'finishedSuccessfully' });
    cache.topologyLoaded_mark(5);
    const client = pagingClient([], []);
    mockClientGet.mockResolvedValue(client);

    const r = await provider.list('/proc/jobs/feed_5/pl-root_10');
    const items = r.ok ? r.value : [];
    expect(items.filter((i) => i.type === 'file').map((i) => i.name)).toEqual(['status', 'params', 'log']);
    expect(items.find((i) => i.type === 'job')).toMatchObject({ name: 'pl-child_11', status: 'finishedSuccessfully' });
    expect(client.getPluginInstances).not.toHaveBeenCalled();
  });
});

describe('ProcVfsProvider.read', () => {
  beforeEach(() => {
    cache.built_set();
    cache.feed_add(feed({ id: 5, title: 'brain', finishedJobs: 1 }));
    cache.instance_add({ id: 10, feedID: 5, parentID: null, pluginName: 'pl-x', params: null, status: 'started' });
    cache.topologyLoaded_mark(5);
  });

  it('reads feed status and title', async () => {
    const s = await provider.read('/proc/jobs/feed_5/status');
    expect(s.ok && s.value).toBe('finishedSuccessfully');
    const t = await provider.read('/proc/jobs/feed_5/title');
    expect(t.ok && t.value).toBe('brain');
  });

  it('reads active instance status live and caches it', async () => {
    mockJobs.job_statusFetch.mockResolvedValue(Ok('running'));
    const r = await provider.read('/proc/jobs/feed_5/pl-x_10/status');
    expect(r.ok && r.value).toBe('running');
    expect(cache.instance_get(10)?.status).toBe('running');
  });

  it('returns a cached terminal status without any API call', async () => {
    cache.status_update(10, 'finishedSuccessfully');
    const r = await provider.read('/proc/jobs/feed_5/pl-x_10/status');
    expect(r.ok && r.value).toBe('finishedSuccessfully');
    expect(mockJobs.job_statusFetch).not.toHaveBeenCalled();
  });

  it('falls back to last-known status when a live fetch fails', async () => {
    mockJobs.job_statusFetch.mockResolvedValue(Err());
    const r = await provider.read('/proc/jobs/feed_5/pl-x_10/status');
    expect(r.ok && r.value).toBe('started');
  });

  it('falls back to "unknown" when status is unknown and the fetch fails', async () => {
    cache.instance_add({ id: 10, feedID: 5, parentID: null, pluginName: 'pl-x', params: null, status: null });
    mockJobs.job_statusFetch.mockResolvedValue(Err());
    const r = await provider.read('/proc/jobs/feed_5/pl-x_10/status');
    expect(r.ok && r.value).toBe('unknown');
  });

  it('fetches + caches params on first read, filtering meta keys', async () => {
    mockClientGet.mockResolvedValue({
      getPluginInstance: jest.fn().mockResolvedValue({
        data: { id: 10, feed_id: 5, plugin_name: 'pl-x', status: 'x', previous_id: null, dir: '/in', k: 'v' },
      }),
    });
    const r = await provider.read('/proc/jobs/feed_5/pl-x_10/params');
    expect(r.ok && r.value).toContain('dir=/in');
    expect(r.ok && r.value).toContain('k=v');
    expect(r.ok && r.value).not.toContain('plugin_name');
    // cached now -> params_render from cache
    expect(cache.instance_get(10)?.params).toMatchObject({ dir: '/in' });
  });

  it('reads instance log', async () => {
    mockJobs.job_logFetch.mockResolvedValue(Ok('hello log'));
    const r = await provider.read('/proc/jobs/feed_5/pl-x_10/log');
    expect(r.ok && r.value).toBe('hello log');
  });

  it('returns "" for an unknown feed file', async () => {
    const r = await provider.read('/proc/jobs/feed_999/status');
    expect(r.ok && r.value).toBe('');
  });
});

describe('ProcVfsProvider.rm', () => {
  beforeEach(() => {
    cache.built_set();
    cache.feed_add(feed({ id: 5 }));
    cache.instance_add({ id: 10, feedID: 5, parentID: null, pluginName: 'pl-x', params: null, status: 'running' });
    cache.topologyLoaded_mark(5);
  });

  it('cancels non-terminal jobs then removes a feed', async () => {
    mockJobs.jobs_statusBatch.mockResolvedValue(new Map([[10, 'running']]));
    mockJobs.job_cancel.mockResolvedValue(Ok(true));
    expect(await provider.rm('/proc/jobs/feed_5')).toBe(true);
    expect(mockJobs.job_cancel).toHaveBeenCalledWith(10);
    expect(cache.feed_get(5)).toBeUndefined();
  });

  it('cancels a non-terminal instance', async () => {
    mockJobs.job_statusFetch.mockResolvedValue(Ok('running'));
    mockJobs.job_cancel.mockResolvedValue(Ok(true));
    expect(await provider.rm('/proc/jobs/feed_5/pl-x_10')).toBe(true);
    expect(mockJobs.job_cancel).toHaveBeenCalledWith(10);
  });

  it('deletes a terminal instance and drops it from the cache', async () => {
    mockJobs.job_statusFetch.mockResolvedValue(Ok('finishedSuccessfully'));
    mockJobs.job_delete.mockResolvedValue(Ok(true));
    expect(await provider.rm('/proc/jobs/feed_5/pl-x_10')).toBe(true);
    expect(cache.instance_get(10)).toBeUndefined();
  });

  it('returns false for an unparseable path', async () => {
    expect(await provider.rm('/proc/jobs/garbage')).toBe(false);
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
  it('indexes every feed when the server caps pages below the requested limit', async () => {
    const privateRows = [
      { id: 1, name: 'mine', owner_username: 'chris', public: false },
      { id: 2, name: 'shared-public', owner_username: 'other', public: true },
    ];
    const publicRows = [
      { id: 2, name: 'shared-public', owner_username: 'other', public: true },
      { id: 3, name: 'public-only', owner_username: 'another', public: true },
    ];
    const client = {
      getFeeds: jest.fn().mockImplementation(({ offset }: { offset: number }) => ({
        data: privateRows.slice(offset, offset + 1),
        totalCount: privateRows.length,
      })),
      getPublicFeeds: jest.fn().mockImplementation(({ offset }: { offset: number }) => ({
        data: publicRows.slice(offset, offset + 1),
        totalCount: publicRows.length,
      })),
      getPluginInstances: jest.fn(),
    };
    mockClientGet.mockResolvedValue(client);

    await procCache_refresh();

    expect(cache.feedIDs_get().sort()).toEqual([1, 2, 3]);
    expect(cache.feed_get(1)).toMatchObject({ ownerUsername: 'chris', public: false });
    expect(cache.feed_get(2)).toMatchObject({ ownerUsername: 'other', public: true });
    expect(cache.feed_get(3)).toMatchObject({ ownerUsername: 'another', public: true });
    expect(client.getFeeds).toHaveBeenCalledTimes(2);
    expect(client.getPublicFeeds).toHaveBeenCalledTimes(2);
  });

  it('joins the active topology sweep without starting another', async () => {
    cache.built_set();
    let releasePage: ((page: { data: unknown[]; totalCount: number }) => void) | undefined;
    const page: Promise<{ data: unknown[]; totalCount: number }> = new Promise((resolve) => {
      releasePage = resolve;
    });
    const client = {
      getFeeds: jest.fn().mockResolvedValue({ data: [] }),
      getPluginInstances: jest.fn().mockReturnValue(page),
    };
    mockClientGet.mockResolvedValue(client);

    const sweep: Promise<void> = procTopology_warmup();
    const waiter: Promise<void> = procTopology_await();
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(client.getPluginInstances).toHaveBeenCalledTimes(1);
    expect(procTopology_status()).toEqual({ state: 'running', failure: undefined });
    expect(cache.warmupProgress_get().active).toBe(false);
    releasePage?.({ data: [], totalCount: 0 });
    await Promise.all([sweep, waiter]);
    expect(client.getPluginInstances).toHaveBeenCalledTimes(1);
    expect(procTopology_status()).toEqual({ state: 'complete', failure: undefined });
  });

  it('preserves a failure that occurs before the first topology page', async () => {
    cache.built_set();
    const client = {
      getPluginInstances: jest.fn().mockRejectedValue(new Error('connection lost')),
    };
    mockClientGet.mockResolvedValue(client);

    await expect(procTopology_warmup()).rejects.toThrow('connection lost');

    expect(cache.warmupProgress_get().active).toBe(false);
    expect(procTopology_status()).toEqual({ state: 'failed', failure: 'connection lost' });
  });

  it('clears active prompt progress when a later topology page fails', async () => {
    cache.built_set();
    interface TestInstancePage {
      data: unknown[];
      totalCount: number;
    }
    const page_fetch = jest.fn<Promise<TestInstancePage>, [{ offset: number }]>()
      .mockResolvedValueOnce({
        data: [{ id: 10, feed_id: 5, previous_id: null, plugin_name: 'pl-x', status: 'started' }],
        totalCount: 2,
      })
      .mockRejectedValueOnce(new Error('second page lost'));
    mockClientGet.mockResolvedValue({ getPluginInstances: page_fetch });

    await expect(procTopology_warmup()).rejects.toThrow('second page lost');

    expect(cache.warmupProgress_get()).toEqual({ loaded: 1, total: 2, active: false });
    expect(procTopology_status()).toEqual({ state: 'failed', failure: 'second page lost' });
  });

  it('procTopology_warmup sweeps instances and completes', async () => {
    cache.built_set();
    cache.feed_add(feed({ id: 5 }));
    mockClientGet.mockResolvedValue(
      pagingClient([], [{ id: 10, feed_id: 5, previous_id: null, plugin_name: 'pl-x', status: 's' }])
    );
    await procTopology_warmup();
    expect(cache.warmupComplete).toBe(true);
    expect(cache.warmupProgress_get()).toEqual({ loaded: 1, total: 1, active: false });
    expect(cache.instance_get(10)).toBeDefined();
    expect(cache.feed_get(5)).toBeDefined();
  });

  it('procTopology_warmup bails when not connected', async () => {
    cache.built_set();
    mockClientGet.mockResolvedValue(null);
    await expect(procTopology_warmup()).rejects.toThrow('not connected');
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

  it('loads complete targeted feed topology when server pages are capped', async () => {
    cache.built_set();
    const rows = [
      { id: 20, feed_id: 7, previous_id: null, plugin_name: 'pl-root', status: 'started' },
      { id: 21, feed_id: 7, previous_id: 20, plugin_name: 'pl-child', status: 'scheduled' },
    ];
    const client = {
      getPluginInstances: jest.fn().mockImplementation(({ offset }: { offset: number }) => ({
        data: rows.slice(offset, offset + 1),
        totalCount: rows.length,
      })),
    };
    mockClientGet.mockResolvedValue(client);

    await feedInstances_ensureLoaded(7);

    expect(cache.instance_get(20)).toBeDefined();
    expect(cache.instance_get(21)).toBeDefined();
    expect(cache.topologyLoaded_has(7)).toBe(true);
    expect(client.getPluginInstances).toHaveBeenCalledTimes(2);
  });

  it('refreshes every targeted status when server pages are capped', async () => {
    cache.instance_add({
      id: 20, feedID: 7, parentID: null, pluginName: 'pl-root', params: null, status: 'started',
    });
    cache.instance_add({
      id: 21, feedID: 7, parentID: 20, pluginName: 'pl-child', params: null, status: 'scheduled',
    });
    const rows = [
      { id: 20, feed_id: 7, previous_id: null, plugin_name: 'pl-root', status: 'finishedSuccessfully' },
      { id: 21, feed_id: 7, previous_id: 20, plugin_name: 'pl-child', status: 'started' },
    ];
    const client = {
      getPluginInstances: jest.fn().mockImplementation(({ offset }: { offset: number }) => ({
        data: rows.slice(offset, offset + 1),
        totalCount: rows.length,
      })),
    };
    mockClientGet.mockResolvedValue(client);

    await feedStatus_refresh(7);

    expect(cache.instance_get(20)?.status).toBe('finishedSuccessfully');
    expect(cache.instance_get(21)?.status).toBe('started');
    expect(client.getPluginInstances).toHaveBeenCalledTimes(2);
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

  it('feedMeta_ensure skips fetching when real metadata is already cached', async () => {
    cache.feed_add(feed({ id: 5, title: 'known', creationDate: '2026-01-01', finishedJobs: 1 }));
    const client = pagingClient([{ id: 5, name: 'fresh', finished_jobs: 9 }], []);
    mockClientGet.mockResolvedValue(client);
    await feedMeta_ensure(5);
    expect(client.getFeeds).not.toHaveBeenCalled();
    expect(cache.feed_get(5)?.title).toBe('known');
  });

  it('feedMeta_ensure fetches counters for a missing feed', async () => {
    mockClientGet.mockResolvedValue(pagingClient([{ id: 8, name: 'new', finished_jobs: 3, creation_date: '2026-01-01' }], []));
    await feedMeta_ensure(8);
    expect(cache.feed_get(8)?.title).toBe('new');
    expect(cache.feed_get(8)?.finishedJobs).toBe(3);
  });

  it('feedMeta_ensure refreshes a zero-counter placeholder feed', async () => {
    cache.feed_add(feed({ id: 8, title: 'placeholder', creationDate: '' }));
    mockClientGet.mockResolvedValue(pagingClient([{ id: 8, name: 'real', finished_jobs: 2, creation_date: '2026-01-01' }], []));
    await feedMeta_ensure(8);
    expect(cache.feed_get(8)?.title).toBe('real');
    expect(cache.feed_get(8)?.finishedJobs).toBe(2);
  });

  it('procCache_refresh() rebuilds the whole feed index', async () => {
    mockClientGet.mockResolvedValue(pagingClient([{ id: 1, name: 'f1' }], []));
    await procCache_refresh();
    expect(cache.built).toBe(true);
    expect(cache.feed_get(1)).toBeDefined();
  });

  it('resets completed topology lifecycle before a full cache rebuild', async () => {
    cache.built_set();
    mockClientGet.mockResolvedValue(pagingClient([], []));
    await procTopology_warmup();
    expect(procTopology_status().state).toBe('complete');

    mockClientGet.mockResolvedValue(pagingClient([{ id: 2, name: 'fresh' }], []));
    await procCache_refresh();

    expect(procTopology_status()).toEqual({ state: 'idle', failure: undefined });
    expect(cache.warmupComplete).toBe(false);
    expect(cache.feed_get(2)).toBeDefined();
  });

  it('procCache_build (via refresh) records an error when not connected', async () => {
    const { errorStack } = jest.requireActual('@fnndsc/cumin');
    errorStack.stack_clear();
    mockClientGet.mockResolvedValue(null);
    await expect(procCache_refresh()).rejects.toThrow('not connected');
    expect(errorStack.stack_search('not connected').length).toBeGreaterThan(0);
  });
});
