/**
 * @file STOP and Ctrl-C end any command; one that does not end when asked
 * is abandoned after the grace, and the session runs the next.
 */
import { WebSocket } from 'ws';
import { CalypsoDaemon } from '../src/daemon/server';
import type { HostedEngine } from '../src/daemon/engine';
import { CONTRACT_VERSION } from '@fnndsc/menu';
import type { CommandEnvelope } from '@fnndsc/cumin';

const TOKEN = 'test-attach-token';

/** A connected client: its socket, what it received, and a wait for one message. */
interface Client {
  ws: WebSocket;
  got: Record<string, unknown>[];
  next: (test: (m: Record<string, unknown>) => boolean) => Promise<Record<string, unknown>>;
}

/** Attaches a client with the given capabilities. */
async function client_attach(port: number, capabilities: Record<string, unknown>): Promise<Client> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  const got: Record<string, unknown>[] = [];
  const waits: Array<{ test: (m: Record<string, unknown>) => boolean; resolve: (m: Record<string, unknown>) => void }> = [];
  ws.on('message', (d) => {
    const m = JSON.parse(d.toString()) as Record<string, unknown>;
    got.push(m);
    for (const w of [...waits]) if (w.test(m)) { waits.splice(waits.indexOf(w), 1); w.resolve(m); }
  });
  const next = (test: (m: Record<string, unknown>) => boolean): Promise<Record<string, unknown>> => {
    const seen = got.find(test);
    if (seen !== undefined) return Promise.resolve(seen);
    return new Promise((resolve) => waits.push({ test, resolve }));
  };
  await new Promise<void>((resolve, reject) => { ws.once('open', () => resolve()); ws.once('error', reject); });
  ws.send(JSON.stringify({ type: 'attach', protocolVersion: CONTRACT_VERSION, token: TOKEN, capabilities: { shellCommands: false, hiddenInput: true, ...capabilities } }));
  await next((m) => m.type === 'attached');
  return { ws, got, next };
}

describe('STOP: a command that does not end is abandoned and the session is free', () => {
  let daemon: CalypsoDaemon;
  let ran: string[];
  let aborted: number;
  const sockets: WebSocket[] = [];

  beforeEach(async () => {
    ran = [];
    aborted = 0;
    const engine: HostedEngine = {
      // `hang` never ends and does not check its signal, as an ls stuck on CUBE.
      line_execute: (line: string): Promise<CommandEnvelope[]> => {
        ran.push(line);
        if (line === 'hang') return new Promise(() => undefined);
        if (line === 'housekeeping') return new Promise((r) => setTimeout(() => r([{ status: 'ok', rendered: 'kept' }]), 400));
        return Promise.resolve([{ status: 'ok', rendered: `engine: ${line}` }]);
      },
      line_complete: async (prefix: string) => ({ candidates: [], prefix }),
      line_abort: (): boolean => { aborted++; return true; },
    };
    daemon = new CalypsoDaemon({ engine, token: TOKEN });
    await daemon.start();
  });

  afterEach(async () => {
    for (const ws of sockets.splice(0)) ws.terminate();
    await daemon.stop().catch((): void => undefined);
  });

  const port = (): number => (daemon as unknown as { httpServer: { address: () => { port: number } } }).httpServer.address().port;

  it('STOP aborts the command, abandons it after the grace, and the next command runs', async () => {
    const a = await client_attach(port(), {}); sockets.push(a.ws);
    a.ws.send(JSON.stringify({ type: 'execute', id: '1', line: 'hang' }));
    a.ws.send(JSON.stringify({ type: 'execute', id: '2', line: 'pwd' }));   // queued behind it
    await new Promise((r) => setTimeout(r, 100));
    expect(ran).toEqual(['hang']);
    a.ws.send(JSON.stringify({ type: 'stop' }));
    const stopped = await a.next((m) => m.type === 'result' && m.id === '1');
    expect(aborted).toBe(1);
    expect(JSON.stringify(stopped)).toContain('did not end when asked and was abandoned');
    const after = await a.next((m) => m.type === 'result' && m.id === '2');
    expect(JSON.stringify(after)).toContain('engine: pwd');
  }, 10000);

  it('Ctrl-C (cancel) stops the same way', async () => {
    const a = await client_attach(port(), {}); sockets.push(a.ws);
    a.ws.send(JSON.stringify({ type: 'execute', id: '7', line: 'hang' }));
    await new Promise((r) => setTimeout(r, 100));
    a.ws.send(JSON.stringify({ type: 'cancel', id: '7' }));
    const stopped = await a.next((m) => m.type === 'result' && m.id === '7');
    expect(JSON.stringify(stopped)).toContain('abandoned');
  }, 10000);

  it('a chell that goes away hangs up on its command, and the session is free', async () => {
    const shell = await client_attach(port(), { localFilesystem: true }); sockets.push(shell.ws);
    const other = await client_attach(port(), {}); sockets.push(other.ws);
    shell.ws.send(JSON.stringify({ type: 'execute', id: '9', line: 'hang' }));
    await new Promise((r) => setTimeout(r, 100));
    shell.ws.terminate();
    other.ws.send(JSON.stringify({ type: 'execute', id: '10', line: 'pwd' }));
    const after = await other.next((m) => m.type === 'result' && m.id === '10');
    expect(aborted).toBe(1);
    expect(JSON.stringify(after)).toContain('engine: pwd');
  }, 10000);

  it('STOP leaves silent housekeeping alone and ends the operator\'s waiting command unrun', async () => {
    const a = await client_attach(port(), {}); sockets.push(a.ws);
    a.ws.send(JSON.stringify({ type: 'execute', id: 'h', line: 'housekeeping', instrument: true }));
    a.ws.send(JSON.stringify({ type: 'execute', id: 's', line: 'sleep 30' }));
    await new Promise((r) => setTimeout(r, 100));
    a.ws.send(JSON.stringify({ type: 'stop' }));
    const kept = await a.next((m) => m.type === 'result' && m.id === 'h');
    expect(JSON.stringify(kept)).toContain('kept');
    const stopped = await a.next((m) => m.type === 'result' && m.id === 's');
    expect(JSON.stringify(stopped)).toContain('was stopped before it ran');
    expect(ran).not.toContain('sleep 30');
    expect(aborted).toBe(0);
  }, 10000);

  it('a surface that owns nothing running is refused by name', async () => {
    const a = await client_attach(port(), {}); sockets.push(a.ws);
    const b = await client_attach(port(), {}); sockets.push(b.ws);
    a.ws.send(JSON.stringify({ type: 'execute', id: '3', line: 'hang' }));
    await new Promise((r) => setTimeout(r, 100));
    b.ws.send(JSON.stringify({ type: 'stop' }));
    const refused = await b.next((m) => m.type === 'error');
    expect(refused.reason).toBe('stop: nothing of yours is running');
    expect(aborted).toBe(0);
  });
});

describe('a line whose surface left, and a command waiting aside', () => {
  let daemon: CalypsoDaemon;
  let ran: string[];
  let aborted: number;
  let asideAborted: unknown[];
  let release: (() => void) | null;
  const sockets: WebSocket[] = [];

  beforeEach(async () => {
    ran = [];
    aborted = 0;
    asideAborted = [];
    release = null;
    const engine: HostedEngine = {
      line_execute: async (line: string): Promise<CommandEnvelope[]> => {
        ran.push(line);
        if (line === 'hang') return new Promise(() => undefined);
        // `follow` waits aside on a task until released or stopped, as `domain build` does.
        if (line === 'follow') {
          const outcome: string = await daemon.aside_current(new Promise<string>((resolve) => { release = (): void => resolve('ended'); }));
          return [{ status: 'ok', rendered: `follow: ${outcome}` }];
        }
        return [{ status: 'ok', rendered: `engine: ${line}` }];
      },
      line_complete: async (prefix: string) => ({ candidates: [], prefix }),
      line_abort: (): boolean => { aborted++; return true; },
      turn_leave: (): unknown => ({ turn: 'follow' }),
      turn_resume: (): void => undefined,
      turn_abort: (state: unknown): void => { asideAborted.push(state); release?.(); },
    };
    daemon = new CalypsoDaemon({ engine, token: TOKEN });
    await daemon.start();
  });

  afterEach(async () => {
    for (const ws of sockets.splice(0)) ws.terminate();
    await daemon.stop().catch((): void => undefined);
  });

  const port = (): number => (daemon as unknown as { httpServer: { address: () => { port: number } } }).httpServer.address().port;

  it('a browser\'s line runs on when it leaves, and any surface may stop it then', async () => {
    const browser = await client_attach(port(), {}); sockets.push(browser.ws);
    const other = await client_attach(port(), {}); sockets.push(other.ws);
    browser.ws.send(JSON.stringify({ type: 'execute', id: 'b1', line: 'hang' }));
    await new Promise((r) => setTimeout(r, 100));
    browser.ws.terminate();
    await new Promise((r) => setTimeout(r, 100));
    expect(aborted).toBe(0);
    other.ws.send(JSON.stringify({ type: 'stop' }));
    await new Promise((r) => setTimeout(r, 100));
    expect(aborted).toBe(1);
  }, 10000);

  it('lets other lines run while a command waits aside, and its surface\'s STOP still reaches it', async () => {
    const a = await client_attach(port(), {}); sockets.push(a.ws);
    const b = await client_attach(port(), {}); sockets.push(b.ws);
    a.ws.send(JSON.stringify({ type: 'execute', id: 'f', line: 'follow' }));
    await new Promise((r) => setTimeout(r, 100));
    b.ws.send(JSON.stringify({ type: 'execute', id: 'p', line: 'pwd', instrument: true }));
    const read = await b.next((m) => m.type === 'result' && m.id === 'p');
    expect(JSON.stringify(read)).toContain('engine: pwd');
    // Another surface's STOP does not reach it while its own is attached.
    b.ws.send(JSON.stringify({ type: 'stop' }));
    expect((await b.next((m) => m.type === 'error')).reason).toBe('stop: nothing of yours is running');
    a.ws.send(JSON.stringify({ type: 'stop' }));
    const ended = await a.next((m) => m.type === 'result' && m.id === 'f');
    expect(asideAborted).toEqual([{ turn: 'follow' }]);
    expect(JSON.stringify(ended)).toContain('follow: ended');
  }, 10000);
});
