/**
 * @file Tests shared interactive and daemon startup cache warming.
 *
 * @module
 */
import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import type { BrasaEngine } from '@fnndsc/brasa';
import type { StartupWarmupReporter } from '../src/core/startupWarmup.js';

const mockDataGet = jest.fn();
const mockSession: { offline: boolean } = { offline: false };
const mockStackPop = jest.fn((): { message: string } | undefined => undefined);
const mockPrefetchPath = jest.fn();
const mockQuestion = jest.fn(async (): Promise<string> => '');
const mockPrefetchWithSpinner = jest.fn(
  async (_label: string, _message: string, _interactive: boolean, action: () => Promise<unknown>): Promise<unknown> => action(),
);
const mockTopologyWarmup = jest.fn(async (): Promise<void> => undefined);
const mockTopologyReconcileFeeds = jest.fn(async (_feedIDs: number[]): Promise<void> => undefined);
const mockProcCacheRefresh = jest.fn(async (): Promise<number[]> => []);
const mockVfsRead = jest.fn();
const mockCheckpointRestore = jest.fn(async () => ({ restored: false, count: 0 }));
const mockRosterBootSync = jest.fn(async (): Promise<number[]> => []);
const mockRosterSync = jest.fn(async (): Promise<number[]> => []);
const mockWarmupComplete = jest.fn();
const mockCheckpointWatch = jest.fn();
const mockCacheClear = jest.fn();
let mockCacheLifecycle: { state: string; checkpointAt?: string } = { state: 'empty' };
const mockDaemonListen = jest.fn();
const mockLaunchInfo = {
  identity: 'me@https://cube.example.org/api/v1/',
  url: 'ws://pangea:42479',
  token: 'tok',
  berthPath: '/run/user/1/calypso/berth.json',
  argusUrl: 'http://pangea:42479/?token=tok',
  daemon: { surfaces_count: (): number => 0, busy_get: (): boolean => false },
  hostControl: { tiers: new Set<string>(), exposed: false },
  bindHost: '127.0.0.1',
};
const mockDaemonLaunch = jest.fn(
  async (_engine: BrasaEngine, beforeListen?: () => Promise<void>): Promise<typeof mockLaunchInfo> => {
    await beforeListen?.();
    mockDaemonListen();
    return mockLaunchInfo;
  },
);
const mockFaceBoot = jest.fn((): boolean => true);
const mockFaceReady = jest.fn((): boolean => true);
const mockFaceSuspend = jest.fn();
const mockFaceResume = jest.fn();
const mockFaceStop = jest.fn();

jest.unstable_mockModule('@fnndsc/brasa', () => ({
  warmupFailure_note: mockWarmupFailureNote,
  warmupFailure_clear: mockWarmupFailureClear,
  session: mockSession,
  vfs: { data_get: mockDataGet },
  prefetch_path: mockPrefetchPath,
  prefetch_withSpinner: mockPrefetchWithSpinner,
  repl_question: mockQuestion,
  error_stripDebugPrefix: (message: string): string => message,
  // Daemon warm-up installs a real progress renderer so its spinners reach
  // the terminal it is booting in; the sink itself is inert here.
  sink_set: jest.fn(),
  StdoutSink: class MockStdoutSink {},
  procIndex_snapshot: (): { jobs: number; feeds: number } => ({ jobs: 12, feeds: 3 }),
  // The boot logo module rides along with startupWarmup's import graph.
  logo_frameRender: (): string[] => [],
  logo_linesRender: (): string[] => [],
  logoRows_count: (): number => 0,
  logoColumns_count: (): number => 0,
}));
jest.unstable_mockModule('@fnndsc/salsa', () => ({
  vfsDispatcher: { read: mockVfsRead },
  procCache_refresh: mockProcCacheRefresh,
  procRoster_bootSync: mockRosterBootSync,
  procRoster_sync: mockRosterSync,
  procTopology_status: jest.fn(() => ({ state: 'complete', failure: undefined })),
  procTopology_reconcileFeeds: mockTopologyReconcileFeeds,
  procTopology_warmup: mockTopologyWarmup,
}));
/** Age of the oldest restored folder listing, in milliseconds. */
let mockOldestAge: number | null = null;

/** Records a deferred warm-up failure so a surface can announce it. */
const mockWarmupFailureNote = jest.fn<(label: string, message: string) => void>();

/** Clears a held failure when a later attempt succeeds. */
const mockWarmupFailureClear = jest.fn<(label: string) => void>();

/** Records the folders a roster arrival or departure changes. */
const mockRosterFoldersSet = jest.fn<(folders: Record<string, string>) => void>();

/** Steerable folder-listing checkpoint restore. */
const mockListCheckpointRestore = jest.fn<() => Promise<{ restored: boolean; count: number; reason?: string }>>(
  async () => ({ restored: false, count: 0, reason: 'no listing checkpoint' }),
);

jest.unstable_mockModule('@fnndsc/cumin', () => ({
  chrisContext: { ChRISURL_get: jest.fn(async () => 'https://cube.example.org/api/v1/') },
  errorStack: {
    stack_pop: mockStackPop,
    scope_run: (callback: () => void): void => callback(),
  },
  procCache_get: jest.fn(() => ({
    rosterFolders_set: mockRosterFoldersSet,
    cache_clear: mockCacheClear,
    warmup_complete: mockWarmupComplete,
    lifecycle_get: (): { state: string; checkpointAt?: string } => ({ ...mockCacheLifecycle }),
    feedIDs_get: (): number[] => [1, 2, 3],
    warmupProgress_get: (): { loaded: number; total: number; active: boolean } => ({
      loaded: 12,
      total: 12,
      active: false,
    }),
  })),
  procCheckpoint_restore: mockCheckpointRestore,
  listCheckpoint_restore: mockListCheckpointRestore,
  listCheckpoint_watch: jest.fn(() => (): void => undefined),
  queryIndexCheckpoint_restore: jest.fn(async () => ({ restored: false, count: 0, reason: 'no query index' })),
  queryIndexCheckpoint_save: jest.fn(async () => undefined),
  queryIndexCheckpoint_watch: jest.fn(() => (): void => undefined),
  queryIndex_sweep: jest.fn(async () => ({ ok: true, value: { indexed: 0, pages: 1, bounded: false } })),
  listCache_get: jest.fn(() => ({
    stats_get: (): { oldestAge: number | null } => ({ oldestAge: mockOldestAge }),
  })),
  procCheckpoint_watch: mockCheckpointWatch,
}));
jest.unstable_mockModule('@fnndsc/calypso', () => ({
  daemon_launch: mockDaemonLaunch,
  face_boot: mockFaceBoot,
  face_ready: mockFaceReady,
  face_suspend: mockFaceSuspend,
  face_resume: mockFaceResume,
  face_stop: mockFaceStop,
  identity_forSession: (user: string, url: string): string => `${user}@${url}`,
  hostControl_fromInputs: (): { policy: { tiers: Set<string>; exposed: boolean } } => ({ policy: { tiers: new Set<string>(), exposed: false } }),
  hostControl_describe: (): string => '',
}));

const { daemonSession_run, startupWarmup_run } = await import('../src/core/startupWarmup.js');

describe('daemonSession_run', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSession.offline = false;
    process.exitCode = undefined;
    mockStackPop.mockReturnValue(undefined);
    mockProcCacheRefresh.mockResolvedValue([]);
    mockTopologyWarmup.mockResolvedValue(undefined);
    mockTopologyReconcileFeeds.mockResolvedValue(undefined);
    mockVfsRead.mockResolvedValue({ ok: true, value: 'all_users:x:1:rudolph\npacs_users:x:2:rudolph\n' });
    mockCacheLifecycle = { state: 'empty' };
    mockCheckpointRestore.mockResolvedValue({ restored: false, count: 0 });
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

  it('keeps the classic boot and raises the face once the daemon is up', async () => {
    const engine: BrasaEngine = {
      line_execute: jest.fn(async () => []),
      line_complete: jest.fn(async (prefix: string) => ({ candidates: [], prefix })),
    };
    const flags = { plugins: false, feeds: false, publicFeeds: false, jobs: false };

    await daemonSession_run(engine, 'rudolph', flags, true, { log: jest.fn() });
    // The boot itself stays in the normal buffer (no boot-phase face).
    expect(mockFaceBoot).not.toHaveBeenCalled();
    expect(mockFaceReady).toHaveBeenCalledTimes(1);
    const options = mockFaceReady.mock.calls[0]![0] as {
      info: Array<{ label: string; value: string }>;
      telemetry_get: () => { sessions: number; busy: boolean; jobs: number; feeds: number };
    };
    // The face panel carries the launch's addresses verbatim.
    expect(options.info).toEqual(expect.arrayContaining([
      { label: 'wire', value: 'ws://pangea:42479' },
      { label: 'ARGUS', value: 'http://pangea:42479/?token=tok' },
    ]));
    // Live readings come from the daemon handle plus the proc index.
    expect(options.telemetry_get()).toEqual({ sessions: 0, busy: false, jobs: 12, feeds: 3 });

    // A non-interactive host (systemd) never takes the terminal over.
    mockFaceReady.mockClear();
    await daemonSession_run(engine, 'rudolph', flags, false, { log: jest.fn() });
    expect(mockFaceReady).not.toHaveBeenCalled();
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
    // Feeds, Public and Shared warm behind the prompt now: boot blocks
    // only on what the shell cannot work without, which is /bin.
    expect(report).toHaveBeenCalledWith('pending', 'Feeds', 'Warming /home/rudolph/feeds behind the prompt');
    expect(report).toHaveBeenCalledWith('pending', 'Public', 'Warming /PUBLIC behind the prompt');
    expect(report).toHaveBeenCalledWith('pending', 'Shared', 'Warming /SHARED behind the prompt');
    expect(report).toHaveBeenCalledWith('ok', 'Jobs', 'Indexed 3 feed(s) — topology reconciling in background');
    expect(report).toHaveBeenCalledWith('ok', 'Engine', 'Ready');
    expect(report).toHaveBeenCalledWith('ok', 'Topology', 'Ready — 12/12 job(s) indexed');
    expect(mockTopologyWarmup).toHaveBeenCalledTimes(1);
    expect(mockDaemonLaunch).toHaveBeenCalledWith(engine, expect.any(Function), { hostControl: { tiers: new Set<string>(), exposed: false } });

    const readyOrder: number = report.mock.invocationCallOrder[report.mock.calls.findIndex((call: unknown[]) => call[1] === 'Engine')];
    expect(readyOrder).toBeLessThan(mockDaemonListen.mock.invocationCallOrder[0]);
  });

  it('brings a restored checkpoint into service on a roster delta, with the full walk behind the listening daemon', async () => {
    mockCheckpointRestore.mockResolvedValueOnce({ restored: true, count: 7009, writtenAt: '2026-07-16T00:00:00Z' });
    mockRosterBootSync.mockResolvedValueOnce([4446]);
    mockRosterSync.mockResolvedValueOnce([17, 23]);
    const report = jest.fn();
    const engine: BrasaEngine = {
      line_execute: jest.fn(async () => []),
      line_complete: jest.fn(async (prefix: string) => ({ candidates: [], prefix })),
    };

    await daemonSession_run(engine, 'rudolph', { plugins: false, feeds: false, publicFeeds: false, jobs: true }, false, { log: report });

    expect(mockCheckpointRestore).toHaveBeenCalledWith('rudolph@https://cube.example.org/api/v1/');
    expect(mockCheckpointWatch).toHaveBeenCalledWith('rudolph@https://cube.example.org/api/v1/');
    expect(report).toHaveBeenCalledWith('ok', 'Jobs', 'Restored 7009 job(s); 3 feed(s), 1 new — full roster refresh in background');
    expect(mockProcCacheRefresh).not.toHaveBeenCalled();
    expect(mockWarmupComplete).toHaveBeenCalled();
    expect(mockRosterSync).toHaveBeenCalledWith(true);
    expect(mockTopologyWarmup).not.toHaveBeenCalled();
    expect(mockTopologyReconcileFeeds).not.toHaveBeenCalled();
    expect(report).toHaveBeenCalledWith('ok', 'Roster', '2 feed(s) moved while away; each refreshes on its next visit');
  });

  it('reports a background topology failure after publishing engine readiness', async () => {
    mockTopologyWarmup.mockRejectedValueOnce(new Error('topology connection lost'));
    const statusLog_mock = jest.fn<StartupWarmupReporter['log']>();
    const engine: BrasaEngine = {
      line_execute: jest.fn(async () => []),
      line_complete: jest.fn(async (prefix: string) => ({ candidates: [], prefix })),
    };

    await daemonSession_run(engine, 'rudolph', {
      plugins: true,
      feeds: true,
      publicFeeds: true,
      jobs: true,
    }, false, { log: statusLog_mock });
    await Promise.resolve();

    expect(statusLog_mock).toHaveBeenCalledWith('ok', 'Engine', 'Ready');
    expect(statusLog_mock).toHaveBeenCalledWith('fail', 'Topology', 'Warm-up failed: topology connection lost');
    expect(mockDaemonListen).toHaveBeenCalledTimes(1);
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
    // A deferred step's failure is not a boot row: it left the gate, and is
    // annunciated afterwards instead.
    expect(report).toHaveBeenCalledWith('pending', 'Feeds', expect.stringContaining('behind the prompt'));
    expect(report).toHaveBeenCalledWith('fail', 'Jobs', 'jobs failed');
    expect(report).toHaveBeenCalledWith(
      'fail',
      'Engine',
      'Starting with incomplete warm-up: Plugins, Jobs',
    );
    expect(mockTopologyWarmup).not.toHaveBeenCalled();
    expect(mockDaemonListen).toHaveBeenCalledTimes(1);
  });

  it('starts only after the operator elects to continue an exhausted warm-up', async () => {
    mockVfsRead.mockResolvedValue({ ok: false });
    mockStackPop.mockReturnValue({ message: 'membership service unavailable' });
    const recovery = jest.fn(async () => 'continue' as const);
    const report = jest.fn<StartupWarmupReporter['log']>();
    const engine: BrasaEngine = {
      line_execute: jest.fn(async () => []),
      line_complete: jest.fn(async (prefix: string) => ({ candidates: [], prefix })),
    };

    await daemonSession_run(
      engine,
      'rudolph',
      { plugins: false, feeds: false, publicFeeds: false, jobs: false },
      false,
      { log: report },
      recovery,
    );

    // Groups warms behind the prompt, so it no longer gates: the daemon
    // publishes its berth and the failure is annunciated afterwards.
    expect(recovery).not.toHaveBeenCalled();
    expect(report).toHaveBeenCalledWith('pending', 'Groups', 'Resolving /etc/group behind the prompt');
    expect(mockDaemonListen).toHaveBeenCalledTimes(1);
  });

  it('does not bind a daemon when the operator exits after exhausted warm-up', async () => {
    // Only a blocking step can gate a boot. `/bin` is the one thing the
    // shell cannot work without, so it is the one that still can.
    mockDataGet.mockResolvedValue({ ok: false });
    mockStackPop.mockReturnValue({ message: 'bin failed' });
    const recovery = jest.fn(async () => 'exit' as const);
    const report = jest.fn<StartupWarmupReporter['log']>();
    const engine: BrasaEngine = {
      line_execute: jest.fn(async () => []),
      line_complete: jest.fn(async (prefix: string) => ({ candidates: [], prefix })),
    };

    await daemonSession_run(
      engine,
      'rudolph',
      { plugins: true, feeds: false, publicFeeds: false, jobs: false },
      false,
      { log: report },
      recovery,
    );

    expect(recovery).toHaveBeenCalledWith(['Plugins']);
    expect(report).toHaveBeenCalledWith('fail', 'Engine', 'Startup aborted after incomplete warm-up: Plugins');
    expect(mockDaemonListen).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  it('quarantines restored topology when CUBE visibility validation fails', async () => {
    mockCacheLifecycle = { state: 'restored', checkpointAt: '2026-07-16T00:00:00Z' };
    mockCheckpointRestore.mockResolvedValueOnce({ restored: true, count: 10 });
    mockRosterBootSync.mockRejectedValueOnce(new Error('visibility unavailable'));
    const engine: BrasaEngine = {
      line_execute: jest.fn(async () => []),
      line_complete: jest.fn(async (prefix: string) => ({ candidates: [], prefix })),
    };

    await daemonSession_run(engine, 'rudolph', { plugins: false, feeds: false, publicFeeds: false, jobs: true }, false, { log: jest.fn() });

    expect(mockCacheClear).toHaveBeenCalled();
    expect(mockTopologyWarmup).not.toHaveBeenCalled();
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

  it('says which folder each kind of feed appears in, so an arrival dirties only that one', async () => {
    await startupWarmup_run({
      plugins: false,
      feeds: false,
      publicFeeds: false,
      jobs: false,
    }, 'rudolph', false, { log: jest.fn<StartupWarmupReporter['log']>() });

    expect(mockRosterFoldersSet).toHaveBeenCalledWith({
      owner: 'rudolph',
      own: '/home/rudolph/feeds',
      shared: '/SHARED',
      public: '/PUBLIC',
    });
  });

  describe('folder-listing restore row', () => {
    /** Restores a checkpoint of the given size and returns the row's message. */
    async function restoreRow_message(count: number, oldestAge: number | null): Promise<string> {
      mockOldestAge = oldestAge;
      mockListCheckpointRestore.mockResolvedValueOnce({ restored: true, count });
      const report = jest.fn<StartupWarmupReporter['log']>();
      await startupWarmup_run({
        plugins: false,
        feeds: false,
        publicFeeds: false,
        jobs: false,
      }, 'rudolph', false, { log: report });
      const row = report.mock.calls.find((call) => call[1] === 'Folders');
      return row === undefined ? '' : row[2];
    }

    it('names the row Folders and says folder listings, not the plugin index', async () => {
      const message: string = await restoreRow_message(47, 5 * 60_000);
      expect(message).toContain('Restored 47 folder listing(s)');
      expect(message).toContain('stale until revisited');
    });

    it('reports age as well as count, because a count alone says nothing', async () => {
      expect(await restoreRow_message(47, 5 * 60_000)).toContain('oldest 5 min');
      expect(await restoreRow_message(47, 3 * 60 * 60_000)).toContain('oldest 3 hour(s)');
      expect(await restoreRow_message(47, 3 * 24 * 60 * 60_000)).toContain('oldest 3 day(s)');
    });

    it('says all fresh when nothing has aged a minute', async () => {
      expect(await restoreRow_message(2, 500)).toContain('all fresh');
    });

    it('omits the age phrase when the cache holds nothing to age', async () => {
      const message: string = await restoreRow_message(0, null);
      expect(message).toBe('Restored 0 folder listing(s), stale until revisited');
    });

    it('reports the absent checkpoint in folder-listing words', async () => {
      mockOldestAge = null;
      mockListCheckpointRestore.mockResolvedValueOnce({ restored: false, count: 0 });
      const report = jest.fn<StartupWarmupReporter['log']>();
      await startupWarmup_run({
        plugins: false,
        feeds: false,
        publicFeeds: false,
        jobs: false,
      }, 'rudolph', false, { log: report });
      expect(report).toHaveBeenCalledWith('skip', 'Folders', 'No folder-listing checkpoint');
    });
  });

  it('hydrates /etc/group before the host becomes ready', async () => {
    const report = jest.fn<StartupWarmupReporter['log']>();

    await startupWarmup_run({
      plugins: false,
      feeds: false,
      publicFeeds: false,
      jobs: false,
    }, 'rudolph', false, { log: report });

    expect(mockVfsRead).toHaveBeenCalledWith('/etc/group');
    // Deferred: the row says pending, and the outcome is awaited.
    expect(report).toHaveBeenCalledWith('pending', 'Groups', 'Resolving /etc/group behind the prompt');
  });

  it('retries a transient group projection failure before declaring Groups failed', async () => {
    mockVfsRead
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce({ ok: true, value: 'all_users:x:1:rudolph\npacs_users:x:2:rudolph\n' });
    mockStackPop.mockReturnValueOnce({ message: 'No server response!' });
    const report = jest.fn<StartupWarmupReporter['log']>();

    const cache = await startupWarmup_run({
      plugins: false,
      feeds: false,
      publicFeeds: false,
      jobs: false,
    }, 'rudolph', false, { log: report });

    // A deferred step keeps its retry policy; the outcome is awaited
    // rather than read off the boot readout it no longer prints to.
    const groups = cache.deferred.find((step) => step.label === 'Groups');
    const outcome = await groups!.settled;
    expect(cache.failures).toEqual([]);
    expect(mockVfsRead).toHaveBeenCalledTimes(2);
    expect(outcome.ok).toBe(true);
    expect(outcome.count).toBe(2);
  });

  it('reports a failed group warm-up without preventing later startup work', async () => {
    mockVfsRead.mockResolvedValue({ ok: false });
    mockStackPop.mockReturnValue({ message: 'membership service unavailable' });
    const report = jest.fn<StartupWarmupReporter['log']>();

    const cache = await startupWarmup_run({
      plugins: false,
      feeds: false,
      publicFeeds: false,
      jobs: false,
    }, 'rudolph', false, { log: report });

    // Deferred steps do not gate; they are reported and awaited by the host.
    expect(cache.failures).toEqual([]);
    expect(cache.deferred.map((step) => step.label)).toContain('Groups');
    expect(report).toHaveBeenCalledWith('pending', 'Groups', 'Resolving /etc/group behind the prompt');
    const groups = cache.deferred.find((step) => step.label === 'Groups');
    expect((await groups!.settled).ok).toBe(false);
  });

  it('records a deferred failure so a surface can announce it, and clears it on success', async () => {
    mockVfsRead.mockResolvedValue({ ok: false });
    mockStackPop.mockReturnValue({ message: 'membership service unavailable' });
    const report = jest.fn<StartupWarmupReporter['log']>();

    const cache = await startupWarmup_run({
      plugins: false,
      feeds: false,
      publicFeeds: false,
      jobs: false,
    }, 'rudolph', false, { log: report });

    const groups = cache.deferred.find((step) => step.label === 'Groups');
    await groups!.settled;

    // A step that left the boot gate has no readout left to print to, so
    // the failure is held until a later attempt clears it.
    expect(mockWarmupFailureNote).toHaveBeenCalledWith('Groups', 'membership service unavailable');
    expect(mockWarmupFailureClear).not.toHaveBeenCalledWith('Groups');
  });

  it('warms /SHARED, where another identity\'s work becomes visible', async () => {
    const report = jest.fn<StartupWarmupReporter['log']>();

    const cache = await startupWarmup_run({
      plugins: false,
      feeds: true,
      publicFeeds: true,
      jobs: false,
    }, 'rudolph', false, { log: report });

    // It had no step at all before: nothing to fail, so a CUBE that
    // stopped serving shared paths stayed silent.
    expect(cache.deferred.map((step) => step.label)).toContain('Shared');
    expect(report).toHaveBeenCalledWith('pending', 'Shared', 'Warming /SHARED behind the prompt');
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

  it('keeps asynchronous topology settlement out of the interactive logger', async () => {
    const statusLog_mock = jest.fn<StartupWarmupReporter['log']>();

    await startupWarmup_run({
      plugins: false,
      feeds: false,
      publicFeeds: false,
      jobs: true,
    }, 'rudolph', true, { log: statusLog_mock });
    await Promise.resolve();

    expect(mockTopologyWarmup).toHaveBeenCalledTimes(1);
    expect(statusLog_mock.mock.calls.some((call: unknown[]) => call[1] === 'Topology')).toBe(false);
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
