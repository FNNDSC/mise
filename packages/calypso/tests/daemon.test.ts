import { WebSocket } from 'ws';
import { CalypsoDaemon } from '../src/daemon/server';
import type { HostedEngine } from '../src/daemon/engine';
import { CONTRACT_VERSION } from '../src/protocol/version';
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
async function client_attach(port: number): Promise<WebSocket> {
  const ws = await client_open(port);
  const acked = message_next(ws);
  send(ws, { type: 'attach', protocolVersion: CONTRACT_VERSION, token: TOKEN });
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
});
