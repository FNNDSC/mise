/**
 * @file Public command tests for warm-up behavior in the `proc` builtin.
 *
 * Exercises the command-envelope seam users observe while the global job
 * index is still being populated.
 *
 * @module
 */
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

interface TestEnvelope {
  status: 'ok' | 'error';
  rendered: string;
  renderedErr?: string;
}

interface TestFeed {
  id: number;
  title: string;
  ownerUsername: string;
  public: boolean;
  creationDate: string;
  finishedJobs: number;
  erroredJobs: number;
  startedJobs: number;
  scheduledJobs: number;
  cancelledJobs: number;
  createdJobs: number;
}

const procTopologyAwait_mock = jest.fn(async (): Promise<void> => undefined);
let mockTopologyStatus: { state: 'idle' | 'running' | 'complete' | 'failed'; failure?: string } = { state: 'idle' };
const jobsFind_mock = jest.fn(async () => ({ ok: true, value: [] }));
const contextGetSingle_mock = jest.fn(async () => ({ user: 'me' }));
const procCacheRefresh_mock = jest.fn(async (): Promise<void> => undefined);
const procFeedEnsureLoaded_mock = jest.fn(async (): Promise<void> => undefined);
const procTopologyWarmup_mock = jest.fn(async (): Promise<void> => undefined);
let mockFeeds: TestFeed[] = [];
let mockWarmup = { loaded: 0, total: 0, active: false };
let mockWarmupComplete: boolean = false;
let mockLifecycle: { phase: string; checkpointAt?: string } = { phase: 'empty' };
const mockCache = {
  cache_clear: jest.fn((): void => {
    mockWarmup = { loaded: 0, total: 0, active: false };
    mockWarmupComplete = false;
  }),
  feed_get: jest.fn((id: number) => mockFeeds.find((feed: TestFeed) => feed.id === id)),
  feeds_find: jest.fn((term: string) => mockFeeds.filter((feed: TestFeed) => feed.title.includes(term))),
  feedIDs_get: jest.fn((): number[] => mockFeeds.map((feed: TestFeed) => feed.id)),
  feedScopeCounts_get: jest.fn(() => ({ user: 40, shared: 14, public: 637, total: 691 })),
  instances_count: jest.fn((): number => 25),
  instancesForFeed_count: jest.fn((): number => 2),
  path_build: jest.fn((id: number): string => `/proc/jobs/feed_1/pl-test_${id}`),
  topologyLoaded_has: jest.fn((): boolean => true),
  warmupProgress_get: jest.fn(() => ({ ...mockWarmup })),
  lifecycle_get: jest.fn(() => ({ ...mockLifecycle })),
  get warmupComplete(): boolean { return mockWarmupComplete; },
};

jest.unstable_mockModule('@fnndsc/cumin', () => ({
  Context: {},
  SingleContext: class TestSingleContext {},
  envelope_error: (rendered: string, _errors?: unknown, renderedErr?: string): TestEnvelope => ({
    status: 'error', rendered, renderedErr,
  }),
  envelope_ok: (rendered: string): TestEnvelope => ({ status: 'ok', rendered }),
  procCache_get: jest.fn(() => mockCache),
}));

jest.unstable_mockModule('@fnndsc/salsa', () => ({
  context_getSingle: contextGetSingle_mock,
  jobs_find: jobsFind_mock,
  procCache_refresh: procCacheRefresh_mock,
  procFeed_ensureLoaded: procFeedEnsureLoaded_mock,
  procTopology_await: procTopologyAwait_mock,
  procTopology_warmup: procTopologyWarmup_mock,
  procTopology_status: jest.fn(() => ({ ...mockTopologyStatus })),
}));

jest.unstable_mockModule('../src/lib/spinner.js', () => ({
  spinner: { start: jest.fn(), stop: jest.fn() },
}));

jest.unstable_mockModule('../src/builtins/utils.js', () => ({
  commandArgs_process: jest.fn((args: string[]) => {
    const parsed: Record<string, unknown> & { _: string[] } = { _: [] };
    for (const arg of args) {
      if (arg.startsWith('--')) parsed[arg.slice(2)] = true;
      else parsed._.push(arg);
    }
    return parsed;
  }),
}));

jest.unstable_mockModule('@fnndsc/chili/utils/sort.js', () => ({
  list_applySort: jest.fn((entries: unknown[]) => entries),
}));

jest.unstable_mockModule('@fnndsc/chili/screen/screen.js', () => ({
  screen: { table_output: jest.fn(() => '') },
  table_render: jest.fn(() => ''),
}));

const { builtin_proc } = await import('../src/builtins/proc.js');

describe('builtin_proc warm-up policy', () => {
  const previousExitCode: number | string | undefined = process.exitCode;

  beforeEach(() => {
    mockCache.cache_clear();
    mockFeeds = [];
    mockTopologyStatus = { state: 'idle' };
    mockLifecycle = { phase: 'empty' };
    jest.clearAllMocks();
    process.exitCode = undefined;
  });

  afterEach(() => {
    process.exitCode = previousExitCode;
  });

  it('refuses a global jobs listing while the index is warming', async () => {
    mockWarmup = { loaded: 25, total: 100, active: true };

    const envelope: TestEnvelope = await builtin_proc(['jobs', 'list']);

    expect(envelope.status).toBe('error');
    expect(envelope.renderedErr).toContain('visible-job index is still warming (25/100, 25%)');
    expect(envelope.renderedErr).toContain('proc jobs list --force');
    expect(process.exitCode).toBe(1);
    expect(procTopologyAwait_mock).not.toHaveBeenCalled();
  });

  it('serves a restored checkpoint while CUBE reconciliation runs', async () => {
    mockWarmup = { loaded: 25, total: 100, active: true };
    mockTopologyStatus = { state: 'running' };
    mockLifecycle = { phase: 'reconciling', checkpointAt: '2026-07-16T00:00:00Z' };
    mockFeeds = [{
      id: 5, title: 'restored brain', ownerUsername: 'me', public: false,
      creationDate: '', finishedJobs: 2, erroredJobs: 0, startedJobs: 0,
      scheduledJobs: 0, cancelledJobs: 0, createdJobs: 0,
    }];

    const envelope: TestEnvelope = await builtin_proc(['jobs', 'list']);

    expect(envelope.status).toBe('ok');
    expect(envelope.rendered).toContain('restored brain');
  });

  it('still waits for authoritative reconciliation when a restored query is forced', async () => {
    mockWarmup = { loaded: 25, total: 100, active: true };
    mockTopologyStatus = { state: 'running' };
    mockLifecycle = { phase: 'reconciling', checkpointAt: '2026-07-16T00:00:00Z' };
    procTopologyAwait_mock.mockImplementationOnce(async (): Promise<void> => {
      mockWarmup = { loaded: 100, total: 100, active: false };
      mockWarmupComplete = true;
      mockTopologyStatus = { state: 'complete' };
    });

    expect((await builtin_proc(['jobs', 'list', '--force'])).status).toBe('ok');
    expect(procTopologyAwait_mock).toHaveBeenCalledTimes(1);
  });

  it('refuses a plugin-name search while the index is warming', async () => {
    mockWarmup = { loaded: 25, total: 100, active: true };

    const envelope: TestEnvelope = await builtin_proc(['find', 'dircopy']);

    expect(envelope.status).toBe('error');
    expect(envelope.renderedErr).toContain('visible-job index is still warming (25/100, 25%)');
    expect(envelope.renderedErr).toContain('proc find dircopy --force');
    expect(jobsFind_mock).not.toHaveBeenCalled();
  });

  it('refuses a feed-title search while the index is warming', async () => {
    mockWarmup = { loaded: 25, total: 100, active: true };

    const envelope: TestEnvelope = await builtin_proc(['feeds', 'segmentation']);

    expect(envelope.status).toBe('error');
    expect(envelope.renderedErr).toContain('visible-job index is still warming (25/100, 25%)');
    expect(envelope.renderedErr).toContain('proc feeds segmentation --force');
    expect(mockCache.feeds_find).not.toHaveBeenCalled();
  });

  it('waits for the existing warm-up when a global query is forced', async () => {
    mockWarmup = { loaded: 25, total: 100, active: true };
    procTopologyAwait_mock.mockImplementationOnce(async (): Promise<void> => {
      mockWarmup = { loaded: 100, total: 100, active: false };
      mockWarmupComplete = true;
      mockTopologyStatus = { state: 'complete' };
    });

    const envelope: TestEnvelope = await builtin_proc(['jobs', 'list', '--force']);

    expect(procTopologyAwait_mock).toHaveBeenCalledTimes(1);
    expect(envelope.status).toBe('ok');
  });

  it('reports a failed forced wait as a command error', async () => {
    mockWarmup = { loaded: 25, total: 100, active: true };
    procTopologyAwait_mock.mockRejectedValueOnce(new Error('connection lost'));

    const envelope: TestEnvelope = await builtin_proc(['jobs', 'list', '--force']);

    expect(envelope.status).toBe('error');
    expect(envelope.renderedErr).toContain('proc warm-up failed: connection lost');
    expect(process.exitCode).toBe(1);
  });

  it('blocks global queries while the first topology page is initializing', async () => {
    mockTopologyStatus = { state: 'running' };

    const envelope: TestEnvelope = await builtin_proc(['jobs', 'list']);

    expect(envelope.status).toBe('error');
    expect(envelope.renderedErr).toContain('visible-job index is still warming (initializing)');
    expect(process.exitCode).toBe(1);
  });

  it('keeps global queries disabled after the first topology page fails', async () => {
    mockTopologyStatus = { state: 'failed', failure: 'connection lost' };

    const envelope: TestEnvelope = await builtin_proc(['jobs', 'list']);

    expect(envelope.status).toBe('error');
    expect(envelope.renderedErr).toContain('failed to warm: connection lost');
    expect(envelope.renderedErr).toContain('incomplete results');
    expect(process.exitCode).toBe(1);
  });

  it('reports initializing and failed topology lifecycle in proc stat', async () => {
    mockTopologyStatus = { state: 'running' };
    let envelope: TestEnvelope = await builtin_proc(['stat']);
    expect(envelope.rendered).toContain('initializing');

    mockTopologyStatus = { state: 'failed', failure: 'connection lost' };
    envelope = await builtin_proc(['stat']);
    expect(envelope.rendered).toContain('failed: connection lost');
  });

  it('refuses partial results when a previous sweep failed before force waits', async () => {
    mockWarmup = { loaded: 25, total: 100, active: true };

    const envelope: TestEnvelope = await builtin_proc(['jobs', 'list', '--force']);

    expect(procTopologyAwait_mock).toHaveBeenCalledTimes(1);
    expect(envelope.status).toBe('error');
    expect(envelope.renderedErr).toContain('the topology sweep did not complete');
    expect(process.exitCode).toBe(1);
  });

  it('allows a targeted numeric instance lookup while warming', async () => {
    mockWarmup = { loaded: 25, total: 100, active: true };
    jobsFind_mock.mockResolvedValueOnce({
      ok: true,
      value: [{ id: 123, feedID: 1, pluginName: 'pl-test' }],
    });

    const envelope: TestEnvelope = await builtin_proc(['find', '123']);

    expect(envelope.status).toBe('ok');
    expect(envelope.rendered).toContain('/proc/jobs/feed_1/pl-test_123');
    expect(procTopologyAwait_mock).not.toHaveBeenCalled();
  });

  it('allows proc stat while warming', async () => {
    mockWarmup = { loaded: 25, total: 100, active: true };

    const envelope: TestEnvelope = await builtin_proc(['stat']);

    expect(envelope.status).toBe('ok');
    expect(envelope.rendered).toContain('in progress');
    expect(envelope.rendered).toContain('25/100');
    expect(procTopologyAwait_mock).not.toHaveBeenCalled();
  });

  it('reports zero loaded jobs deterministically after an empty sweep', async () => {
    mockWarmup = { loaded: 0, total: 0, active: false };
    mockWarmupComplete = true;

    const envelope: TestEnvelope = await builtin_proc(['stat']);

    expect(envelope.status).toBe('ok');
    expect(envelope.rendered).toContain('0/0');
  });

  it('reports exclusive user, public, and shared feed counts', async () => {
    mockWarmup = { loaded: 7009, total: 7009, active: false };
    mockWarmupComplete = true;

    const envelope: TestEnvelope = await builtin_proc(['stat']);

    expect(envelope.rendered).toContain('visible feeds');
    expect(envelope.rendered).toContain('691');
    expect(envelope.rendered).toContain('user');
    expect(envelope.rendered).toContain('40');
    expect(envelope.rendered).toContain('public');
    expect(envelope.rendered).toContain('637');
    expect(envelope.rendered).toContain('shared');
    expect(envelope.rendered).toContain('14');
    expect(envelope.rendered.indexOf('user')).toBeLessThan(envelope.rendered.indexOf('public'));
    expect(envelope.rendered.indexOf('public')).toBeLessThan(envelope.rendered.indexOf('shared'));
    expect(mockCache.feedScopeCounts_get).toHaveBeenCalledWith('me');
  });

  it('lists cached jobs after warm-up completes', async () => {
    mockWarmupComplete = true;
    mockFeeds = [{
      id: 5, title: 'brain', ownerUsername: 'me', public: false,
      creationDate: '2026-07-16T00:00:00Z', finishedJobs: 2, erroredJobs: 0,
      startedJobs: 0, scheduledJobs: 0, cancelledJobs: 0, createdJobs: 0,
    }];

    const envelope: TestEnvelope = await builtin_proc(['jobs', 'list']);

    expect(envelope.status).toBe('ok');
    expect(envelope.rendered).toContain('brain');
    expect(envelope.rendered).toContain('finishedSuccessfully');
  });

  it('searches feed titles after warm-up completes', async () => {
    mockWarmupComplete = true;
    mockFeeds = [{
      id: 5, title: 'brain segmentation', ownerUsername: 'me', public: false,
      creationDate: '', finishedJobs: 2, erroredJobs: 0, startedJobs: 0,
      scheduledJobs: 0, cancelledJobs: 0, createdJobs: 0,
    }];

    const envelope: TestEnvelope = await builtin_proc(['feeds', 'brain']);

    expect(envelope.status).toBe('ok');
    expect(envelope.rendered).toContain('/proc/jobs/feed_5');
  });

  it('reports targeted feed details', async () => {
    mockFeeds = [{
      id: 5, title: 'brain', ownerUsername: 'me', public: false,
      creationDate: '', finishedJobs: 2, erroredJobs: 0, startedJobs: 0,
      scheduledJobs: 0, cancelledJobs: 0, createdJobs: 0,
    }];

    const envelope: TestEnvelope = await builtin_proc(['stat', 'feed_5']);

    expect(envelope.status).toBe('ok');
    expect(envelope.rendered).toContain('loaded (2 instances)');
  });

  it('refreshes a targeted feed', async () => {
    const envelope: TestEnvelope = await builtin_proc(['refresh', 'feed_5']);

    expect(envelope.status).toBe('ok');
    expect(envelope.rendered).toContain('feed_5');
    expect(procCacheRefresh_mock).toHaveBeenCalledWith(5);
    expect(procTopologyWarmup_mock).not.toHaveBeenCalled();
  });

  it('starts one replacement topology sweep after a full refresh', async () => {
    const envelope: TestEnvelope = await builtin_proc(['refresh']);

    expect(envelope.status).toBe('ok');
    expect(procCacheRefresh_mock).toHaveBeenCalledWith(undefined);
    expect(procTopologyWarmup_mock).toHaveBeenCalledTimes(1);
  });

  it('inspects available job fields without requiring warm-up', async () => {
    mockWarmup = { loaded: 25, total: 100, active: true };

    const envelope: TestEnvelope = await builtin_proc(['jobs', 'inspect']);

    expect(envelope.status).toBe('ok');
    expect(procTopologyAwait_mock).not.toHaveBeenCalled();
  });
});
