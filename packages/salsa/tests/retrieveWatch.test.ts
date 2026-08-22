/**
 * Tests for the PACS retrieve engine: firing (retry, unfired), the LONK watch
 * state machine (progress, done, error, stall, timeout, no-activity), the
 * idempotency skip, and the confirm loop. The LONK WebSocket and cumin's PACS
 * calls are stubbed; timers are faked to drive the watch checker.
 */
import { EventEmitter } from 'events';

const wsInstances: MockWebSocket[] = [];
class MockWebSocket extends EventEmitter {
  public sent: Record<string, unknown>[] = [];
  constructor(public readonly url: string) {
    super();
    wsInstances.push(this);
  }
  // 'open' fires synchronously at listener registration so tests never race
  // the handshake under fake timers (which also fake process.nextTick).
  public override once(event: string | symbol, listener: (...args: unknown[]) => void): this {
    if (event === 'open') { listener(); return this; }
    return super.once(event, listener);
  }
  public send(payload: string): void {
    this.sent.push(JSON.parse(payload) as Record<string, unknown>);
  }
  public close(): void {
    this.emit('close');
  }
}
jest.mock('ws', () => ({ __esModule: true, default: MockWebSocket }));

const mockQueriesCreate = jest.fn();
const mockRetrieveCreate = jest.fn();
const mockStorageResolve = jest.fn();
jest.mock('@fnndsc/cumin', () => {
  const actual = jest.requireActual('@fnndsc/cumin');
  return {
    ...actual,
    pacsQueries_create: (...args: unknown[]) => mockQueriesCreate(...args),
    pacsRetrieve_create: (...args: unknown[]) => mockRetrieveCreate(...args),
    seriesStorage_resolve: (...args: unknown[]) => mockStorageResolve(...args),
  };
});

import {
  retrieveTask_make,
  retrieveTasks_skipComplete,
  retrieve_fireAndWatch,
  retrieve_confirmLoop,
  retrieveProgress_classify,
  type RetrieveTask,
} from '../src/retrieve/watch';

const ok = <T>(value: T) => ({ ok: true as const, value });
const err = () => ({ ok: false as const });

const fakeClient = {
  createDownloadToken: async () => ({
    data: { token: 'TOK' },
    url: 'https://cube.example/api/v1/downloadtokens/5/',
  }),
} as never;

const task = (uid: string = '1.2.3', expected: number = 2): RetrieveTask =>
  retrieveTask_make({ label: `series-${uid}`, seriesUID: uid, studyUID: '1.2', pacsName: 'AET', expectedFiles: expected });

const lonk = (seriesUID: string, message: Record<string, unknown>): Buffer =>
  Buffer.from(JSON.stringify({ SeriesInstanceUID: seriesUID, message }));

const flush = async (): Promise<void> => {
  for (let i = 0; i < 50; i++) await Promise.resolve();
};

beforeEach(() => {
  jest.clearAllMocks();
  wsInstances.length = 0;
  mockQueriesCreate.mockResolvedValue(ok({ id: 100 }));
  mockRetrieveCreate.mockResolvedValue(ok({ id: 200 }));
  mockStorageResolve.mockResolvedValue(ok({ fileCount: 0, folderPath: null }));
});
afterEach(() => {
  jest.useRealTimers();
});

describe('retrieveProgress_classify', () => {
  it('maps every lifecycle state', () => {
    const t = task();
    expect(retrieveProgress_classify(t)).toBe('running');
    t.status = 'pulled';
    t.lonkConfirmed = true;
    expect(retrieveProgress_classify(t)).toBe('done');
    t.lonkConfirmed = false;
    expect(retrieveProgress_classify(t)).toBe('unconfirmed');
    t.status = 'unfired';
    expect(retrieveProgress_classify(t)).toBe('error');
    t.status = 'stalled';
    expect(retrieveProgress_classify(t)).toBe('stalled');
  });
});

describe('retrieveTasks_skipComplete', () => {
  it('skips series already fully registered, keeping incomplete ones', async () => {
    mockStorageResolve
      .mockResolvedValueOnce(ok({ fileCount: 2, folderPath: '/SERVICES/PACS/a' }))
      .mockResolvedValueOnce(ok({ fileCount: 1, folderPath: '/SERVICES/PACS/b' }));
    const complete = task('1.2.3', 2);
    const partial = task('4.5.6', 5);
    expect(await retrieveTasks_skipComplete([complete, partial])).toBe(1);
    expect(complete.status).toBe('pulled');
    expect(complete.cubePathDir).toBe('/SERVICES/PACS/a');
    expect(partial.status).toBe('pending');
  });
});

describe('retrieve_fireAndWatch', () => {
  it('subscribes, fires, and completes a series on a LONK done message', async () => {
    jest.useFakeTimers();
    const t = task();
    const statuses: string[] = [];
    const run = retrieve_fireAndWatch([t], 'PACSDCM', fakeClient, {
      task: (_t, status) => statuses.push(status),
    });
    await flush();

    const ws = wsInstances[0];
    expect(ws.url).toBe('wss://cube.example/api/v1/pacs/ws/?token=TOK');
    expect(ws.sent).toContainEqual({ SeriesInstanceUID: '1.2.3', pacs_name: 'AET', action: 'subscribe' });

    ws.emit('message', lonk('1.2.3', { ndicom: 1 }));
    ws.emit('message', lonk('1.2.3', { done: true }));
    await jest.advanceTimersByTimeAsync(2_000);
    expect(await run).toBe(0);

    expect(t.status).toBe('pulled');
    expect(t.lonkConfirmed).toBe(true);
    expect(t.actualFiles).toBe(2);
    expect(statuses).toContain('running');
    expect(statuses).toContain('done');
  });

  it('retries firing through creation failures before declaring unfired', async () => {
    jest.useFakeTimers();
    mockQueriesCreate
      .mockResolvedValueOnce(err())
      .mockResolvedValue(ok({ id: 100 }));
    const t = task();
    const run = retrieve_fireAndWatch([t], 'PACSDCM', fakeClient, {});
    await flush();
    // Drain the firing backoff, then complete the watch.
    await jest.advanceTimersByTimeAsync(1_000);
    wsInstances[0].emit('message', lonk('1.2.3', { done: true }));
    await jest.advanceTimersByTimeAsync(2_000);
    expect(await run).toBe(0);
    expect(t.status).toBe('pulled');
    expect(mockQueriesCreate).toHaveBeenCalledTimes(2);
  });

  it('declares a series unfired when creation keeps failing', async () => {
    jest.useFakeTimers();
    mockQueriesCreate.mockResolvedValue(err());
    const t = task();
    const run = retrieve_fireAndWatch([t], 'PACSDCM', fakeClient, {});
    await flush();
    await jest.advanceTimersByTimeAsync(1_000);
    expect(await run).toBe(1);
    expect(t.status).toBe('unfired');
  });

  it('marks a series errored on a LONK error message', async () => {
    jest.useFakeTimers();
    const t = task();
    const run = retrieve_fireAndWatch([t], 'PACSDCM', fakeClient, {});
    await flush();
    wsInstances[0].emit('message', lonk('1.2.3', { error: 'refused' }));
    await jest.advanceTimersByTimeAsync(2_000);
    await run;
    expect(t.status).toBe('error');
  });

  it('stalls a series whose progress stops', async () => {
    jest.useFakeTimers();
    const t = task();
    const run = retrieve_fireAndWatch([t], 'PACSDCM', fakeClient, {});
    await flush();
    wsInstances[0].emit('message', lonk('1.2.3', { ndicom: 1 }));
    await jest.advanceTimersByTimeAsync(34_000);
    await run;
    expect(t.status).toBe('stalled');
  });

  it('treats a silent fired series as pulled-unconfirmed after the no-activity window', async () => {
    jest.useFakeTimers();
    const t = task();
    const run = retrieve_fireAndWatch([t], 'PACSDCM', fakeClient, {});
    await flush();
    await jest.advanceTimersByTimeAsync(20_000);
    await run;
    expect(t.status).toBe('pulled');
    expect(t.lonkConfirmed).toBe(false);
  });

  it('fails in-flight series when the websocket errors', async () => {
    jest.useFakeTimers();
    const t = task();
    const run = retrieve_fireAndWatch([t], 'PACSDCM', fakeClient, {});
    await flush();
    wsInstances[0].emit('error', new Error('dropped'));
    await flush();
    await run;
    expect(t.status).toBe('error');
  });
});

describe('retrieve_confirmLoop', () => {
  it('confirms an unconfirmed series via storage without refiring', async () => {
    const t = task();
    t.status = 'pulled';
    t.lonkConfirmed = false;
    mockStorageResolve.mockResolvedValue(ok({ fileCount: 2, folderPath: '/SERVICES/PACS/x' }));
    expect(await retrieve_confirmLoop([t], 1, 'PACSDCM', fakeClient, {})).toBe(0);
    expect(t.lonkConfirmed).toBe(true);
    expect(t.cubePathDir).toBe('/SERVICES/PACS/x');
  });

  it('marks still-unconfirmed series errored after retries are exhausted', async () => {
    const t = task();
    t.status = 'pulled';
    t.lonkConfirmed = false;
    mockStorageResolve.mockResolvedValue(ok({ fileCount: 0, folderPath: null }));
    // retryMax 0: no refire rounds, straight to the error downgrade.
    await retrieve_confirmLoop([t], 0, 'PACSDCM', fakeClient, {});
    expect(t.status).toBe('error');
  });
});
