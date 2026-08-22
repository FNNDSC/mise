/**
 * Tests for the pull builtin as a consumer of the shared retrieve engine:
 * argument guards, path/expression resolution, the idempotency skip line,
 * summary rendering (unfired vs watch-failure labels), progress adaptation,
 * and feed/pipeline/plugin creation from the retrieved set. The engine itself
 * (firing, LONK watch, confirm loop) is mocked here and tested in salsa's
 * retrieveWatch suite.
 */
import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import type { OutputSink } from '../src/core/sink.js';
import type { ProgressEvent } from '../src/core/progress.js';

const mockProcFeedAdd = jest.fn();
const mockProcInstanceAdd = jest.fn();
const mockStorageResolve = jest.fn();
jest.unstable_mockModule('@fnndsc/cumin', () => ({
  envelope_ok: (rendered: string) => ({ status: 'ok', rendered }),
  envelope_error: (rendered: string, _errors?: unknown, renderedErr?: string) => (renderedErr !== undefined ? { status: 'error', rendered, renderedErr } : { status: 'error', rendered }),
  errorStack: { stack_push: jest.fn(), stack_getAll: jest.fn(() => []) },
  procCache_get: () => ({ feed_add: mockProcFeedAdd, instance_add: mockProcInstanceAdd }),
  seriesStorage_resolve: mockStorageResolve,
  Client: class {},
}));

/** A pending engine task, mirroring salsa's RetrieveTask shape. */
interface TestTask {
  label: string;
  seriesUID: string;
  studyUID: string;
  pacsName: string;
  expectedFiles: number;
  syntheticQueryId: number | null;
  retrieveId: number | null;
  status: string;
  actualFiles: number;
  lastProgressFiles: number;
  lastProgressTime: number;
  startTime: number;
  lonkConfirmed: boolean;
  cubePathDir: string | null;
}

const mockFeedCreate = jest.fn();
const mockPluginRun = jest.fn();
const mockTasksFire = jest.fn();
const mockSkipComplete = jest.fn();
const mockFireAndWatch = jest.fn();
const mockConfirmLoop = jest.fn();
jest.unstable_mockModule('@fnndsc/salsa', () => ({
  feed_create: mockFeedCreate,
  plugin_run: mockPluginRun,
  retrieveTask_make: (info: Record<string, unknown>): TestTask => ({
    ...(info as Pick<TestTask, 'label' | 'seriesUID' | 'studyUID' | 'pacsName' | 'expectedFiles'>),
    syntheticQueryId: null,
    retrieveId: null,
    status: 'pending',
    actualFiles: 0,
    lastProgressFiles: 0,
    lastProgressTime: 0,
    startTime: 0,
    lonkConfirmed: false,
    cubePathDir: null,
  }),
  retrieveTasks_fire: mockTasksFire,
  retrieveTasks_skipComplete: mockSkipComplete,
  retrieve_fireAndWatch: mockFireAndWatch,
  retrieve_confirmLoop: mockConfirmLoop,
  retrieveProgress_classify: (task: TestTask): string => {
    if (task.status === 'pulled') return task.lonkConfirmed ? 'done' : 'unconfirmed';
    if (task.status === 'pending' || task.status === 'pulling') return 'running';
    if (task.status === 'unfired') return 'error';
    return task.status;
  },
}));

const mockPipelineBuiltin = jest.fn();
jest.unstable_mockModule('../src/builtins/res/pipeline.js', () => ({
  builtin_pipeline: mockPipelineBuiltin,
}));

const mockCreateAndWait = jest.fn();
jest.unstable_mockModule('../src/builtins/net/query.js', () => ({
  pacsQuery_createAndWait: mockCreateAndWait,
  queryExpr_parse: (s: string): Record<string, string> | null => (s.includes(':') ? { PatientID: 'X' } : null),
}));

const mockCollect = jest.fn();
const mockServerResolve = jest.fn(async () => 'PACSDCM' as string | null);
jest.unstable_mockModule('../src/builtins/net/pacsUtils.js', () => ({
  pacs_seriesCollect: mockCollect,
  pacsServer_resolve: mockServerResolve,
}));

const mockCubepath = jest.fn();
jest.unstable_mockModule('../src/builtins/net/cubepath.js', () => ({ builtin_cubepath: mockCubepath }));

const mockPathResolve = jest.fn(async (p: string) => `/home/chris/${p}`);
jest.unstable_mockModule('../src/builtins/utils.js', () => ({ path_resolve: mockPathResolve }));

const mockClientGet = jest.fn();
jest.unstable_mockModule('../src/session/index.js', () => ({
  session: { connection: { client_get: mockClientGet } },
}));
jest.unstable_mockModule('../src/lib/spinner.js', () => ({
  spinner: { start: jest.fn(), stop: jest.fn(), updateMessage: jest.fn() },
}));

const { sink_set, StdoutSink } = await import('../src/core/sink.js');
const { builtin_pull } = await import('../src/builtins/fs/pull.js');

const QUERY_PATH: string = '/net/pacs/queries/q_qid:1';
const info = (seriesUID: string = '1.2.3', expectedFiles: number = 2) => ({
  label: `q|study|series-${seriesUID}`,
  seriesLabel: `series-${seriesUID}`,
  studyLabel: 'study',
  queryLabel: 'q',
  seriesUID,
  studyUID: '1.2',
  pacsName: 'AET',
  expectedFiles,
});
const fakeClient = {};

/** Drives every fired task to the given status through the mock engine. */
function fireOutcome_set(status: string, confirmed: boolean = true, dir: string | null = null): void {
  mockFireAndWatch.mockImplementation(async (tasks: TestTask[], _srv: unknown, _c: unknown, events?: { task?: (t: TestTask, s: string, p: string) => void }) => {
    for (const t of tasks) {
      t.status = status;
      t.lonkConfirmed = status === 'pulled' ? confirmed : false;
      if (dir !== null) t.cubePathDir = dir;
      if (status === 'pulled') t.actualFiles = t.expectedFiles;
      events?.task?.(t, status === 'pulled' ? (confirmed ? 'done' : 'unconfirmed') : 'error', 'watching');
    }
    return status === 'unfired' ? tasks.length : 0;
  });
}

const progressEvents: ProgressEvent[] = [];
let sinkData: string = '';
let sinkErr: string = '';
beforeEach(() => {
  jest.clearAllMocks();
  process.exitCode = 0;
  progressEvents.length = 0;
  sinkData = '';
  sinkErr = '';
  const progressSink: OutputSink = {
    data_write: (c: string | Buffer): void => { sinkData += typeof c === 'string' ? c : c.toString('utf-8'); },
    err_write: (c: string | Buffer): void => { sinkErr += typeof c === 'string' ? c : c.toString('utf-8'); },
    status_write: (): void => { /* not used */ },
    progress_write: (event: ProgressEvent): void => { progressEvents.push(event); },
  };
  sink_set(progressSink);
  mockCubepath.mockResolvedValue({ status: 'ok', rendered: '' });
  mockServerResolve.mockResolvedValue('PACSDCM');
  mockClientGet.mockResolvedValue(fakeClient);
  mockCollect.mockResolvedValue([info()]);
  mockSkipComplete.mockResolvedValue(0);
  mockConfirmLoop.mockResolvedValue(0);
  mockStorageResolve.mockResolvedValue({ ok: true, value: { fileCount: 2, folderPath: '/SERVICES/PACS/A/series-1' } });
  mockTasksFire.mockImplementation(async (tasks: TestTask[]) => {
    for (const t of tasks) t.retrieveId = 200;
  });
  fireOutcome_set('pulled');
  mockFeedCreate.mockResolvedValue({
    id: 300,
    name: 'Brain MRI',
    owner_username: 'chris',
    pluginInstance: { data: { id: 400 } },
  });
  mockPipelineBuiltin.mockResolvedValue({ status: 'ok', rendered: '' });
  mockPluginRun.mockResolvedValue({ id: 500, plugin_name: 'pl-dcm2niix' });
  mockPathResolve.mockImplementation(async (p: string) => `/home/chris/${p}`);
});
afterEach(() => {
  sink_set(new StdoutSink());
  process.exitCode = 0;
});

describe('builtin_pull guards and path resolution', () => {
  it('returns help for --help', async () => {
    const env = await builtin_pull(['--help']);
    expect(env.rendered).toContain('USAGE');
    expect(env.rendered).toContain('--new-feed <title>');
    expect(mockCollect).not.toHaveBeenCalled();
  });

  it('requires at least one path', async () => {
    await builtin_pull([]);
    expect(sinkErr).toContain('No paths specified');
    expect(process.exitCode).toBe(1);
  });

  it('errors when no PACS server is available', async () => {
    mockServerResolve.mockResolvedValue(null);
    await builtin_pull([QUERY_PATH]);
    expect(sinkErr).toContain('No PACS server available');
    expect(process.exitCode).toBe(1);
  });

  it('rejects an operand that is neither a PACS path nor a query', async () => {
    await builtin_pull(['/home/chris/feeds']);
    expect(sinkErr).toContain('Not a PACS VFS path');
    expect(sinkErr).toContain('No series to retrieve');
    expect(process.exitCode).toBe(1);
  });

  it('warns when a path yields no series', async () => {
    mockCollect.mockResolvedValue([]);
    await builtin_pull([QUERY_PATH]);
    expect(sinkErr).toContain(`No series found under: ${QUERY_PATH}`);
    expect(process.exitCode).toBe(1);
  });

  it('errors when not connected to ChRIS', async () => {
    mockClientGet.mockResolvedValue(null);
    await builtin_pull([QUERY_PATH]);
    expect(sinkErr).toContain('Not connected to ChRIS');
    expect(process.exitCode).toBe(1);
  });

  it('runs a query for an expression operand, then fires with --nowait', async () => {
    mockCreateAndWait.mockResolvedValue({ queryId: 9, vfsPath: '/net/pacs/queries/x_qid:9', decoded: { raw: '' } });
    await builtin_pull(['PatientID:77', '--nowait']);
    expect(mockCreateAndWait).toHaveBeenCalledWith('PatientID:77', 'pull_PatientID:77', 'PACSDCM', expect.any(Function));
    expect(mockTasksFire).toHaveBeenCalled();
    expect(sinkData).toContain('1.2.3 200');
  });

  it('reports a failed query expression', async () => {
    mockCreateAndWait.mockResolvedValue(null);
    await builtin_pull(['PatientID:77']);
    expect(sinkErr).toContain('Query failed for: PatientID:77');
  });

  it('prints seriesUID ERROR when a --nowait retrieve fails to fire', async () => {
    mockTasksFire.mockImplementation(async (tasks: TestTask[]) => {
      for (const t of tasks) t.status = 'unfired';
    });
    await builtin_pull([QUERY_PATH, '--nowait']);
    expect(sinkData).toContain('1.2.3 ERROR');
    expect(process.exitCode).toBe(1);
  });

  it('rejects --new-feed without a title', async () => {
    await builtin_pull([QUERY_PATH, '--new-feed']);
    expect(sinkErr).toContain('--new-feed requires a title');
    expect(process.exitCode).toBe(1);
  });

  it('rejects --new-feed with --nowait', async () => {
    await builtin_pull([QUERY_PATH, '--nowait', '--new-feed', 'Brain MRI']);
    expect(sinkErr).toContain('--new-feed cannot be combined with --nowait');
    expect(mockCollect).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });
});

describe('builtin_pull engine consumption', () => {
  it('pulls a series to completion and renders the success summary', async () => {
    await builtin_pull([QUERY_PATH]);
    expect(mockFireAndWatch).toHaveBeenCalledTimes(1);
    expect(sinkData).toContain('1/1 series pulled successfully');
    expect(mockCubepath).toHaveBeenCalledWith([QUERY_PATH, '--retry']);
    expect(progressEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({ operation: 'pull', itemId: '1.2.3', status: 'done' }),
      expect.objectContaining({ operation: 'pull', phase: 'complete', unit: 'series', status: 'done' }),
    ]));
    expect(process.exitCode).toBe(0);
  });

  it('labels unfired series as permanent loss and watch failures as verifiable', async () => {
    mockCollect.mockResolvedValue([info('1.2.3'), info('4.5.6')]);
    mockFireAndWatch.mockImplementation(async (tasks: TestTask[]) => {
      tasks[0].status = 'unfired';
      tasks[1].status = 'error';
      return 1;
    });
    await builtin_pull([QUERY_PATH]);
    expect(sinkData).toContain('0/2 series complete');
    expect(sinkData).toContain('FAILED TO FIRE');
    expect(sinkData).toContain('[ERROR — verify with: pacs status]');
    expect(sinkData).toContain('1 retrieve(s) were never fired');
    expect(process.exitCode).toBe(1);
  });

  it('skips series already fully registered and fires only the missing', async () => {
    mockCollect.mockResolvedValue([info('1.2.3'), info('4.5.6')]);
    mockSkipComplete.mockImplementation(async (tasks: TestTask[]) => {
      tasks[0].status = 'pulled';
      tasks[0].lonkConfirmed = true;
      return 1;
    });
    await builtin_pull([QUERY_PATH]);
    expect(sinkData).toContain('1/2 series already in CUBE — skipped');
    const watched: TestTask[] = mockFireAndWatch.mock.calls[0][0] as TestTask[];
    expect(watched).toHaveLength(1);
    expect(watched[0].seriesUID).toBe('4.5.6');
    expect(sinkData).toContain('2/2 series pulled successfully');
  });

  it('skips the watch entirely when every series is already registered', async () => {
    mockSkipComplete.mockImplementation(async (tasks: TestTask[]) => {
      for (const t of tasks) { t.status = 'pulled'; t.lonkConfirmed = true; }
      return 1;
    });
    await builtin_pull([QUERY_PATH]);
    expect(mockFireAndWatch).not.toHaveBeenCalled();
    expect(sinkData).toContain('1/1 series pulled successfully');
  });

  it('runs the confirm loop with the requested retry budget', async () => {
    await builtin_pull([QUERY_PATH, '--retry', '3']);
    expect(mockConfirmLoop).toHaveBeenCalledWith(expect.any(Array), 3, 'PACSDCM', fakeClient, expect.any(Object));
  });

  it('renders the retry-round banner when the engine announces a refire', async () => {
    mockConfirmLoop.mockImplementation(async (_tasks: unknown, _max: unknown, _srv: unknown, _c: unknown, events?: { retryRound?: (a: number, m: number, n: number) => void }) => {
      events?.retryRound?.(1, 3, 2);
      return 0;
    });
    await builtin_pull([QUERY_PATH, '--retry', '3']);
    expect(sinkData).toContain('Retry 1/3 for 2 unconfirmed series');
  });

  it('creates one named feed from the resolved directories after a complete pull', async () => {
    mockCollect.mockResolvedValue([info('1.2.3'), info('4.5.6')]);
    fireOutcome_set('pulled', true, null);
    mockStorageResolve
      .mockResolvedValueOnce({ ok: true, value: { fileCount: 2, folderPath: '/SERVICES/PACS/A/series-1' } })
      .mockResolvedValueOnce({ ok: true, value: { fileCount: 2, folderPath: '/SERVICES/PACS/A/series-2' } });

    await builtin_pull([QUERY_PATH, '--new-feed', 'Brain MRI']);

    expect(mockFeedCreate).toHaveBeenCalledWith(
      ['/SERVICES/PACS/A/series-1', '/SERVICES/PACS/A/series-2'],
      { title: 'Brain MRI' },
    );
    expect(sinkData).toContain('Feed created: 300');
    expect(sinkData).toContain('Root job: pl-dircopy (ID: 400)');
    expect(mockProcFeedAdd).toHaveBeenCalledWith(expect.objectContaining({ id: 300, title: 'Brain MRI' }));
    expect(mockProcInstanceAdd).toHaveBeenCalledWith(expect.objectContaining({ id: 400, feedID: 300 }));
    expect(process.exitCode).toBe(0);
  });

  it('prefers the engine-resolved cube path over a fresh storage lookup', async () => {
    fireOutcome_set('pulled', true, '/SERVICES/PACS/A/from-engine');
    await builtin_pull([QUERY_PATH, '--new-feed', 'Brain MRI']);
    expect(mockStorageResolve).not.toHaveBeenCalled();
    expect(mockFeedCreate).toHaveBeenCalledWith(['/SERVICES/PACS/A/from-engine'], { title: 'Brain MRI' });
  });

  it('attaches a pipeline to the new root with forwarded invocation tokens', async () => {
    fireOutcome_set('pulled', true, '/SERVICES/PACS/A/series-1');
    const result = await builtin_pull([
      QUERY_PATH, '--new-feed', 'Brain MRI', '--pipeline', 'brain-preprocessing', '--',
      '--segmentation.threshold', '0.6',
    ]);
    expect(mockPipelineBuiltin).toHaveBeenCalledWith([
      'run', 'brain-preprocessing', '--previous', '400', '--segmentation.threshold', '0.6',
    ]);
    expect(sinkData).toContain('Pipeline attached: brain-preprocessing');
    expect(result.status).toBe('ok');
  });

  it('attaches a versioned plugin to the new root with forwarded parameters', async () => {
    fireOutcome_set('pulled', true, '/SERVICES/PACS/A/series-1');
    const result = await builtin_pull([
      QUERY_PATH, '--new-feed', 'Brain MRI', '--plugin', 'pl-dcm2niix-v1.2.0', '--',
      '--outputdir', 'NIfTI files',
    ]);
    expect(mockPluginRun).toHaveBeenCalledWith(
      'name_exact:pl-dcm2niix,version:1.2.0',
      { outputdir: 'NIfTI files', previous_id: 400 },
    );
    expect(result.status).toBe('ok');
  });

  it('retains and reports the Feed when pipeline attachment fails', async () => {
    fireOutcome_set('pulled', true, '/SERVICES/PACS/A/series-1');
    mockPipelineBuiltin.mockResolvedValue({ status: 'error', rendered: '' });
    const result = await builtin_pull([
      QUERY_PATH, '--new-feed', 'Brain MRI', '--pipeline', 'broken-pipeline',
    ]);
    expect(sinkData).toContain('Feed created: 300');
    expect(sinkErr).toContain('Feed 300 and root 400 were retained');
    expect(result.status).toBe('error');
  });

  it('does not create a requested feed after a partial pull', async () => {
    mockCollect.mockResolvedValue([info('1.2.3'), info('4.5.6')]);
    mockFireAndWatch.mockImplementation(async (tasks: TestTask[]) => {
      tasks[0].status = 'pulled';
      tasks[0].lonkConfirmed = true;
      tasks[1].status = 'error';
      return 0;
    });
    const result = await builtin_pull([QUERY_PATH, '--new-feed', 'Incomplete']);
    expect(mockFeedCreate).not.toHaveBeenCalled();
    expect(sinkErr).toContain('New feed not created because retrieval was incomplete');
    expect(result.status).toBe('error');
    expect(process.exitCode).toBe(1);
  });

  it('does not create a requested feed when any operand is invalid', async () => {
    const result = await builtin_pull([QUERY_PATH, '/not/a/pacs/path', '--new-feed', 'Partial selection']);
    expect(mockFeedCreate).not.toHaveBeenCalled();
    expect(sinkErr).toContain('New feed not created because the requested selection was incomplete');
    expect(result.status).toBe('error');
  });

  it('does not create a requested feed when any operand contains no series', async () => {
    mockCollect
      .mockResolvedValueOnce([info('1.2.3')])
      .mockResolvedValueOnce([]);
    const emptyPath: string = '/net/pacs/queries/q_qid:2';
    const result = await builtin_pull([QUERY_PATH, emptyPath, '--new-feed', 'Partial selection']);
    expect(mockFeedCreate).not.toHaveBeenCalled();
    expect(sinkErr).toContain(`No series found under: ${emptyPath}`);
    expect(result.status).toBe('error');
  });

  it('preserves punctuation in the requested feed title', async () => {
    fireOutcome_set('pulled', true, '/SERVICES/PACS/A/series-1');
    await builtin_pull([QUERY_PATH, '--new-feed', 'Baseline, repeat: 2']);
    expect(mockFeedCreate).toHaveBeenCalledWith(expect.any(Array), { title: 'Baseline, repeat: 2' });
  });

  it('fails when a pulled series cannot be resolved to a CUBE directory', async () => {
    fireOutcome_set('pulled', true, null);
    mockStorageResolve.mockResolvedValue({ ok: true, value: { fileCount: 0, folderPath: null } });
    const result = await builtin_pull([QUERY_PATH, '--new-feed', 'Missing path']);
    expect(mockFeedCreate).not.toHaveBeenCalled();
    expect(sinkErr).toContain('Could not resolve CUBE storage for series 1.2.3');
    expect(result.status).toBe('error');
    expect(process.exitCode).toBe(1);
  });

  it('reports feed creation failure after a successful pull', async () => {
    fireOutcome_set('pulled', true, '/SERVICES/PACS/A/series-1');
    mockFeedCreate.mockResolvedValue(null);
    const result = await builtin_pull([QUERY_PATH, '--new-feed', 'Brain MRI']);
    expect(sinkErr).toContain("Failed to create feed 'Brain MRI'");
    expect(result.status).toBe('error');
    expect(process.exitCode).toBe(1);
  });

  it('requires an owner so every successful creation can print its feed path', async () => {
    fireOutcome_set('pulled', true, '/SERVICES/PACS/A/series-1');
    mockFeedCreate.mockResolvedValue({
      id: 300,
      name: 'Brain MRI',
      owner_username: '',
      pluginInstance: { data: { id: 400 } },
    });
    const result = await builtin_pull([QUERY_PATH, '--new-feed', 'Brain MRI']);
    expect(sinkErr).toContain("Failed to create feed 'Brain MRI'");
    expect(sinkData).not.toContain('Feed path:');
    expect(result.status).toBe('error');
  });
});
