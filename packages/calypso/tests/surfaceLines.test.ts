/**
 * @file Lines in a surface's own language: a browser declares the subjects it
 * claims; a chell's line in one is run by that browser, never by the engine,
 * and its answer printed by the chell. A terminal's own browser answers first;
 * with none attached, a claimed subject is refused by name. A browser's note
 * reaches only its own consoles; completion offers the claimed words.
 *
 * @module
 */
import { WebSocket } from 'ws';
import { CalypsoDaemon } from '../src/daemon/server';
import type { HostedEngine } from '../src/daemon/engine';
import { Terminals, type PtyProcess, type PtySpawn } from '../src/daemon/terminals';
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

/** A browser that answers its own lines with a fixed reply naming itself. */
function browser_answer(client: Client, name: string): void {
  client.ws.on('message', (d) => {
    const m = JSON.parse(d.toString()) as Record<string, unknown>;
    if (m.type === 'surfaceLine') client.ws.send(JSON.stringify({ type: 'surfaceLineResult', lineId: m.lineId, rendered: `${name} ran: ${m.line as string}`, status: 'ok' }));
  });
}

/** A spawn of ptys that do nothing. */
const spawn: PtySpawn = (): PtyProcess => ({ onData: () => undefined, onExit: () => undefined, write: () => undefined, resize: () => undefined, kill: () => undefined });

describe('lines in a surface\'s own language', () => {
  let daemon: CalypsoDaemon;
  let ran: string[];
  const sockets: WebSocket[] = [];

  beforeEach(async () => {
    ran = [];
    const engine: HostedEngine = {
      line_execute: async (line: string): Promise<CommandEnvelope[]> => { ran.push(line); return [{ status: 'ok', rendered: `engine: ${line}` }]; },
      line_complete: async (prefix: string) => ({ candidates: prefix.startsWith('d') ? ['date', 'du'] : [], prefix }),
    };
    daemon = new CalypsoDaemon({ engine, token: TOKEN });
    await daemon.start();
  });

  afterEach(async () => {
    for (const ws of sockets.splice(0)) ws.terminate();
    await daemon.stop().catch((): void => undefined);
  });

  const port = (): number => (daemon as unknown as { httpServer: { address: () => { port: number } } }).httpServer.address().port;

  it('a chell\'s line in a claimed subject is run by the browser and printed by the chell; the engine never sees it', async () => {
    const browser = await client_attach(port(), { claims: [{ subject: 'dag' }, { subject: 'file', verbs: ['open'] }] });
    browser_answer(browser, 'argus');
    const chell = await client_attach(port(), { shellCommands: true });
    sockets.push(browser.ws, chell.ws);
    chell.ws.send(JSON.stringify({ type: 'execute', id: '1', line: 'dag %1 census on' }));
    const result = await chell.next((m) => m.type === 'result' && m.id === '1');
    expect(result.envelopes).toEqual([{ status: 'ok', rendered: 'argus ran: dag %1 census on\n' }]);
    // A shared subject's other verbs stay the session's.
    chell.ws.send(JSON.stringify({ type: 'execute', id: '2', line: 'file input.txt' }));
    await chell.next((m) => m.type === 'result' && m.id === '2');
    expect(ran).toEqual(['file input.txt']);
  });

  it('a terminal\'s own browser answers before the one most recently active', async () => {
    const owner = await client_attach(port(), { claims: [{ subject: 'dag' }] });
    const other = await client_attach(port(), { claims: [{ subject: 'dag' }] });
    browser_answer(owner, 'owner');
    browser_answer(other, 'other');
    sockets.push(owner.ws, other.ws);
    daemon.terminals_set(new Terminals({ spawn, launch: { exec: 'chell', prefixArgs: [] }, target: { identity: 'i', url: 'ws://x', token: 't' } }));
    owner.ws.send(JSON.stringify({ type: 'terminalOpen', cols: 80, rows: 24 }));
    const terminalId = (await owner.next((m) => m.type === 'terminalOpened')).terminalId as string;
    // The other browser was the last to do something.
    other.ws.send(JSON.stringify({ type: 'execute', id: 'x', line: 'pwd' }));
    await other.next((m) => m.type === 'result' && m.id === 'x');
    const chell = await client_attach(port(), { shellCommands: true, terminal: terminalId });
    sockets.push(chell.ws);
    chell.ws.send(JSON.stringify({ type: 'execute', id: '1', line: 'dag census on' }));
    expect(((await chell.next((m) => m.type === 'result' && m.id === '1')).envelopes as Array<{ rendered: string }>)[0]?.rendered).toBe('owner ran: dag census on\n');
    // A plain shell's line goes to the browser most recently active.
    const shell = await client_attach(port(), { shellCommands: true });
    sockets.push(shell.ws);
    shell.ws.send(JSON.stringify({ type: 'execute', id: '2', line: 'dag census off' }));
    expect(((await shell.next((m) => m.type === 'result' && m.id === '2')).envelopes as Array<{ rendered: string }>)[0]?.rendered).toBe('other ran: dag census off\n');
  });

  it('with no browser attached, a subject claimed whole is refused by name, and a shared one is the session\'s', async () => {
    const browser = await client_attach(port(), { claims: [{ subject: 'dag' }, { subject: 'file', verbs: ['open'] }] });
    browser.ws.close();
    await new Promise((r) => setTimeout(r, 100));
    const chell = await client_attach(port(), { shellCommands: true });
    sockets.push(chell.ws);
    chell.ws.send(JSON.stringify({ type: 'execute', id: '1', line: 'dag census on' }));
    const refused = await chell.next((m) => m.type === 'result' && m.id === '1');
    expect(refused.envelopes).toEqual([{ status: 'error', rendered: '', renderedErr: 'dag: an ARGUS word; no ARGUS is attached to this session\n' }]);
    chell.ws.send(JSON.stringify({ type: 'execute', id: '2', line: 'file open x' }));
    await chell.next((m) => m.type === 'result' && m.id === '2');
    expect(ran).toEqual(['file open x']);
  });

  it('a browser that cannot run the line says why, and claims can change after attach', async () => {
    const browser = await client_attach(port(), {});
    browser.ws.on('message', (d) => {
      const m = JSON.parse(d.toString()) as Record<string, unknown>;
      if (m.type === 'surfaceLine') browser.ws.send(JSON.stringify({ type: 'surfaceLineError', lineId: m.lineId, reason: 'not a line of this surface' }));
    });
    browser.ws.send(JSON.stringify({ type: 'surfaceClaims', claims: [{ subject: 'universe' }] }));
    const chell = await client_attach(port(), { shellCommands: true });
    sockets.push(browser.ws, chell.ws);
    await new Promise((r) => setTimeout(r, 50));
    chell.ws.send(JSON.stringify({ type: 'execute', id: '1', line: 'universe spokes' }));
    const failed = await chell.next((m) => m.type === 'result' && m.id === '1');
    expect(failed.envelopes).toEqual([{ status: 'error', rendered: '', renderedErr: 'universe: not a line of this surface\n' }]);
  });

  it('a browser\'s note reaches the chell of its own terminal only, and completion offers the claimed words', async () => {
    const browser = await client_attach(port(), { claims: [{ subject: 'desktop' }] });
    sockets.push(browser.ws);
    daemon.terminals_set(new Terminals({ spawn, launch: { exec: 'chell', prefixArgs: [] }, target: { identity: 'i', url: 'ws://x', token: 't' } }));
    browser.ws.send(JSON.stringify({ type: 'terminalOpen', cols: 80, rows: 24 }));
    const terminalId = (await browser.next((m) => m.type === 'terminalOpened')).terminalId as string;
    const mine = await client_attach(port(), { shellCommands: true, terminal: terminalId });
    const stranger = await client_attach(port(), { shellCommands: true });
    sockets.push(mine.ws, stranger.ws);
    browser.ws.send(JSON.stringify({ type: 'note', text: 'view link: ran 4 lines' }));
    expect(await mine.next((m) => m.type === 'consoleNote')).toEqual({ type: 'consoleNote', text: 'view link: ran 4 lines' });
    await new Promise((r) => setTimeout(r, 50));
    expect(stranger.got.some((m) => m.type === 'consoleNote')).toBe(false);
    mine.ws.send(JSON.stringify({ type: 'complete', id: 'c', prefix: 'd' }));
    const completed = await mine.next((m) => m.type === 'complete' && m.id === 'c');
    expect(completed.candidates).toEqual(['date', 'du', 'desktop']);
  });
});
