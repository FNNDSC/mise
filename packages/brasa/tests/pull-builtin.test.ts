import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { EventEmitter } from 'events';
import type { OutputSink } from '../src/core/sink.js';
import type { ProgressEvent } from '../src/core/progress.js';

// LONK WebSocket stand-in. 'open' (or a connect error) fires synchronously at
// listener registration so tests never race the connection handshake; message
// and lifecycle events are emitted by the tests themselves.
let wsOpenMode: 'open' | 'fail' = 'open';
const wsInstances: MockWebSocket[] = [];
class MockWebSocket extends EventEmitter {
  url: string;
  send = jest.fn();
  close = jest.fn((): void => { this.emit('close'); });
  constructor(url: string) {
    super();
    this.url = url;
    wsInstances.push(this);
  }
  override once(event: string | symbol, listener: (...args: unknown[]) => void): this {
    if (wsOpenMode === 'open' && event === 'open') { listener(); return this; }
    if (wsOpenMode === 'fail' && event === 'error') { listener(new Error('ws connect failed')); return this; }
    return super.once(event, listener);
  }
}
jest.unstable_mockModule('ws', () => ({ default: MockWebSocket }));

const mockQueriesCreate = jest.fn();
const mockRetrieveCreate = jest.fn();
const mockProcFeedAdd = jest.fn();
const mockProcInstanceAdd = jest.fn();
jest.unstable_mockModule('@fnndsc/cumin', () => ({
  envelope_ok: (rendered: string) => ({ status: 'ok', rendered }),
  envelope_error: (rendered: string, _errors?: unknown, renderedErr?: string) => (renderedErr !== undefined ? { status: 'error', rendered, renderedErr } : { status: 'error', rendered }),
  errorStack: { stack_push: jest.fn(), stack_getAll: jest.fn(() => []) },
  pacsQueries_create: mockQueriesCreate,
  pacsRetrieve_create: mockRetrieveCreate,
  procCache_get: () => ({ feed_add: mockProcFeedAdd, instance_add: mockProcInstanceAdd }),
  Client: class {},
}));

const mockFeedCreate = jest.fn();
jest.unstable_mockModule('@fnndsc/salsa', () => ({ feed_create: mockFeedCreate }));

const mockCreateAndWait = jest.fn();
jest.unstable_mockModule('../src/builtins/net/query.js', () => ({
  pacsQuery_createAndWait: mockCreateAndWait,
  queryExpr_parse: (s: string): Record<string, string> | null => (s.includes(':') ? { PatientID: 'X' } : null),
}));

const mockCollect = jest.fn();
const mockServerResolve = jest.fn(async () => 'PACSDCM' as string | null);
const mockCubePathGet = jest.fn();
jest.unstable_mockModule('../src/builtins/net/pacsUtils.js', () => ({
  pacs_seriesCollect: mockCollect,
  pacsServer_resolve: mockServerResolve,
  series_cubePathGet: mockCubePathGet,
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

const ok = <T>(value: T) => ({ ok: true as const, value });
const err = () => ({ ok: false as const });

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
const fakeClient = {
  createDownloadToken: async () => ({
    data: { token: 'TOK' },
    url: 'https://cube.example/api/v1/downloadtokens/5/',
  }),
};

const lonk = (seriesUID: string, message: Record<string, unknown>): string =>
  JSON.stringify({ SeriesInstanceUID: seriesUID, message });

// Drains chained promise continuations (unaffected by fake timers).
const flush = async (): Promise<void> => {
  for (let i = 0; i < 50; i++) await Promise.resolve();
};

const progressEvents: ProgressEvent[] = [];
let sinkData: string = '';
let sinkErr: string = '';
beforeEach(() => {
  jest.clearAllMocks();
  process.exitCode = 0;
  wsOpenMode = 'open';
  wsInstances.length = 0;
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
  mockQueriesCreate.mockResolvedValue(ok({ id: 100 }));
  mockRetrieveCreate.mockResolvedValue(ok({ id: 200 }));
  mockCollect.mockResolvedValue([info()]);
  mockCubePathGet.mockResolvedValue(null);
  mockFeedCreate.mockResolvedValue({
    id: 300,
    name: 'Brain MRI',
    owner_username: 'chris',
    pluginInstance: { data: { id: 400 } },
  });
  mockPathResolve.mockImplementation(async (p: string) => `/home/chris/${p}`);
});
afterEach(() => {
  jest.useRealTimers();
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
    expect(sinkErr).toContain(('No paths specified'));
    expect(process.exitCode).toBe(1);
  });

  it('errors when no PACS server is available', async () => {
    mockServerResolve.mockResolvedValue(null);
    await builtin_pull([QUERY_PATH]);
    expect(sinkErr).toContain(('No PACS server available'));
    expect(process.exitCode).toBe(1);
  });

  it('rejects an operand that is neither a PACS path nor a query', async () => {
    await builtin_pull(['/home/chris/feeds']);
    expect(sinkErr).toContain(('Not a PACS VFS path'));
    expect(sinkErr).toContain(('No series to retrieve'));
    expect(process.exitCode).toBe(1);
  });

  it('warns when a path yields no series', async () => {
    mockCollect.mockResolvedValue([]);
    await builtin_pull([QUERY_PATH]);
    expect(sinkErr).toContain((`No series found under: ${QUERY_PATH}`));
    expect(process.exitCode).toBe(1);
  });

  it('errors when not connected to ChRIS', async () => {
    mockClientGet.mockResolvedValue(null);
    await builtin_pull([QUERY_PATH]);
    expect(sinkErr).toContain(('Not connected'));
    expect(process.exitCode).toBe(1);
  });

  it('resolves a relative operand through path_resolve', async () => {
    mockPathResolve.mockResolvedValue(QUERY_PATH);
    await builtin_pull(['q_qid:1', '--nowait']);
    expect(mockPathResolve).toHaveBeenCalledWith('q_qid:1');
    expect(mockCollect).toHaveBeenCalledWith(QUERY_PATH, 'PACSDCM', 'pull');
  });

  it('runs a query for an expression operand, then fires with --nowait', async () => {
    mockCreateAndWait.mockResolvedValue({ queryId: 9, vfsPath: QUERY_PATH, decoded: {} });
    await builtin_pull(['PatientID:X', '--nowait']);
    // The RAW expression is queried — path resolution must not touch it.
    expect(mockCreateAndWait).toHaveBeenCalledWith(
      'PatientID:X', 'pull_PatientID:X', 'PACSDCM', expect.any(Function),
    );
    expect(sinkData).toContain(QUERY_PATH);
    expect(sinkData).toContain('1.2.3 200');
    expect(mockQueriesCreate).toHaveBeenCalledWith('PACSDCM', expect.objectContaining({ execute: false }));
  });

  it('reports a failed query expression', async () => {
    mockCreateAndWait.mockResolvedValue(null);
    await builtin_pull(['PatientID:X']);
    expect(sinkErr).toContain(('Query failed for'));
    expect(sinkErr).toContain(('No series to retrieve'));
    expect(process.exitCode).toBe(1);
  });

  it('prints seriesUID ERROR when a --nowait retrieve fails to fire', async () => {
    mockQueriesCreate.mockResolvedValue(err());
    await builtin_pull([QUERY_PATH, '--nowait']);
    expect(sinkData).toContain('1.2.3 ERROR');
    expect(process.exitCode).toBe(1);
  });

  it('rejects --new-feed without a title', async () => {
    await builtin_pull([QUERY_PATH, '--new-feed']);
    expect(sinkErr).toContain('--new-feed requires a title');
    expect(mockCollect).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  it('rejects --new-feed with --nowait', async () => {
    await builtin_pull([QUERY_PATH, '--nowait', '--new-feed', 'Brain MRI']);
    expect(sinkErr).toContain('--new-feed cannot be combined with --nowait');
    expect(mockCollect).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });
});

describe('builtin_pull watch loop', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  it('rejects when the LONK websocket cannot connect', async () => {
    wsOpenMode = 'fail';
    await expect(builtin_pull([QUERY_PATH])).rejects.toThrow('ws connect failed');
  });

  it('reports firing failures without entering the watch loop', async () => {
    mockQueriesCreate.mockResolvedValue(err());
    const pull = builtin_pull([QUERY_PATH]);
    await flush();
    await pull;
    expect(sinkData).toContain('0/1 series complete');
    expect(sinkData).toContain('1 retrieve(s) failed to start');
    expect(progressEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({ itemId: '1.2.3', status: 'error' }),
      expect.objectContaining({ operation: 'pull', phase: 'failed', unit: 'series', status: 'error' }),
    ]));
    expect(process.exitCode).toBe(1);
    expect(wsInstances[0].close).toHaveBeenCalled();
  });

  it('pulls a series to completion on LONK done', async () => {
    const pull = builtin_pull([QUERY_PATH]);
    await flush();

    expect(wsInstances).toHaveLength(1);
    const ws: MockWebSocket = wsInstances[0];
    expect(ws.url).toBe('wss://cube.example/api/v1/pacs/ws/?token=TOK');
    expect(ws.send).toHaveBeenCalledWith(
      JSON.stringify({ SeriesInstanceUID: '1.2.3', pacs_name: 'AET', action: 'subscribe' }),
    );

    ws.emit('message', 'not json');
    ws.emit('message', lonk('unknown-uid', { ndicom: 1 }));
    ws.emit('message', lonk('1.2.3', { ndicom: 1 }));
    ws.emit('message', lonk('1.2.3', { ndicom: 2 }));
    ws.emit('message', lonk('1.2.3', { done: true }));
    await jest.advanceTimersByTimeAsync(2_000);
    await pull;

    expect(progressEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({ operation: 'pull', itemId: '1.2.3', current: 1, status: 'running' }),
      expect.objectContaining({ operation: 'pull', itemId: '1.2.3', current: 2, status: 'done' }),
      expect.objectContaining({ operation: 'pull', phase: 'complete', unit: 'series', status: 'done' }),
    ]));
    expect(sinkData).toContain('1/1 series pulled successfully');
    expect(mockCubepath).toHaveBeenCalledWith([QUERY_PATH, '--retry']);
    expect(mockFeedCreate).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(0);
  });

  it('creates one named feed from the resolved directories after a complete pull', async () => {
    mockCollect.mockResolvedValue([info('1.2.3'), info('4.5.6')]);
    mockCubePathGet
      .mockResolvedValueOnce({ folderPath: '/SERVICES/PACS/A/series-1', fileCount: 2 })
      .mockResolvedValueOnce({ folderPath: '/SERVICES/PACS/A/series-2', fileCount: 2 });

    const pull = builtin_pull([QUERY_PATH, '--new-feed', 'Brain MRI']);
    await flush();
    wsInstances[0].emit('message', lonk('1.2.3', { done: true }));
    wsInstances[0].emit('message', lonk('4.5.6', { done: true }));
    await jest.advanceTimersByTimeAsync(2_000);
    await pull;

    expect(mockFeedCreate).toHaveBeenCalledWith(
      ['/SERVICES/PACS/A/series-1', '/SERVICES/PACS/A/series-2'],
      { title: 'Brain MRI' },
    );
    expect(sinkData).toContain('Feed created: 300');
    expect(sinkData).toContain('Root job: pl-dircopy (ID: 400)');
    expect(sinkData).toContain('Input: 2 PACS series');
    expect(sinkData).toContain('/home/chris/feeds/feed_300/pl-dircopy_400/data/');
    expect(mockProcFeedAdd).toHaveBeenCalledWith(expect.objectContaining({ id: 300, title: 'Brain MRI' }));
    expect(mockProcInstanceAdd).toHaveBeenCalledWith(expect.objectContaining({ id: 400, feedID: 300 }));
    expect(process.exitCode).toBe(0);
  });

  it('does not create a requested feed after a partial pull', async () => {
    mockCollect.mockResolvedValue([info('1.2.3'), info('4.5.6')]);
    const pull = builtin_pull([QUERY_PATH, '--new-feed', 'Incomplete']);
    await flush();
    wsInstances[0].emit('message', lonk('1.2.3', { done: true }));
    wsInstances[0].emit('message', lonk('4.5.6', { error: 'refused' }));
    await jest.advanceTimersByTimeAsync(2_000);
    const result = await pull;

    expect(mockFeedCreate).not.toHaveBeenCalled();
    expect(sinkErr).toContain('New feed not created because retrieval was incomplete');
    expect(result.status).toBe('error');
    expect(process.exitCode).toBe(1);
  });

  it('does not create a requested feed when any operand is invalid', async () => {
    mockCubePathGet.mockResolvedValue({ folderPath: '/SERVICES/PACS/A/series-1', fileCount: 2 });
    const pull = builtin_pull([QUERY_PATH, '/not/a/pacs/path', '--new-feed', 'Partial selection']);
    await flush();
    wsInstances[0].emit('message', lonk('1.2.3', { done: true }));
    await jest.advanceTimersByTimeAsync(2_000);
    const result = await pull;

    expect(mockFeedCreate).not.toHaveBeenCalled();
    expect(sinkErr).toContain('New feed not created because the requested selection was incomplete');
    expect(result.status).toBe('error');
  });

  it('does not create a requested feed when any operand contains no series', async () => {
    mockCollect
      .mockResolvedValueOnce([info('1.2.3')])
      .mockResolvedValueOnce([]);
    mockCubePathGet.mockResolvedValue({ folderPath: '/SERVICES/PACS/A/series-1', fileCount: 2 });
    const emptyPath: string = '/net/pacs/queries/q_qid:2';
    const pull = builtin_pull([QUERY_PATH, emptyPath, '--new-feed', 'Partial selection']);
    await flush();
    wsInstances[0].emit('message', lonk('1.2.3', { done: true }));
    await jest.advanceTimersByTimeAsync(2_000);
    const result = await pull;

    expect(mockFeedCreate).not.toHaveBeenCalled();
    expect(sinkErr).toContain(`No series found under: ${emptyPath}`);
    expect(sinkErr).toContain('New feed not created because the requested selection was incomplete');
    expect(result.status).toBe('error');
  });

  it('preserves punctuation in the requested feed title', async () => {
    mockCubePathGet.mockResolvedValue({ folderPath: '/SERVICES/PACS/A/series-1', fileCount: 2 });
    const pull = builtin_pull([QUERY_PATH, '--new-feed', 'Baseline, repeat: 2']);
    await flush();
    wsInstances[0].emit('message', lonk('1.2.3', { done: true }));
    await jest.advanceTimersByTimeAsync(2_000);
    await pull;

    expect(mockFeedCreate).toHaveBeenCalledWith(
      ['/SERVICES/PACS/A/series-1'],
      { title: 'Baseline, repeat: 2' },
    );
  });

  it('fails when a pulled series cannot be resolved to a CUBE directory', async () => {
    const pull = builtin_pull([QUERY_PATH, '--new-feed', 'Missing path']);
    await flush();
    wsInstances[0].emit('message', lonk('1.2.3', { done: true }));
    await jest.advanceTimersByTimeAsync(2_000);
    const result = await pull;

    expect(mockFeedCreate).not.toHaveBeenCalled();
    expect(sinkErr).toContain('Could not resolve CUBE storage for series 1.2.3');
    expect(result.status).toBe('error');
    expect(process.exitCode).toBe(1);
  });

  it('reports feed creation failure after a successful pull', async () => {
    mockCubePathGet.mockResolvedValue({ folderPath: '/SERVICES/PACS/A/series-1', fileCount: 2 });
    mockFeedCreate.mockResolvedValue(null);
    const pull = builtin_pull([QUERY_PATH, '--new-feed', 'Brain MRI']);
    await flush();
    wsInstances[0].emit('message', lonk('1.2.3', { done: true }));
    await jest.advanceTimersByTimeAsync(2_000);
    const result = await pull;

    expect(sinkErr).toContain("Failed to create feed 'Brain MRI'");
    expect(result.status).toBe('error');
    expect(process.exitCode).toBe(1);
  });

  it('requires an owner so every successful creation can print its feed path', async () => {
    mockCubePathGet.mockResolvedValue({ folderPath: '/SERVICES/PACS/A/series-1', fileCount: 2 });
    mockFeedCreate.mockResolvedValue({
      id: 300,
      name: 'Brain MRI',
      owner_username: '',
      pluginInstance: { data: { id: 400 } },
    });
    const pull = builtin_pull([QUERY_PATH, '--new-feed', 'Brain MRI']);
    await flush();
    wsInstances[0].emit('message', lonk('1.2.3', { done: true }));
    await jest.advanceTimersByTimeAsync(2_000);
    const result = await pull;

    expect(sinkErr).toContain("Failed to create feed 'Brain MRI'");
    expect(sinkData).not.toContain('Feed path:');
    expect(result.status).toBe('error');
    expect(process.exitCode).toBe(1);
  });

  it('marks a series failed on a LONK error message', async () => {
    mockCollect.mockResolvedValue([info('1.2.3'), info('4.5.6')]);
    const pull = builtin_pull([QUERY_PATH]);
    await flush();

    const ws: MockWebSocket = wsInstances[0];
    ws.emit('message', lonk('1.2.3', { done: true }));
    ws.emit('message', lonk('4.5.6', { error: 'refused' }));
    await jest.advanceTimersByTimeAsync(2_000);
    await pull;

    expect(sinkData).toContain('1/2 series complete');
    expect(sinkData).toContain('[ERROR]');
    expect(process.exitCode).toBe(1);
  });

  it('fails all in-flight series on a websocket error', async () => {
    const pull = builtin_pull([QUERY_PATH]);
    await flush();

    wsInstances[0].emit('error', new Error('dropped'));
    await flush();
    await pull;

    expect(sinkData).toContain('0/1 series complete');
    expect(process.exitCode).toBe(1);
  });

  it('marks a silent series stalled after progress stops', async () => {
    const pull = builtin_pull([QUERY_PATH]);
    await flush();

    wsInstances[0].emit('message', lonk('1.2.3', { ndicom: 1 }));
    await jest.advanceTimersByTimeAsync(34_000);
    await pull;

    expect(sinkData).toContain('[STALLED]');
    expect(progressEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({ itemId: '1.2.3', status: 'stalled' }),
    ]));
    expect(process.exitCode).toBe(1);
  });

  it('times out a series that never finishes', async () => {
    const pull = builtin_pull([QUERY_PATH]);
    await flush();

    // Keep progress ticking (dodging the stall check) until the 5 min cap.
    for (let n = 1; n <= 15; n++) {
      wsInstances[0].emit('message', lonk('1.2.3', { ndicom: n }));
      await jest.advanceTimersByTimeAsync(20_000);
    }
    await jest.advanceTimersByTimeAsync(4_000);
    await pull;

    expect(sinkData).toContain('[TIMEOUT]');
    expect(progressEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({ itemId: '1.2.3', status: 'timeout' }),
    ]));
    expect(process.exitCode).toBe(1);
  });

  it('fails a NO LONK series when retries are exhausted', async () => {
    const pull = builtin_pull([QUERY_PATH]);
    await flush();

    await jest.advanceTimersByTimeAsync(20_000);
    await pull;

    expect(sinkData).toContain('0/1 series complete');
    expect(sinkData).toContain('[ERROR]');
    expect(progressEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({ itemId: '1.2.3', status: 'unconfirmed' }),
      expect.objectContaining({ itemId: '1.2.3', status: 'error' }),
    ]));
    expect(process.exitCode).toBe(1);
  });

  it('confirms a NO LONK series via CUBE path lookup on --retry', async () => {
    mockCubePathGet.mockResolvedValue({ folderPath: '/SERVICES/PACS/x', fileCount: 2 });
    const pull = builtin_pull([QUERY_PATH, '--retry', '1']);
    await flush();

    await jest.advanceTimersByTimeAsync(20_000);
    await pull;

    expect(mockCubePathGet).toHaveBeenCalledWith('1.2.3', fakeClient, 1, 0);
    expect(progressEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({ itemId: '1.2.3', status: 'unconfirmed' }),
    ]));
    expect(sinkData).toContain('1/1 series pulled successfully');
    expect(process.exitCode).toBe(0);
  });

  it('re-fires unconfirmed series and succeeds on the retry pass', async () => {
    const pull = builtin_pull([QUERY_PATH, '--retry', '1']);
    await flush();

    await jest.advanceTimersByTimeAsync(20_000);
    await flush();

    expect(sinkData).toContain('Retry 1/1 for 1 unconfirmed series');
    expect(wsInstances).toHaveLength(2);
    wsInstances[1].emit('message', lonk('1.2.3', { done: true }));
    await jest.advanceTimersByTimeAsync(4_000);
    await pull;

    expect(sinkData).toContain('1/1 series pulled successfully');
    expect(process.exitCode).toBe(0);
  });
});
