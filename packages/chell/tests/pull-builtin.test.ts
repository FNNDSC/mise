import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { EventEmitter } from 'events';

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

interface FakeBar { update: jest.Mock; setTotal: jest.Mock }
const bars: FakeBar[] = [];
class MockMultiBar {
  create(): FakeBar {
    const bar: FakeBar = { update: jest.fn(), setTotal: jest.fn() };
    bars.push(bar);
    return bar;
  }
  stop(): void { /* no-op */ }
}
jest.unstable_mockModule('cli-progress', () => ({
  default: { MultiBar: MockMultiBar, Presets: { shades_classic: {} } },
}));

const mockQueriesCreate = jest.fn();
const mockRetrieveCreate = jest.fn();
jest.unstable_mockModule('@fnndsc/cumin', () => ({
  errorStack: { stack_push: jest.fn(), stack_getAll: jest.fn(() => []) },
  pacsQueries_create: mockQueriesCreate,
  pacsRetrieve_create: mockRetrieveCreate,
  Client: class {},
}));

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

let logSpy: jest.SpiedFunction<typeof console.log>;
let errSpy: jest.SpiedFunction<typeof console.error>;
beforeEach(() => {
  jest.clearAllMocks();
  process.exitCode = 0;
  wsOpenMode = 'open';
  wsInstances.length = 0;
  bars.length = 0;
  mockServerResolve.mockResolvedValue('PACSDCM');
  mockClientGet.mockResolvedValue(fakeClient);
  mockQueriesCreate.mockResolvedValue(ok({ id: 100 }));
  mockRetrieveCreate.mockResolvedValue(ok({ id: 200 }));
  mockCollect.mockResolvedValue([info()]);
  mockCubePathGet.mockResolvedValue(null);
  mockPathResolve.mockImplementation(async (p: string) => `/home/chris/${p}`);
  logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
  errSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  jest.useRealTimers();
});

const logged = (): string => logSpy.mock.calls.map(c => c.join(' ')).join('\n');

describe('builtin_pull guards and path resolution', () => {
  it('shows help for --help', async () => {
    await builtin_pull(['--help']);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('USAGE'));
    expect(mockCollect).not.toHaveBeenCalled();
  });

  it('requires at least one path', async () => {
    await builtin_pull([]);
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('No paths specified'));
    expect(process.exitCode).toBe(1);
  });

  it('errors when no PACS server is available', async () => {
    mockServerResolve.mockResolvedValue(null);
    await builtin_pull([QUERY_PATH]);
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('No PACS server available'));
    expect(process.exitCode).toBe(1);
  });

  it('rejects an operand that is neither a PACS path nor a query', async () => {
    await builtin_pull(['/home/chris/feeds']);
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('Not a PACS VFS path'));
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('No series to retrieve'));
    expect(process.exitCode).toBe(1);
  });

  it('warns when a path yields no series', async () => {
    mockCollect.mockResolvedValue([]);
    await builtin_pull([QUERY_PATH]);
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining(`No series found under: ${QUERY_PATH}`));
    expect(process.exitCode).toBe(1);
  });

  it('errors when not connected to ChRIS', async () => {
    mockClientGet.mockResolvedValue(null);
    await builtin_pull([QUERY_PATH]);
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('Not connected'));
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
    expect(logged()).toContain(QUERY_PATH);
    expect(logged()).toContain('1.2.3 200');
    expect(mockQueriesCreate).toHaveBeenCalledWith('PACSDCM', expect.objectContaining({ execute: false }));
  });

  it('reports a failed query expression', async () => {
    mockCreateAndWait.mockResolvedValue(null);
    await builtin_pull(['PatientID:X']);
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('Query failed for'));
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('No series to retrieve'));
    expect(process.exitCode).toBe(1);
  });

  it('prints seriesUID ERROR when a --nowait retrieve fails to fire', async () => {
    mockQueriesCreate.mockResolvedValue(err());
    await builtin_pull([QUERY_PATH, '--nowait']);
    expect(logged()).toContain('1.2.3 ERROR');
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
    expect(logged()).toContain('0/1 series complete');
    expect(logged()).toContain('1 retrieve(s) failed to start');
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

    expect(bars[0].update).toHaveBeenCalledWith(2);
    expect(bars[0].update).toHaveBeenCalledWith(2, { label: expect.stringContaining('[DONE]') });
    expect(logged()).toContain('1/1 series pulled successfully');
    expect(mockCubepath).toHaveBeenCalledWith([QUERY_PATH, '--retry']);
    expect(process.exitCode).toBe(0);
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

    expect(logged()).toContain('1/2 series complete');
    expect(logged()).toContain('[ERROR]');
    expect(process.exitCode).toBe(1);
  });

  it('fails all in-flight series on a websocket error', async () => {
    const pull = builtin_pull([QUERY_PATH]);
    await flush();

    wsInstances[0].emit('error', new Error('dropped'));
    await flush();
    await pull;

    expect(logged()).toContain('0/1 series complete');
    expect(process.exitCode).toBe(1);
  });

  it('marks a silent series stalled after progress stops', async () => {
    const pull = builtin_pull([QUERY_PATH]);
    await flush();

    wsInstances[0].emit('message', lonk('1.2.3', { ndicom: 1 }));
    await jest.advanceTimersByTimeAsync(34_000);
    await pull;

    expect(logged()).toContain('[STALLED]');
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

    expect(logged()).toContain('[TIMEOUT]');
    expect(process.exitCode).toBe(1);
  });

  it('fails a NO LONK series when retries are exhausted', async () => {
    const pull = builtin_pull([QUERY_PATH]);
    await flush();

    await jest.advanceTimersByTimeAsync(20_000);
    await pull;

    expect(logged()).toContain('0/1 series complete');
    expect(logged()).toContain('[ERROR]');
    expect(process.exitCode).toBe(1);
  });

  it('confirms a NO LONK series via CUBE path lookup on --retry', async () => {
    mockCubePathGet.mockResolvedValue({ folderPath: '/SERVICES/PACS/x', fileCount: 2 });
    const pull = builtin_pull([QUERY_PATH, '--retry', '1']);
    await flush();

    await jest.advanceTimersByTimeAsync(20_000);
    await pull;

    expect(mockCubePathGet).toHaveBeenCalledWith('1.2.3', fakeClient, 1, 0);
    expect(logged()).toContain('1/1 series pulled successfully');
    expect(process.exitCode).toBe(0);
  });

  it('re-fires unconfirmed series and succeeds on the retry pass', async () => {
    const pull = builtin_pull([QUERY_PATH, '--retry', '1']);
    await flush();

    await jest.advanceTimersByTimeAsync(20_000);
    await flush();

    expect(logged()).toContain('Retry 1/1 for 1 unconfirmed series');
    expect(wsInstances).toHaveLength(2);
    wsInstances[1].emit('message', lonk('1.2.3', { done: true }));
    await jest.advanceTimersByTimeAsync(4_000);
    await pull;

    expect(logged()).toContain('1/1 series pulled successfully');
    expect(process.exitCode).toBe(0);
  });
});
