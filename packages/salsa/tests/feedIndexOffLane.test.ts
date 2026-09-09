/**
 * Index movement never holds the lane: a cold feed's topology walk is
 * started and left to run, deduped while in flight, committed when it lands,
 * and named where it stopped when it fails.
 *
 * Seams: cumin chrisConnection.client_get (stub) and salsa jobs/index (stub).
 * Real procCache runs.
 */
const mockClientGet = jest.fn();
jest.mock('@fnndsc/cumin', () => ({
  ...jest.requireActual('@fnndsc/cumin'),
  chrisConnection: { client_get: mockClientGet },
}));
jest.mock('../src/jobs/index', () => ({}));

import { procCache_get } from '@fnndsc/cumin';
import { feedInstances_ensureStarted, feedInstances_ensureLoaded, procFeed_refreshStart, procVisitState_reset } from '../src/vfs/providers/proc';

const cache = procCache_get();

/** A client whose plugin-instance pages release one at a time, on demand. */
function gatedClient(rows: Array<{ id: number; feed_id: number }>, pageSize: number = 100) {
  const gates: Array<() => void> = [];
  const client = {
    getPluginInstances: jest.fn(async (params: { offset?: number; limit?: number }) => {
      await new Promise<void>((resolve: () => void): void => { gates.push(resolve); });
      const offset: number = params.offset ?? 0;
      const limit: number = params.limit ?? pageSize;
      return { data: rows.slice(offset, offset + limit), totalCount: rows.length };
    }),
  };
  const release = (): void => { const gate = gates.shift(); if (gate) gate(); };
  return { client, release, pending: (): number => gates.length };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 10; i++) await new Promise<void>((resolve: () => void): void => { setImmediate(resolve); });
}

function rows_make(feedID: number, n: number): Array<{ id: number; feed_id: number; plugin_name: string; status: string }> {
  return Array.from({ length: n }, (_: unknown, i: number) => ({ id: 1000 + i, feed_id: feedID, plugin_name: 'pl-x', status: 'finishedSuccessfully' }));
}

beforeEach(() => {
  cache.cache_clear();
  procVisitState_reset();
  jest.clearAllMocks();
});

describe('feedInstances_ensureStarted', () => {
  it('a cold feed answers pending at once, walks off the lane, and is ready when the walk lands', async () => {
    const gated = gatedClient(rows_make(21, 250));
    mockClientGet.mockResolvedValue(gated.client);

    expect(feedInstances_ensureStarted(21)).toBe('pending');
    await flush();
    // The first page is in flight and the register names the walk.
    expect(gated.pending()).toBe(1);
    expect(cache.feedLoad_of(21)).toEqual({ feedID: 21, loaded: 0, total: 0 });
    // Asking again while it runs starts no second walk.
    expect(feedInstances_ensureStarted(21)).toBe('pending');
    await flush();
    expect(gated.client.getPluginInstances).toHaveBeenCalledTimes(1);

    gated.release(); await flush();
    expect(cache.feedLoad_of(21)).toEqual({ feedID: 21, loaded: 100, total: 250 });
    expect(cache.topologyLoaded_has(21)).toBe(false); // committed only when whole
    // The first page told the total: the remaining two pages fly together.
    expect(gated.pending()).toBe(2);
    gated.release(); await flush();
    gated.release(); await flush();

    expect(cache.topologyLoaded_has(21)).toBe(true);
    expect(cache.feedInstanceIDs_get(21)).toHaveLength(250);
    expect(cache.feedLoad_of(21)).toBeNull();
    expect(feedInstances_ensureStarted(21)).toBe('ready');
    expect(cache.loading_get(21)).toBeUndefined();
  });

  it('a walk that fails names where it stopped, and the next ask starts again', async () => {
    const rows = rows_make(22, 150);
    let calls: number = 0;
    const client = {
      getPluginInstances: jest.fn(async (params: { offset?: number; limit?: number }) => {
        calls += 1;
        if (calls === 2) throw new Error('CUBE 502');
        const offset: number = params.offset ?? 0;
        return { data: rows.slice(offset, offset + (params.limit ?? 100)), totalCount: rows.length };
      }),
    };
    mockClientGet.mockResolvedValue(client);

    expect(feedInstances_ensureStarted(22)).toBe('pending');
    await flush();
    expect(cache.topologyLoaded_has(22)).toBe(false);
    expect(cache.feedLoad_of(22)).toEqual({ feedID: 22, loaded: 100, total: 150, failed: 'CUBE 502' });
    expect(cache.loading_get(22)).toBeUndefined();

    // The next visit retries from the beginning; this one succeeds.
    expect(feedInstances_ensureStarted(22)).toBe('pending');
    await flush();
    expect(cache.topologyLoaded_has(22)).toBe(true);
    expect(cache.feedLoad_of(22)).toBeNull();
    expect(client.getPluginInstances).toHaveBeenCalledTimes(4);
  });

  it('a refresh of a feed the own-feeds endpoint does not list keeps its roster row and re-walks it', async () => {
    cache.feed_add({ id: 834, title: 'shared', ownerUsername: 'someone', public: true, creationDate: 'd', finishedJobs: 1, erroredJobs: 0, startedJobs: 0, scheduledJobs: 0, cancelledJobs: 0, createdJobs: 0 });
    cache.instance_add({ id: 1, feedID: 834, parentID: null, pluginName: 'pl-old', params: null, status: 'finishedSuccessfully' });
    cache.topologyLoaded_mark(834);
    const rows = rows_make(834, 3);
    const client = {
      getFeeds: jest.fn(async () => ({ data: [], totalCount: 0 })),
      getPluginInstances: jest.fn(async (params: { offset?: number; limit?: number }) => ({ data: rows.slice(params.offset ?? 0, (params.offset ?? 0) + (params.limit ?? 100)), totalCount: rows.length })),
    };
    mockClientGet.mockResolvedValue(client);

    await expect(procFeed_refreshStart(834)).resolves.toBe('pending');
    expect(cache.feed_get(834)?.title).toBe('shared'); // the row stayed
    expect(cache.instance_get(1)).toBeUndefined();       // the old topology went
    await flush();
    expect(cache.topologyLoaded_has(834)).toBe(true);
    expect(cache.feedInstanceIDs_get(834)).toHaveLength(3);
  });

  it('feedInstances_ensureLoaded still waits for the walk it shares', async () => {
    const gated = gatedClient(rows_make(23, 50));
    mockClientGet.mockResolvedValue(gated.client);
    let done: boolean = false;
    const waiting: Promise<void> = feedInstances_ensureLoaded(23).then((): void => { done = true; });
    await flush();
    expect(done).toBe(false);
    expect(feedInstances_ensureStarted(23)).toBe('pending');
    gated.release(); await flush();
    await waiting;
    expect(done).toBe(true);
    expect(cache.topologyLoaded_has(23)).toBe(true);
  });
});
