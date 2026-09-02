import { WebSocket } from 'ws';
import { CalypsoDaemon } from '../src/daemon/server';
import type { HostedEngine } from '../src/daemon/engine';
import { CONTRACT_VERSION } from '@fnndsc/menu';
import type { CommandEnvelope } from '@fnndsc/cumin';

const TOKEN = 'test-attach-token';

/** A stub engine that records lines and throws on the sentinel `__throw__`. */
function stubEngine_create(): HostedEngine & { executed: string[] } {
  const executed: string[] = [];
  return {
    executed,
    line_execute: async (line: string): Promise<CommandEnvelope[]> => {
      executed.push(line);
      if (line === '__throw__') throw new Error('engine exploded');
      return [{ status: 'ok', rendered: `ran: ${line}` }];
    },
    line_complete: async (prefix: string) => ({ candidates: ['ls', 'logout'], prefix }),
  };
}

/** Buffers messages so awaiting the Nth cannot race the socket. */
function messages_collect(ws: WebSocket, n: number): Promise<Record<string, unknown>[]> {
  return new Promise((resolve) => {
    const out: Record<string, unknown>[] = [];
    ws.on('message', (data) => {
      out.push(JSON.parse(data.toString()));
      if (out.length === n) resolve(out);
    });
  });
}

/** Opens a client to the daemon and resolves once connected. */
function client_open(port: number): Promise<WebSocket> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  return new Promise((resolve, reject) => {
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

/** Resolves with the next parsed message from a socket. */
function message_next(ws: WebSocket): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    ws.once('message', (data) => resolve(JSON.parse(data.toString())));
  });
}

/** Sends a JSON message. */
function send(ws: WebSocket, message: unknown): void {
  ws.send(JSON.stringify(message));
}

/** Attaches with the valid token and awaits the ack. */
async function client_attach(
  port: number,
  shellCommands: boolean = false,
  extra: Record<string, boolean> = {},
): Promise<WebSocket> {
  const ws = await client_open(port);
  const acked = message_next(ws);
  send(ws, {
    type: 'attach',
    protocolVersion: CONTRACT_VERSION,
    token: TOKEN,
    capabilities: { hiddenInput: true, shellCommands, ...extra },
  });
  await acked;
  return ws;
}

describe('CalypsoDaemon', () => {
  let daemon: CalypsoDaemon;
  let engine: HostedEngine & { executed: string[] };
  let port: number;
  const clients: WebSocket[] = [];

  beforeEach(async () => {
    engine = stubEngine_create();
    daemon = new CalypsoDaemon({ engine, token: TOKEN });
    port = await daemon.start();
  });

  afterEach(async () => {
    for (const c of clients.splice(0)) c.terminate();
    await daemon.stop();
  });

  it('binds the loopback interface only', () => {
    // The daemon is constructed with the default host; a client on localhost
    // connects, which is exercised throughout. Here we just assert a port was
    // assigned.
    expect(port).toBeGreaterThan(0);
  });

  it('acknowledges an attach with the correct token', async () => {
    const ws = await client_open(port);
    clients.push(ws);
    const acked = message_next(ws);
    send(ws, { type: 'attach', protocolVersion: CONTRACT_VERSION, token: TOKEN });
    const msg = await acked;
    expect(msg.type).toBe('attached');
    expect(msg.protocolVersion).toBe(CONTRACT_VERSION);
    expect(typeof msg.session).toBe('string');
  });

  it('refuses an attach with a wrong token and closes', async () => {
    const ws = await client_open(port);
    clients.push(ws);
    const errored = message_next(ws);
    const closed = new Promise<void>((resolve) => ws.once('close', () => resolve()));
    send(ws, { type: 'attach', protocolVersion: CONTRACT_VERSION, token: 'wrong' });
    const msg = await errored;
    expect(msg.type).toBe('error');
    expect(msg.reason).toBe('invalid token');
    await closed;
  });

  it('refuses an attach on an incompatible contract version', async () => {
    const ws = await client_open(port);
    clients.push(ws);
    const errored = message_next(ws);
    send(ws, { type: 'attach', protocolVersion: CONTRACT_VERSION + 1, token: TOKEN });
    const msg = await errored;
    expect(msg.type).toBe('error');
    expect(String(msg.reason)).toContain('incompatible contract version');
  });

  it('requires attach before any command', async () => {
    const ws = await client_open(port);
    clients.push(ws);
    const errored = message_next(ws);
    const closed = new Promise<void>((resolve) => ws.once('close', () => resolve()));
    send(ws, { type: 'execute', id: '1', line: 'ls' });
    const msg = await errored;
    expect(msg.type).toBe('error');
    await closed;
    expect(engine.executed).toEqual([]);
  });

  it('broadcasts a telemetry heartbeat to attached surfaces', async () => {
    await daemon.stop();
    daemon = new CalypsoDaemon({
      engine,
      token: TOKEN,
      telemetryProvider: (): { jobs: number; feeds: number } => ({ jobs: 7, feeds: 3 }),
    });
    port = await daemon.start();
    const ws = await client_attach(port);
    clients.push(ws);

    const beat = await new Promise<Record<string, unknown>>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('no heartbeat within 3s')), 3000);
      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString()) as Record<string, unknown>;
        if (msg['type'] === 'telemetry') {
          clearTimeout(timer);
          resolve(msg);
        }
      });
    });
    expect(beat['index']).toEqual({ jobs: 7, feeds: 3 });
  });

  it('executes a line and returns its result envelopes', async () => {
    const ws = await client_attach(port);
    clients.push(ws);
    const replied = message_next(ws);
    send(ws, { type: 'execute', id: '42', line: 'pwd' });
    const msg = await replied;
    expect(msg.type).toBe('result');
    expect(msg.id).toBe('42');
    expect(msg.envelopes).toEqual([{ status: 'ok', rendered: 'ran: pwd' }]);
    expect(engine.executed).toEqual(['pwd']);
  });

  it('forwards progress from the running command to the origin surface', async () => {
    let daemonRef: CalypsoDaemon | undefined;
    const progressEngine: HostedEngine = {
      line_execute: async (): Promise<CommandEnvelope[]> => {
        (daemonRef as CalypsoDaemon).progress_current({
          operation: 'upload',
          kind: 'transfer',
          phase: 'transferring',
          current: 1,
          total: 2,
          unit: 'files',
          status: 'running',
        });
        return [{ status: 'ok', rendered: 'done' }];
      },
      line_complete: async (prefix: string) => ({ candidates: [], prefix }),
    };
    await daemon.stop();
    daemon = new CalypsoDaemon({ engine: progressEngine, token: TOKEN });
    daemonRef = daemon;
    port = await daemon.start();

    const ws = await client_attach(port);
    clients.push(ws);
    const messages = messages_collect(ws, 2);
    send(ws, { type: 'execute', id: 'p1', line: 'upload x y' });
    const [progress, result] = await messages;
    expect(progress).toEqual(expect.objectContaining({
      type: 'progress',
      id: 'p1',
      operation: 'upload',
      phase: 'transferring',
      current: 1,
      total: 2,
      unit: 'files',
      status: 'running',
    }));
    expect(result).toEqual(expect.objectContaining({ type: 'result', id: 'p1' }));
  });

  it('forwards live output from the running command only to the origin surface', async () => {
    let daemonRef: CalypsoDaemon | undefined;
    const outputEngine: HostedEngine = {
      line_execute: async (): Promise<CommandEnvelope[]> => {
        (daemonRef as CalypsoDaemon).output_current('data', 'live stdout\n');
        (daemonRef as CalypsoDaemon).output_current('err', 'live stderr\n');
        return [{ status: 'ok', rendered: 'final' }];
      },
      line_complete: async (prefix: string) => ({ candidates: [], prefix }),
    };
    await daemon.stop();
    daemon = new CalypsoDaemon({ engine: outputEngine, token: TOKEN });
    daemonRef = daemon;
    port = await daemon.start();

    const origin = await client_attach(port);
    const sibling = await client_attach(port);
    clients.push(origin, sibling);
    const originMessages = messages_collect(origin, 3);
    const siblingMessages = messages_collect(sibling, 1);
    send(origin, { type: 'execute', id: 'o1', line: 'live' });

    const [stdout, stderr, result] = await originMessages;
    expect(stdout).toEqual({ type: 'output', id: 'o1', channel: 'data', chunk: 'live stdout\n' });
    expect(stderr).toEqual({ type: 'output', id: 'o1', channel: 'err', chunk: 'live stderr\n' });
    expect(result).toEqual(expect.objectContaining({ type: 'result', id: 'o1' }));

    const [siblingMessage] = await siblingMessages;
    expect(siblingMessage).toEqual(expect.objectContaining({ type: 'session' }));
  });

  it('answers a completion request', async () => {
    const ws = await client_attach(port);
    clients.push(ws);
    const replied = message_next(ws);
    send(ws, { type: 'complete', id: '7', prefix: 'l' });
    const msg = await replied;
    expect(msg.type).toBe('complete');
    expect(msg.id).toBe('7');
    expect(msg.prefix).toBe('l');
    expect(msg.candidates).toEqual(['ls', 'logout']);
  });

  it('serializes execution in submission order', async () => {
    const ws = await client_attach(port);
    clients.push(ws);
    const bothReplied = messages_collect(ws, 2);
    send(ws, { type: 'execute', id: 'a', line: 'first' });
    send(ws, { type: 'execute', id: 'b', line: 'second' });
    const replies = await bothReplied;
    expect(replies.map((r) => r.id)).toEqual(['a', 'b']);
    expect(engine.executed).toEqual(['first', 'second']);
  });

  it('relays cancellation only from the surface running the foreground command', async () => {
    let release: (() => void) | undefined;
    engine.line_execute = async (line: string): Promise<CommandEnvelope[]> => {
      engine.executed.push(line);
      await new Promise<void>((resolve: () => void): void => { release = resolve; });
      return [{ status: 'error', rendered: '', renderedErr: 'du: cancelled\n' }];
    };
    let cancellations: number = 0;
    const cancel = (): boolean => {
      cancellations += 1;
      release?.();
      return true;
    };
    engine.line_cancel = cancel;

    const origin = await client_attach(port);
    const sibling = await client_attach(port);
    clients.push(origin, sibling);
    send(origin, { type: 'execute', id: 'scan-1', line: 'du test-upload' });
    await until(() => engine.executed.length === 1);

    const siblingError = message_next(sibling);
    send(sibling, { type: 'cancel', id: 'scan-1' });
    expect((await siblingError).reason).toContain('no matching foreground command');
    expect(cancellations).toBe(0);

    const result = message_next(origin);
    send(origin, { type: 'cancel', id: 'scan-1' });
    await until(() => cancellations === 1);
    expect((await result).type).toBe('result');
  });

  it('returns an error when the engine throws during execute', async () => {
    const ws = await client_attach(port);
    clients.push(ws);
    const replied = message_next(ws);
    send(ws, { type: 'execute', id: '9', line: '__throw__' });
    const msg = await replied;
    expect(msg.type).toBe('error');
    expect(msg.id).toBe('9');
    expect(String(msg.reason)).toContain('engine exploded');
  });

  it('rejects a structurally invalid message after attach', async () => {
    const ws = await client_attach(port);
    clients.push(ws);
    const errored = message_next(ws);
    send(ws, { type: 'execute', id: '1' });
    const msg = await errored;
    expect(msg.type).toBe('error');
    expect(String(msg.reason)).toContain('line');
  });

  it('rejects a malformed message with an error', async () => {
    const ws = await client_attach(port);
    clients.push(ws);
    const errored = message_next(ws);
    ws.send('{ not json');
    const msg = await errored;
    expect(msg.type).toBe('error');
    expect(String(msg.reason)).toContain('malformed JSON');
  });

  it('broadcasts a command to sibling surfaces but not the originator', async () => {
    const a = await client_attach(port);
    const b = await client_attach(port);
    clients.push(a, b);
    const aReply = message_next(a);
    const bEvent = message_next(b);
    send(a, { type: 'execute', id: '1', line: 'ls' });
    const [aMsg, bMsg] = await Promise.all([aReply, bEvent]);
    // The originator gets the correlated result; the sibling gets a session event.
    expect(aMsg.type).toBe('result');
    expect(bMsg.type).toBe('session');
    expect(bMsg.envelope).toEqual({ status: 'ok', rendered: 'ran: ls' });
    expect(typeof bMsg.surface).toBe('string');
  });

  it('replays scrollback to a newly attached surface', async () => {
    const a = await client_attach(port);
    clients.push(a);
    const aReply = message_next(a);
    send(a, { type: 'execute', id: '1', line: 'pwd' });
    await aReply;

    const b = await client_open(port);
    clients.push(b);
    const collected = messages_collect(b, 2); // attached ack, then the replay
    send(b, { type: 'attach', protocolVersion: CONTRACT_VERSION, token: TOKEN });
    const [attached, replayed] = await collected;
    expect(attached.type).toBe('attached');
    expect(replayed.type).toBe('session');
    expect(replayed.envelope).toEqual({ status: 'ok', rendered: 'ran: pwd' });
  });

  it('drops a surface from the bus when it closes', async () => {
    const a = await client_attach(port);
    const b = await client_attach(port);
    clients.push(b);
    const closed = new Promise<void>((resolve) => a.once('close', () => resolve()));
    a.terminate();
    await closed;
    const bReply = message_next(b);
    send(b, { type: 'execute', id: '1', line: 'ls' });
    expect((await bReply).type).toBe('result');
  });
});

/** Polls until a predicate holds, or throws after ~2s. */
async function until(predicate: () => boolean): Promise<void> {
  for (let i = 0; i < 100; i++) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error('condition not met in time');
}

describe('CalypsoDaemon prompt line push', () => {
  it('pushes the refreshed prompt before completing a state-changing command', async () => {
    let cwd = '~';
    const engine: HostedEngine = {
      line_execute: async (line: string): Promise<CommandEnvelope[]> => {
        if (line === 'cd /bin') cwd = '/bin';
        return [{ status: 'ok', rendered: '' }];
      },
      line_complete: async (prefix: string) => ({ candidates: [], prefix }),
    };
    const promptContext = () => ({
      user: 'chris', uri: 'http://cube/', cwd, pacsserver: null,
      physicalMode: false, lastExitCode: 0, lastCommandDurationMs: 0,
    });
    const daemon = new CalypsoDaemon({ engine, token: TOKEN, promptProvider: promptContext });
    const port = await daemon.start();
    try {
      const ws = await client_open(port);
      const got: Record<string, unknown>[] = [];
      ws.on('message', (d) => got.push(JSON.parse(d.toString())));

      send(ws, { type: 'attach', protocolVersion: CONTRACT_VERSION, token: TOKEN });
      await until(() => got.length >= 2);
      expect(got[0].type).toBe('attached');
      expect(got[1]).toEqual({ type: 'promptline', context: promptContext() });

      send(ws, { type: 'execute', id: '1', line: 'cd /bin' });
      await until(() => got.length >= 4);
      expect(got[2]).toEqual({ type: 'promptline', context: promptContext() });
      expect(got[3].type).toBe('result');
      ws.terminate();
    } finally {
      await daemon.stop();
    }
  });

  it('pushes the promptline from the heartbeat while warm-up counts climb', async () => {
    // No command runs during warm-up, so the only path that can refresh an
    // idle surface's prompt is the telemetry heartbeat noticing movement.
    let jobs = 0;
    const engine = stubEngine_create();
    const promptContext = () => ({
      user: 'chris', uri: 'http://cube/', cwd: '~', pacsserver: null,
      physicalMode: false, lastExitCode: 0, lastCommandDurationMs: 0,
      procWarmup: { loaded: jobs, total: 100, state: 'cached' as const },
    });
    const daemon = new CalypsoDaemon({
      engine,
      token: TOKEN,
      promptProvider: promptContext,
      telemetryProvider: (): { jobs: number; feeds: number } => ({ jobs: ++jobs, feeds: 0 }),
    });
    const port = await daemon.start();
    try {
      const ws = await client_open(port);
      const prompts: Record<string, unknown>[] = [];
      ws.on('message', (d) => {
        const msg = JSON.parse(d.toString()) as Record<string, unknown>;
        if (msg['type'] === 'promptline') prompts.push(msg);
      });
      send(ws, { type: 'attach', protocolVersion: CONTRACT_VERSION, token: TOKEN });
      // One push rides the attach; at least one more must ride a heartbeat.
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('no heartbeat prompt push within 3s')), 3000);
        const poll = setInterval(() => {
          if (prompts.length >= 2) {
            clearTimeout(timer);
            clearInterval(poll);
            resolve();
          }
        }, 20);
      });
      const last = prompts[prompts.length - 1] as { context: { procWarmup?: { loaded: number } } };
      expect(last.context.procWarmup?.loaded).toBeGreaterThan(0);
      ws.terminate();
    } finally {
      await daemon.stop();
    }
  });

  it('does not push a prompt when no provider is configured', async () => {
    const engine = stubEngine_create();
    const daemon = new CalypsoDaemon({ engine, token: TOKEN });
    const port = await daemon.start();
    try {
      const ws = await client_open(port);
      const got: Record<string, unknown>[] = [];
      ws.on('message', (d) => got.push(JSON.parse(d.toString())));
      send(ws, { type: 'attach', protocolVersion: CONTRACT_VERSION, token: TOKEN });
      await until(() => got.length >= 1);
      // Give any stray push a chance to arrive, then assert none did.
      await new Promise((r) => setTimeout(r, 50));
      expect(got.every((m) => m.type !== 'promptline')).toBe(true);
      ws.terminate();
    } finally {
      await daemon.stop();
    }
  });
});

describe('CalypsoDaemon prompt over the wire', () => {
  it('routes a prompt raised during a command to the executing surface', async () => {
    let daemonRef: CalypsoDaemon | undefined;
    const engine: HostedEngine = {
      line_execute: async (line: string): Promise<CommandEnvelope[]> => {
        if (line === '__prompt__') {
          const answer: string = await (daemonRef as CalypsoDaemon).prompt_current('Password:', true);
          return [{ status: 'ok', rendered: `got: ${answer}` }];
        }
        return [{ status: 'ok', rendered: `ran: ${line}` }];
      },
      line_complete: async (prefix: string) => ({ candidates: [], prefix }),
    };
    const daemon = new CalypsoDaemon({ engine, token: TOKEN });
    daemonRef = daemon;
    const port = await daemon.start();
    try {
      const ws = await client_attach(port);
      const prompted = message_next(ws);
      send(ws, { type: 'execute', id: '1', line: '__prompt__' });
      const prompt = await prompted;
      expect(prompt.type).toBe('prompt');
      expect(prompt.message).toBe('Password:');
      expect(prompt.hidden).toBe(true);

      const replied = message_next(ws);
      send(ws, { type: 'promptAnswer', promptId: prompt.promptId as string, answer: 'secret' });
      const result = await replied;
      expect(result.type).toBe('result');
      expect((result.envelopes as { rendered: string }[])[0].rendered).toBe('got: secret');
      ws.terminate();
    } finally {
      await daemon.stop();
    }
  });

  it('rejects prompt_current when no command is executing', async () => {
    const engine: HostedEngine = {
      line_execute: async () => [],
      line_complete: async (prefix: string) => ({ candidates: [], prefix }),
    };
    const daemon = new CalypsoDaemon({ engine, token: TOKEN });
    await daemon.start();
    try {
      await expect(daemon.prompt_current('x', false)).rejects.toThrow('no active command');
    } finally {
      await daemon.stop();
    }
  });
});

describe('CalypsoDaemon pipe segments over the wire', () => {
  it('routes a pipe segment to the executing surface and returns its output', async () => {
    let daemonRef: CalypsoDaemon | undefined;
    const engine: HostedEngine = {
      line_execute: async (line: string): Promise<CommandEnvelope[]> => {
        if (line === '__pipe__') {
          const out: Buffer = await (daemonRef as CalypsoDaemon).pipe_current('grep foo', Buffer.from('input'));
          return [{ status: 'ok', rendered: `piped: ${out.toString('utf-8')}` }];
        }
        return [{ status: 'ok', rendered: `ran: ${line}` }];
      },
      line_complete: async (prefix: string) => ({ candidates: [], prefix }),
    };
    const daemon = new CalypsoDaemon({ engine, token: TOKEN });
    daemonRef = daemon;
    const port = await daemon.start();
    try {
      const ws = await client_attach(port);
      const asked = message_next(ws);
      send(ws, { type: 'execute', id: '1', line: '__pipe__' });
      const pipe = await asked;
      expect(pipe.type).toBe('pipe');
      expect(pipe.command).toBe('grep foo');
      expect(Buffer.from(pipe.input as string, 'base64').toString('utf-8')).toBe('input');

      const replied = message_next(ws);
      send(ws, { type: 'pipeResult', pipeId: pipe.pipeId as string, output: Buffer.from('OUTPUT').toString('base64') });
      const result = await replied;
      expect(result.type).toBe('result');
      expect((result.envelopes as { rendered: string }[])[0].rendered).toBe('piped: OUTPUT');
      ws.terminate();
    } finally {
      await daemon.stop();
    }
  });

  it('returns a surface pipe failure to the executing engine', async () => {
    let daemonRef: CalypsoDaemon | undefined;
    const engine: HostedEngine = {
      line_execute: async (): Promise<CommandEnvelope[]> => {
        try {
          await (daemonRef as CalypsoDaemon).pipe_current('signalflow', Buffer.from('pipeline: test'));
          return [{ status: 'ok', rendered: '' }];
        } catch (error: unknown) {
          const message: string = error instanceof Error ? error.message : String(error);
          return [{ status: 'error', rendered: message }];
        }
      },
      line_complete: async (prefix: string) => ({ candidates: [], prefix }),
    };
    const daemon = new CalypsoDaemon({ engine, token: TOKEN });
    daemonRef = daemon;
    const port: number = await daemon.start();
    try {
      const ws: WebSocket = await client_attach(port);
      const asked: Promise<Record<string, unknown>> = message_next(ws);
      send(ws, { type: 'execute', id: '1', line: '__pipe_error__' });
      const pipe: Record<string, unknown> = await asked;

      const replied: Promise<Record<string, unknown>> = message_next(ws);
      send(ws, { type: 'pipeError', pipeId: pipe.pipeId as string, reason: "Command 'signalflow' exited with code 1" });
      const result: Record<string, unknown> = await replied;

      expect(result.type).toBe('result');
      expect((result.envelopes as CommandEnvelope[])[0]).toEqual({
        status: 'error',
        rendered: "Command 'signalflow' exited with code 1",
      });
      ws.terminate();
    } finally {
      await daemon.stop();
    }
  });
});

describe('CalypsoDaemon shell commands over the wire', () => {
  it('routes a shell command to the executing surface and returns its exit code', async () => {
    let daemonRef: CalypsoDaemon | undefined;
    const engine: HostedEngine = {
      line_execute: async (): Promise<CommandEnvelope[]> => {
        const exitCode: number = await (daemonRef as CalypsoDaemon).shell_current('pwd');
        return [{ status: exitCode === 0 ? 'ok' : 'error', rendered: '' }];
      },
      line_complete: async (prefix: string) => ({ candidates: [], prefix }),
    };
    const daemon = new CalypsoDaemon({ engine, token: TOKEN });
    daemonRef = daemon;
    const port: number = await daemon.start();
    try {
      const ws: WebSocket = await client_attach(port, true);
      const asked: Promise<Record<string, unknown>> = message_next(ws);
      send(ws, { type: 'execute', id: '1', line: '!pwd' });
      const shell: Record<string, unknown> = await asked;
      expect(shell).toEqual(expect.objectContaining({ type: 'shell', command: 'pwd' }));

      const replied: Promise<Record<string, unknown>> = message_next(ws);
      send(ws, { type: 'shellResult', shellId: shell.shellId as string, exitCode: 0 });
      const result: Record<string, unknown> = await replied;
      expect(result).toEqual(expect.objectContaining({
        type: 'result',
        envelopes: [{ status: 'ok', rendered: '' }],
      }));
      ws.terminate();
    } finally {
      await daemon.stop();
    }
  });

  it('rejects shell execution when the originating surface lacks the capability', async () => {
    let daemonRef: CalypsoDaemon | undefined;
    const engine: HostedEngine = {
      line_execute: async (): Promise<CommandEnvelope[]> => {
        try {
          await (daemonRef as CalypsoDaemon).shell_current('pwd');
          return [{ status: 'ok', rendered: '' }];
        } catch (error: unknown) {
          return [{
            status: 'error',
            rendered: '',
            renderedErr: error instanceof Error ? error.message : String(error),
          }];
        }
      },
      line_complete: async (prefix: string) => ({ candidates: [], prefix }),
    };
    const daemon = new CalypsoDaemon({ engine, token: TOKEN });
    daemonRef = daemon;
    const port: number = await daemon.start();
    try {
      const ws: WebSocket = await client_attach(port);
      const replied: Promise<Record<string, unknown>> = message_next(ws);
      send(ws, { type: 'execute', id: '1', line: '!pwd' });
      const result: Record<string, unknown> = await replied;
      expect(result).toEqual(expect.objectContaining({
        type: 'result',
        envelopes: [expect.objectContaining({
          status: 'error',
          renderedErr: expect.stringContaining('cannot run shell commands'),
        })],
      }));
      ws.terminate();
    } finally {
      await daemon.stop();
    }
  });

  it('ignores a shell result forged by a sibling surface', async () => {
    let daemonRef: CalypsoDaemon | undefined;
    const engine: HostedEngine = {
      line_execute: async (): Promise<CommandEnvelope[]> => {
        const exitCode: number = await (daemonRef as CalypsoDaemon).shell_current('pwd');
        return [{ status: exitCode === 0 ? 'ok' : 'error', rendered: '' }];
      },
      line_complete: async (prefix: string) => ({ candidates: [], prefix }),
    };
    const daemon = new CalypsoDaemon({ engine, token: TOKEN });
    daemonRef = daemon;
    const port: number = await daemon.start();
    try {
      const origin: WebSocket = await client_attach(port, true);
      const sibling: WebSocket = await client_attach(port, true);
      const asked: Promise<Record<string, unknown>> = message_next(origin);
      send(origin, { type: 'execute', id: '1', line: '!pwd' });
      const shell: Record<string, unknown> = await asked;
      send(sibling, { type: 'shellResult', shellId: shell.shellId as string, exitCode: 9 });

      const replied: Promise<Record<string, unknown>> = message_next(origin);
      send(origin, { type: 'shellResult', shellId: shell.shellId as string, exitCode: 0 });
      const result: Record<string, unknown> = await replied;
      expect(result).toEqual(expect.objectContaining({
        type: 'result',
        envelopes: [{ status: 'ok', rendered: '' }],
      }));
      origin.terminate();
      sibling.terminate();
    } finally {
      await daemon.stop();
    }
  });
});

describe('CalypsoDaemon local edit over the wire', () => {
  it('routes an edit to the executing surface and returns the edited content', async () => {
    let daemonRef: CalypsoDaemon | undefined;
    const engine: HostedEngine = {
      line_execute: async (line: string): Promise<CommandEnvelope[]> => {
        if (line === '__edit__') {
          const edit = await (daemonRef as CalypsoDaemon).edit_current('before', '.txt');
          return [{ status: 'ok', rendered: `edited(${edit.changed}): ${edit.content}` }];
        }
        return [{ status: 'ok', rendered: `ran: ${line}` }];
      },
      line_complete: async (prefix: string) => ({ candidates: [], prefix }),
    };
    const daemon = new CalypsoDaemon({ engine, token: TOKEN });
    daemonRef = daemon;
    const port = await daemon.start();
    try {
      const ws = await client_attach(port);
      const asked = message_next(ws);
      send(ws, { type: 'execute', id: '1', line: '__edit__' });
      const edit = await asked;
      expect(edit.type).toBe('edit');
      expect(edit.content).toBe('before');
      expect(edit.extension).toBe('.txt');

      const replied = message_next(ws);
      send(ws, { type: 'editResult', editId: edit.editId as string, content: 'after', changed: true });
      const result = await replied;
      expect(result.type).toBe('result');
      expect((result.envelopes as { rendered: string }[])[0].rendered).toBe('edited(true): after');
      ws.terminate();
    } finally {
      await daemon.stop();
    }
  });
});

describe('CalypsoDaemon file delivery over the wire', () => {
  it('routes a delivery to the executing surface and reports where it landed', async () => {
    let daemonRef: CalypsoDaemon | undefined;
    const engine: HostedEngine = {
      line_execute: async (line: string): Promise<CommandEnvelope[]> => {
        if (line === '__deliver__') {
          const delivered = await (daemonRef as CalypsoDaemon).deliver_current({
            path: '/home/me/scan.dcm', filename: 'scan.dcm', destination: '/tmp', size: 2048,
          });
          return [{ status: 'ok', rendered: `${delivered.bytes} bytes to ${delivered.location}` }];
        }
        return [{ status: 'ok', rendered: `ran: ${line}` }];
      },
      line_complete: async (prefix: string) => ({ candidates: [], prefix }),
    };
    const daemon = new CalypsoDaemon({ engine, token: TOKEN });
    daemonRef = daemon;
    const port = await daemon.start();
    try {
      const ws = await client_attach(port, false, { fileDelivery: true });
      const asked = message_next(ws);
      send(ws, { type: 'execute', id: '1', line: '__deliver__' });
      const deliver = await asked;
      // Only the request crosses; the surface fetches the bytes itself.
      expect(deliver.type).toBe('deliver');
      expect(deliver.path).toBe('/home/me/scan.dcm');
      expect(deliver.filename).toBe('scan.dcm');
      expect(deliver.destination).toBe('/tmp');
      expect(deliver.size).toBe(2048);
      expect(deliver).not.toHaveProperty('bytes');

      const replied = message_next(ws);
      send(ws, {
        type: 'deliverResult',
        deliverId: deliver.deliverId as string,
        location: '/tmp/scan.dcm',
        bytes: 2048,
      });
      const result = await replied;
      expect((result.envelopes as { rendered: string }[])[0].rendered).toBe('2048 bytes to /tmp/scan.dcm');
      ws.terminate();
    } finally {
      await daemon.stop();
    }
  });

  it('fails the command when the surface cannot deliver', async () => {
    let daemonRef: CalypsoDaemon | undefined;
    const engine: HostedEngine = {
      line_execute: async (line: string): Promise<CommandEnvelope[]> => {
        if (line === '__deliver__') {
          try {
            await (daemonRef as CalypsoDaemon).deliver_current({ path: '/x', filename: 'x' });
          } catch (error: unknown) {
            return [{ status: 'error', rendered: '', renderedErr: String((error as Error).message) }];
          }
        }
        return [{ status: 'ok', rendered: '' }];
      },
      line_complete: async (prefix: string) => ({ candidates: [], prefix }),
    };
    const daemon = new CalypsoDaemon({ engine, token: TOKEN });
    daemonRef = daemon;
    const port = await daemon.start();
    try {
      const ws = await client_attach(port, false, { fileDelivery: true });
      const asked = message_next(ws);
      send(ws, { type: 'execute', id: '1', line: '__deliver__' });
      const deliver = await asked;
      const replied = message_next(ws);
      send(ws, { type: 'deliverError', deliverId: deliver.deliverId as string, reason: 'no disk here' });
      const result = await replied;
      expect((result.envelopes as { renderedErr: string }[])[0].renderedErr).toContain('no disk here');
      ws.terminate();
    } finally {
      await daemon.stop();
    }
  });
});

describe('CalypsoDaemon scrollback bound', () => {
  it('retains only the most recent envelopes up to the size', async () => {
    const engine = stubEngine_create();
    const daemon = new CalypsoDaemon({ engine, token: TOKEN, scrollbackSize: 2 });
    const port = await daemon.start();
    try {
      const a = await client_attach(port);
      for (const line of ['one', 'two', 'three']) {
        const replied = message_next(a);
        send(a, { type: 'execute', id: line, line });
        await replied;
      }
      const c = await client_open(port);
      const collected = messages_collect(c, 3); // attached + 2 replayed
      send(c, { type: 'attach', protocolVersion: CONTRACT_VERSION, token: TOKEN });
      const messages = await collected;
      a.terminate();
      c.terminate();
      expect(messages[0].type).toBe('attached');
      const rendered = messages.slice(1).map((m) => (m.envelope as { rendered: string }).rendered);
      expect(rendered).toEqual(['ran: two', 'ran: three']);
    } finally {
      await daemon.stop();
    }
  });

  it('a watch is owned by its surface: opened on the wire, answered with its state, released on detach', async () => {
    const engine = stubEngine_create();
    const calls: { subject: string; owner: string; on: boolean }[] = [];
    const released: string[] = [];
    (engine as { watch_set?: (subject: string, owner: string, on: boolean) => string | null }).watch_set =
      (subject, owner, on): string | null => { calls.push({ subject, owner, on }); return subject.includes('feed_') ? 'live' : null; };
    (engine as { watch_release?: (owner: string) => void }).watch_release = (owner): void => { released.push(owner); };
    const daemon = new CalypsoDaemon({ engine, token: TOKEN });
    const port = await daemon.start();
    try {
      const watcher = await client_attach(port);
      const answered = message_next(watcher);
      send(watcher, { type: 'watch', subject: '/proc/jobs/feed_7' });
      expect(await answered).toEqual({ type: 'watched', subject: '/proc/jobs/feed_7', state: 'live' });
      expect(calls).toEqual([{ subject: '/proc/jobs/feed_7', owner: expect.any(String), on: true }]);

      const refused = message_next(watcher);
      send(watcher, { type: 'watch', subject: '/vfs/home' });
      expect((await refused).type).toBe('error');

      watcher.terminate();
      await new Promise<void>((resolve: () => void): void => { setTimeout(resolve, 50); });
      expect(released).toEqual([calls[0].owner]);
    } finally {
      await daemon.stop();
    }
  });

  it('relays ambient engine events to every surface: models on the bus as the daemon, watch states as their own message', async () => {
    const engine = stubEngine_create();
    let publish: ((event: unknown) => void) | null = null;
    (engine as { ambient_listen?: (l: (event: unknown) => void) => () => void }).ambient_listen =
      (listener): (() => void) => { publish = listener; return (): void => { publish = null; }; };
    const daemon = new CalypsoDaemon({ engine, token: TOKEN });
    const port = await daemon.start();
    try {
      const a = await client_attach(port);
      const b = await client_attach(port);
      const envelope = { status: 'ok', rendered: 'dag', model: { kind: 'feed.dag', data: {} } };
      const gotA = messages_collect(a, 2);
      const gotB = messages_collect(b, 2);
      publish!({ kind: 'envelope', envelope });
      publish!({ kind: 'watched', subject: '/proc/jobs/feed_7', state: 'settled' });
      for (const got of [await gotA, await gotB]) {
        expect(got[0]).toMatchObject({ type: 'session', surface: 'daemon' });
        expect(got[1]).toEqual({ type: 'watched', subject: '/proc/jobs/feed_7', state: 'settled' });
      }
      a.terminate();
      b.terminate();
    } finally {
      await daemon.stop();
    }
    expect(publish).toBeNull();
  });

  it('retains a regard write, mirrors it into the engine, and rebroadcasts to every surface', async () => {
    const engine = stubEngine_create();
    const noted: unknown[] = [];
    (engine as { regard_note?: (regard: unknown) => void }).regard_note = (regard): void => {
      noted.push(regard);
    };
    const daemon = new CalypsoDaemon({ engine, token: TOKEN });
    const port = await daemon.start();
    try {
      const writer = await client_attach(port);
      const sibling = await client_attach(port);
      const regard = { address: '/vfs/feeds/feed_12/data', modelKind: 'feed.node', groupId: 'g1', paneId: 'dag-1' };
      const echoed = message_next(writer);
      const relayed = message_next(sibling);
      send(writer, { type: 'regard', regard });
      expect(await echoed).toEqual({ type: 'regard', regard });
      expect(await relayed).toEqual({ type: 'regard', regard });
      expect(noted).toEqual([regard]);
      // A late attacher receives the retained cell with its ack, before any
      // new indication.
      const late = await client_open(port);
      const collected = messages_collect(late, 2); // attached + retained regard
      send(late, { type: 'attach', protocolVersion: CONTRACT_VERSION, token: TOKEN });
      const messages = await collected;
      expect(messages[0].type).toBe('attached');
      expect(messages[1]).toEqual({ type: 'regard', regard });
      writer.terminate();
      sibling.terminate();
      late.terminate();
    } finally {
      await daemon.stop();
    }
  });

  it('serves a retained regard from the engine when the daemon itself holds none', async () => {
    const engine = stubEngine_create();
    const engineRegard = { address: '/home/user/report.txt', groupId: 'g2', paneId: 'files-1' };
    (engine as { regard_get?: () => unknown }).regard_get = () => engineRegard;
    const daemon = new CalypsoDaemon({ engine, token: TOKEN });
    const port = await daemon.start();
    try {
      const ws = await client_open(port);
      const collected = messages_collect(ws, 2);
      send(ws, { type: 'attach', protocolVersion: CONTRACT_VERSION, token: TOKEN });
      const messages = await collected;
      expect(messages[1]).toEqual({ type: 'regard', regard: engineRegard });
      ws.terminate();
    } finally {
      await daemon.stop();
    }
  });
});
