import { EventEmitter } from 'events';
import { jest } from '@jest/globals';
import type { CommandEnvelope } from '@fnndsc/cumin';
import type { OutputSink } from '@fnndsc/brasa';
import type { ProgressEvent } from '@fnndsc/brasa';

type Scenario = (ws: FakeWebSocket, sent: Record<string, unknown>) => void;

let scenario: Scenario | undefined;
let attachResponse: Record<string, unknown> = {
  type: 'attached',
  session: 'test-session',
  protocolVersion: 1,
};

class FakeWebSocket extends EventEmitter {
  public static instances: FakeWebSocket[] = [];
  public sent: Record<string, unknown>[] = [];

  constructor(public readonly url: string) {
    super();
    FakeWebSocket.instances.push(this);
    process.nextTick(() => this.emit('open'));
  }

  public send(payload: string): void {
    const sent = JSON.parse(payload) as Record<string, unknown>;
    this.sent.push(sent);
    if (sent.type === 'attach') {
      process.nextTick(() => {
        this.emit('message', Buffer.from(JSON.stringify(attachResponse)));
      });
      return;
    }
    if (sent.type !== 'execute' && sent.type !== 'complete') {
      return;
    }
    scenario?.(this, sent);
  }

  public close(): void {
    this.emit('close');
  }
}

jest.unstable_mockModule('ws', () => ({ WebSocket: FakeWebSocket }));
jest.unstable_mockModule('@fnndsc/calypso', () => ({
  CONTRACT_VERSION: 1,
  serverMessage_parse: (value: unknown) => ({ ok: true, value }),
}));

// Isolate this surface unit from the engine barrel: provide just the sink
// boundary remoteEngine and this test share (installed sink, delivery).
let activeSink: OutputSink;
jest.unstable_mockModule('@fnndsc/brasa', () => ({
  sink_set: (sink: OutputSink): OutputSink => { const prev: OutputSink = activeSink; activeSink = sink; return prev; },
  sink_get: (): OutputSink => activeSink,
  // Imported transitively via prompt/session (promptFromContext_render); the
  // remote client renders a pushed context, it never builds one.
  sessionPromptContext_build: jest.fn(),
  // Imported transitively via config/settings (store-config persistence hook).
  storeUrl_set: jest.fn(),
  storeUrlOverride_get: jest.fn(),
  storeConfigPersist_install: jest.fn(),
  envelope_deliver: (envelope: CommandEnvelope): void => {
    if (envelope.rendered.length > 0) activeSink.data_write(envelope.rendered);
    if (envelope.renderedErr !== undefined && envelope.renderedErr.length > 0) activeSink.err_write(envelope.renderedErr);
  },
  StdoutSink: class {
    public data_write(): void { /* discard */ }
    public err_write(): void { /* discard */ }
    public status_write(): void { /* discard */ }
    public progress_write(): void { /* discard */ }
  },
}));

const { RemoteEngine } = await import('../src/remote/remoteEngine.js');
const { sink_set, StdoutSink } = await import('@fnndsc/brasa');

describe('RemoteEngine live output', () => {
  let remote: InstanceType<typeof RemoteEngine> | undefined;
  let data: string[];
  let err: string[];
  let status: string[];

  beforeEach(() => {
    scenario = undefined;
    attachResponse = {
      type: 'attached',
      session: 'test-session',
      protocolVersion: 1,
    };
    FakeWebSocket.instances.length = 0;
    data = [];
    err = [];
    status = [];
    const sink: OutputSink = {
      data_write: (chunk: string | Buffer): void => { data.push(chunk.toString()); },
      err_write: (chunk: string | Buffer): void => { err.push(chunk.toString()); },
      status_write: (text: string): void => { status.push(text); },
      progress_write: (_event: ProgressEvent): void => { /* not used */ },
    };
    sink_set(sink);
  });

  afterEach(() => {
    remote?.close();
    sink_set(new StdoutSink());
  });

  it('renders streamed stdout once and suppresses duplicate final data envelope text', async () => {
    scenario = (ws: FakeWebSocket, sent: Record<string, unknown>): void => {
      const id = String(sent.id);
      process.nextTick(() => {
        ws.emit('message', Buffer.from(JSON.stringify({ type: 'output', id, channel: 'data', chunk: 'live data' })));
        ws.emit('message', Buffer.from(JSON.stringify({
          type: 'result',
          id,
          envelopes: [{ status: 'ok', rendered: 'live data' }],
        })));
      });
    };

    remote = await RemoteEngine.connect({ url: 'ws://127.0.0.1:1', token: 'token' });
    const envelopes: CommandEnvelope[] = await remote.line_execute('echo live');

    expect(envelopes).toEqual([{ status: 'ok', rendered: 'live data' }]);
    expect(data).toEqual(['live data']);
    expect(err).toEqual([]);
  });

  it('does not suppress final envelope text for status-only output', async () => {
    scenario = (ws: FakeWebSocket, sent: Record<string, unknown>): void => {
      const id = String(sent.id);
      process.nextTick(() => {
        ws.emit('message', Buffer.from(JSON.stringify({ type: 'output', id, channel: 'status', chunk: 'working...' })));
        ws.emit('message', Buffer.from(JSON.stringify({
          type: 'result',
          id,
          envelopes: [{ status: 'ok', rendered: 'final data' }],
        })));
      });
    };

    remote = await RemoteEngine.connect({ url: 'ws://127.0.0.1:1', token: 'token' });
    await remote.line_execute('status');

    expect(status).toEqual(['working...']);
    expect(data).toEqual(['final data']);
  });

  it('suppresses only the live channel and still delivers non-streamed final stderr', async () => {
    scenario = (ws: FakeWebSocket, sent: Record<string, unknown>): void => {
      const id = String(sent.id);
      process.nextTick(() => {
        ws.emit('message', Buffer.from(JSON.stringify({ type: 'output', id, channel: 'data', chunk: 'live data' })));
        ws.emit('message', Buffer.from(JSON.stringify({
          type: 'result',
          id,
          envelopes: [{ status: 'error', rendered: 'live data', renderedErr: 'final err' }],
        })));
      });
    };

    remote = await RemoteEngine.connect({ url: 'ws://127.0.0.1:1', token: 'token' });
    await remote.line_execute('mixed');

    expect(data).toEqual(['live data']);
    expect(err).toEqual(['final err']);
  });

  it('resolves remote completions', async () => {
    scenario = (ws: FakeWebSocket, sent: Record<string, unknown>): void => {
      const id = String(sent.id);
      process.nextTick(() => {
        ws.emit('message', Buffer.from(JSON.stringify({
          type: 'complete',
          id,
          prefix: sent.prefix,
          candidates: ['ls', 'logout'],
        })));
      });
    };

    remote = await RemoteEngine.connect({ url: 'ws://127.0.0.1:1', token: 'token' });

    await expect(remote.line_complete('l')).resolves.toEqual({ prefix: 'l', candidates: ['ls', 'logout'] });
  });

  it('rejects correlated command errors', async () => {
    scenario = (ws: FakeWebSocket, sent: Record<string, unknown>): void => {
      const id = String(sent.id);
      process.nextTick(() => {
        ws.emit('message', Buffer.from(JSON.stringify({ type: 'error', id, reason: 'boom' })));
      });
    };

    remote = await RemoteEngine.connect({ url: 'ws://127.0.0.1:1', token: 'token' });

    await expect(remote.line_execute('bad')).rejects.toThrow('boom');
  });

  it('routes session broadcasts and prompt answers', async () => {
    const sessions: CommandEnvelope[] = [];
    scenario = (ws: FakeWebSocket, sent: Record<string, unknown>): void => {
      const id = String(sent.id);
      process.nextTick(() => {
        ws.emit('message', Buffer.from(JSON.stringify({
          type: 'session',
          surface: 'other',
          envelope: { status: 'ok', rendered: 'other output' },
        })));
        ws.emit('message', Buffer.from(JSON.stringify({
          type: 'prompt',
          promptId: 'p1',
          message: 'Password:',
          hidden: true,
        })));
        ws.emit('message', Buffer.from(JSON.stringify({
          type: 'result',
          id,
          envelopes: [{ status: 'ok', rendered: '' }],
        })));
      });
    };

    remote = await RemoteEngine.connect({
      url: 'ws://127.0.0.1:1',
      token: 'token',
      onSession: (_surface, envelope) => { sessions.push(envelope); },
      onPrompt: async () => 'secret',
    });
    await remote.line_execute('prompt');

    expect(sessions).toEqual([{ status: 'ok', rendered: 'other output' }]);
    expect(FakeWebSocket.instances[0].sent).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'promptAnswer', promptId: 'p1', answer: 'secret' }),
    ]));
  });

  it('answers pipe, edit, and close callbacks', async () => {
    let closed = false;
    scenario = (ws: FakeWebSocket, sent: Record<string, unknown>): void => {
      const id = String(sent.id);
      process.nextTick(() => {
        ws.emit('message', Buffer.from(JSON.stringify({
          type: 'pipe',
          pipeId: 'pipe1',
          command: 'wc -c',
          input: Buffer.from('abc').toString('base64'),
        })));
        ws.emit('message', Buffer.from(JSON.stringify({
          type: 'edit',
          editId: 'edit1',
          content: 'before',
          extension: '.txt',
        })));
        ws.emit('message', Buffer.from(JSON.stringify({
          type: 'result',
          id,
          envelopes: [{ status: 'ok', rendered: '' }],
        })));
      });
    };

    remote = await RemoteEngine.connect({
      url: 'ws://127.0.0.1:1',
      token: 'token',
      onPipe: async (_command, input) => Buffer.from(input.toString().toUpperCase()),
      onEdit: async (content) => ({ content: `${content} after`, changed: true }),
      onClose: () => { closed = true; },
    });
    await remote.line_execute('callbacks');
    remote.close();

    expect(FakeWebSocket.instances[0].sent).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'pipeResult', pipeId: 'pipe1', output: Buffer.from('ABC').toString('base64') }),
      expect.objectContaining({ type: 'editResult', editId: 'edit1', content: 'before after', changed: true }),
    ]));
    expect(closed).toBe(true);
  });

  it('returns a pipe error when the local segment fails', async () => {
    scenario = (ws: FakeWebSocket, sent: Record<string, unknown>): void => {
      const id: string = String(sent.id);
      process.nextTick(() => {
        ws.emit('message', Buffer.from(JSON.stringify({
          type: 'pipe',
          pipeId: 'pipe1',
          command: 'signalflow',
          input: Buffer.from('pipeline: test').toString('base64'),
        })));
        ws.emit('message', Buffer.from(JSON.stringify({
          type: 'result',
          id,
          envelopes: [{ status: 'error', rendered: '' }],
        })));
      });
    };

    remote = await RemoteEngine.connect({
      url: 'ws://127.0.0.1:1',
      token: 'token',
      onPipe: async (): Promise<Buffer> => {
        throw new Error("Command 'signalflow' exited with code 1");
      },
    });
    await remote.line_execute('pipeline --signalflow | signalflow');
    await new Promise<void>((resolve: () => void): void => process.nextTick(resolve));

    expect(FakeWebSocket.instances[0].sent).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'pipeError',
        pipeId: 'pipe1',
        reason: "Command 'signalflow' exited with code 1",
      }),
    ]));
  });

  it('rejects attach errors', async () => {
    attachResponse = { type: 'error', reason: 'invalid token' };

    await expect(RemoteEngine.connect({ url: 'ws://127.0.0.1:1', token: 'bad' }))
      .rejects.toThrow('attach refused: invalid token');
  });
});
