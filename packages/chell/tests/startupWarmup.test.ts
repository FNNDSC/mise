/**
 * @file Tests shared interactive and daemon startup cache warming.
 *
 * @module
 */
import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import type { BrasaEngine } from '@fnndsc/brasa';

const mockDataGet = jest.fn();
const mockSession: { offline: boolean } = { offline: false };
const mockStackPop = jest.fn((): { message: string } | undefined => undefined);
const mockPrefetchPath = jest.fn();
const mockPrefetchWithSpinner = jest.fn(
  async (_label: string, _message: string, _interactive: boolean, action: () => Promise<unknown>): Promise<unknown> => action(),
);
const mockTopologyWarmup = jest.fn(async (): Promise<void> => undefined);
const mockProcCacheRefresh = jest.fn(async (): Promise<void> => undefined);
const mockDaemonListen = jest.fn();
const mockDaemonLaunch = jest.fn(
  async (_engine: BrasaEngine, beforeListen?: () => Promise<void>): Promise<void> => {
    await beforeListen?.();
    mockDaemonListen();
  },
);

jest.unstable_mockModule('@fnndsc/brasa', () => ({
  session: mockSession,
  vfs: { data_get: mockDataGet },
  prefetch_path: mockPrefetchPath,
  prefetch_withSpinner: mockPrefetchWithSpinner,
  error_stripDebugPrefix: (message: string): string => message,
}));
jest.unstable_mockModule('@fnndsc/salsa', () => ({
  procCache_refresh: mockProcCacheRefresh,
  procTopology_warmup: mockTopologyWarmup,
}));
jest.unstable_mockModule('@fnndsc/cumin', () => ({
  errorStack: {
    stack_pop: mockStackPop,
    scope_run: (callback: () => void): void => callback(),
  },
  procCache_get: jest.fn(() => ({ feedIDs_get: (): number[] => [1, 2, 3] })),
}));
jest.unstable_mockModule('@fnndsc/calypso', () => ({ daemon_launch: mockDaemonLaunch }));

const { daemonSession_run, startupWarmup_run } = await import('../src/core/startupWarmup.js');

describe('daemonSession_run', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSession.offline = false;
    mockStackPop.mockReturnValue(undefined);
    mockProcCacheRefresh.mockResolvedValue(undefined);
    mockTopologyWarmup.mockResolvedValue(undefined);
    mockDataGet.mockResolvedValue({
      ok: true,
      value: [
        { name: 'pl-a', type: 'plugin' },
        { name: 'pl-b', type: 'plugin' },
        { name: 'pipeline-a', type: 'pipeline' },
      ],
    });
    mockPrefetchPath.mockImplementation(async (path: string) => ({
      ok: true,
      count: path === '/PUBLIC' ? 9 : 4,
    }));
  });

  it('warms and reports every startup cache before advertising the daemon', async () => {
    const report = jest.fn();
    const engine: BrasaEngine = {
      line_execute: jest.fn(async () => []),
      line_complete: jest.fn(async (prefix: string) => ({ candidates: [], prefix })),
    };

    await daemonSession_run(engine, 'rudolph', {
      plugins: true,
      feeds: true,
      publicFeeds: true,
      jobs: true,
    }, true, { log: report });

    expect(report).toHaveBeenCalledWith('ok', 'Plugins', 'Cached 2 plugin(s)');
    expect(report).toHaveBeenCalledWith('ok', 'Pipelines', 'Cached 1 pipeline(s)');
    expect(report).toHaveBeenCalledWith('ok', 'Feeds', 'Cached 4 item(s) from /home/rudolph/feeds');
    expect(report).toHaveBeenCalledWith('ok', 'Public', 'Cached 9 item(s) from /PUBLIC');
    expect(report).toHaveBeenCalledWith('ok', 'Jobs', 'Indexed 3 feed(s) — topology warming in background');
    expect(report).toHaveBeenCalledWith('ok', 'Engine', 'Ready');
    expect(mockTopologyWarmup).toHaveBeenCalledTimes(1);
    expect(mockDaemonLaunch).toHaveBeenCalledWith(engine, expect.any(Function));

    const readyOrder: number = report.mock.invocationCallOrder[report.mock.calls.findIndex((call: unknown[]) => call[1] === 'Engine')];
    expect(readyOrder).toBeLessThan(mockDaemonListen.mock.invocationCallOrder[0]);
  });

  it('reports incomplete readiness while still publishing a lazily loadable daemon', async () => {
    mockStackPop.mockReturnValue({ message: 'bin failed' });
    mockDataGet.mockResolvedValue({ ok: false });
    mockPrefetchPath.mockResolvedValue({ ok: false, message: 'path failed' });
    mockProcCacheRefresh.mockRejectedValue(new Error('jobs failed'));
    const report = jest.fn();
    const engine: BrasaEngine = {
      line_execute: jest.fn(async () => []),
      line_complete: jest.fn(async (prefix: string) => ({ candidates: [], prefix })),
    };

    await daemonSession_run(engine, 'rudolph', {
      plugins: true,
      feeds: true,
      publicFeeds: true,
      jobs: true,
    }, false, { log: report });

    expect(report).toHaveBeenCalledWith('fail', 'Plugins', 'bin failed');
    expect(report).toHaveBeenCalledWith('fail', 'Feeds', 'path failed');
    expect(report).toHaveBeenCalledWith('fail', 'Public', 'path failed');
    expect(report).toHaveBeenCalledWith('fail', 'Jobs', 'jobs failed');
    expect(report).toHaveBeenCalledWith(
      'fail',
      'Engine',
      'Starting with incomplete warm-up: Plugins, Feeds, Public, Jobs',
    );
    expect(mockTopologyWarmup).not.toHaveBeenCalled();
    expect(mockDaemonListen).toHaveBeenCalledTimes(1);
  });

  it('reports disabled caches without trying to warm them', async () => {
    const report = jest.fn();

    const cache = await startupWarmup_run({
      plugins: false,
      feeds: false,
      publicFeeds: false,
      jobs: false,
    }, 'rudolph', false, { log: report });

    expect(cache.failures).toEqual([]);
    expect(report).toHaveBeenCalledWith('skip', 'Plugins', 'Prefetch disabled');
    expect(report).toHaveBeenCalledWith('skip', 'Pipelines', 'Prefetch disabled');
    expect(report).toHaveBeenCalledWith('skip', 'Feeds', 'Prefetch disabled');
    expect(report).toHaveBeenCalledWith('skip', 'Jobs', 'Prefetch disabled');
    expect(mockDataGet).not.toHaveBeenCalled();
  });

  it('reports offline caches and skips network work', async () => {
    mockSession.offline = true;
    const report = jest.fn();

    await startupWarmup_run({
      plugins: true,
      feeds: true,
      publicFeeds: true,
      jobs: true,
    }, 'rudolph', false, { log: report });

    expect(report).toHaveBeenCalledWith('skip', 'Plugins', 'Offline mode');
    expect(report).toHaveBeenCalledWith('skip', 'Pipelines', 'Offline mode');
    expect(report).toHaveBeenCalledWith('skip', 'Feeds', 'Offline mode');
    expect(report).toHaveBeenCalledWith('skip', 'Jobs', 'Offline mode');
    expect(mockDataGet).not.toHaveBeenCalled();
  });

  it('skips private feeds without a user while still warming public feeds', async () => {
    const report = jest.fn();

    await startupWarmup_run({
      plugins: false,
      feeds: true,
      publicFeeds: true,
      jobs: false,
    }, undefined, false, { log: report });

    expect(report).toHaveBeenCalledWith('skip', 'Feeds', 'No user context');
    expect(mockPrefetchPath).toHaveBeenCalledWith('/PUBLIC');
  });
});
