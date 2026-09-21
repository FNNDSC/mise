/**
 * @file The porter's routes over a fake host: a session asked for, its boot
 * followed, its mount addressed. The proxy itself needs a daemon and is
 * proved live.
 */
import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { WebSocketServer, WebSocket, type RawData } from 'ws';
import type { AddressInfo } from 'node:net';
import { porterApp_build, upstreamPath_build, mountUrl_split, berthHttp_of, type PorterApp } from '../../src/app.js';
import type { Berth, BootListener, BootReport, SessionHost } from '../../src/host/sessionHost.js';
import type { PorterConfig } from '../../src/config.js';

const config: PorterConfig = {
  cubeUrl: 'https://cube.example.org/api/v1/',
  stateDir: '/tmp/porter-test',
  host: '127.0.0.1',
  port: 0,
  chellEntry: '/opt/chell/dist/index.js',
  secret: 'a-secret-of-at-least-twenty-characters',
  secretGenerated: false,
  cookieHours: 24,
};

/** The door's cookie as a browser would send it back, from a login reply. */
function cookie_of(response: { headers: Record<string, unknown> }): string {
  const header: unknown = response.headers['set-cookie'];
  const first: string = Array.isArray(header) ? String(header[0]) : String(header);
  return first.split(';')[0] ?? '';
}

/** A host that remembers what it was asked and answers from a script. */
class FakeHost implements SessionHost {
  public found: Berth | null = null;
  public spawned: Array<{ identity: string; user: string; token: string }> = [];
  public spawnError: string | null = null;
  public report: BootReport | null = null;
  public listener: BootListener | null = null;
  async find(): Promise<Berth | null> { return this.found; }
  async spawn(identity: string, user: string, _cubeUrl: string, token: string): Promise<Berth> {
    this.spawned.push({ identity, user, token });
    if (this.spawnError !== null) throw new Error(this.spawnError);
    return { identity, url: 'ws://127.0.0.1:4444', token: 'ATTACH' };
  }
  boot_follow(_identity: string, listener: BootListener): { report: BootReport; release: () => void } | null {
    if (this.report === null) return null;
    this.listener = listener;
    return { report: this.report, release: (): void => { this.listener = null; } };
  }
  async evict(): Promise<boolean> { return true; }
}

let host: FakeHost;
let built: PorterApp;

beforeEach(async () => {
  host = new FakeHost();
  built = await porterApp_build({
    config,
    host,
    mint: async (_cube: string, username: string, password: string) =>
      password === 'right' ? { token: `TOKEN-${username}` } : { token: null, reason: 'CUBE refused the login' },
  });
});

describe('POST /login', () => {
  it('trades the password for a token and starts the session with it', async () => {
    const response = await built.app.inject({ method: 'POST', url: '/login', headers: { accept: 'application/json' }, payload: { username: 'chris', password: 'right' } });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { key: string; mount: string; state: string };
    expect(body.state).toBe('started');
    expect(body.mount).toBe(`/s/${body.key}/`);
    expect(body.key).toMatch(/^[0-9a-f]{16}$/);
    expect(host.spawned).toEqual([{ identity: 'chris@https://cube.example.org/api/v1/', user: 'chris', token: 'TOKEN-chris' }]);
    const cookie: string = cookie_of(response);
    expect(cookie.startsWith('porter_session=')).toBe(true);
    const raw: string = String(Array.isArray(response.headers['set-cookie']) ? response.headers['set-cookie'][0] : response.headers['set-cookie']);
    expect(raw).toContain('HttpOnly');
    expect(raw).toContain('SameSite=Lax');
    expect(raw).toContain('Max-Age=86400');
    expect(raw).not.toContain('Secure');
  });

  it('marks the cookie Secure when a front says the page came over TLS', async () => {
    const response = await built.app.inject({ method: 'POST', url: '/login', headers: { accept: 'application/json', 'x-forwarded-proto': 'https' }, payload: { username: 'chris', password: 'right' } });
    const raw: string = String(Array.isArray(response.headers['set-cookie']) ? response.headers['set-cookie'][0] : response.headers['set-cookie']);
    expect(raw).toContain('Secure');
  });

  it('takes a form from the door and sends the browser to the session', async () => {
    const response = await built.app.inject({ method: 'POST', url: '/login', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'text/html' }, payload: 'username=chris&password=right' });
    expect(response.statusCode).toBe(303);
    expect(response.headers.location).toMatch(/^\/s\/[0-9a-f]{16}\/\?door$/);
    expect(cookie_of(response).startsWith('porter_session=')).toBe(true);
  });

  it('sends a refused form back to the door with the reason', async () => {
    const response = await built.app.inject({ method: 'POST', url: '/login', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'text/html' }, payload: 'username=chris&password=wrong' });
    expect(response.statusCode).toBe(303);
    expect(response.headers.location).toBe('/login?reason=CUBE%20refused%20the%20login');
  });

  it('attaches to a session already up, after checking the password all the same', async () => {
    host.found = { identity: 'chris@https://cube.example.org/api/v1/', url: 'ws://127.0.0.1:4444', token: 'ATTACH' };
    const ok = await built.app.inject({ method: 'POST', url: '/login', headers: { accept: 'application/json' }, payload: { username: 'chris', password: 'right' } });
    expect((ok.json() as { state: string }).state).toBe('attached');
    expect(host.spawned).toEqual([]);
    const refused = await built.app.inject({ method: 'POST', url: '/login', headers: { accept: 'application/json' }, payload: { username: 'chris', password: 'wrong' } });
    expect(refused.statusCode).toBe(401);
  });

  it('refuses a bad password with CUBE\'s word, and a bad body by name', async () => {
    const refused = await built.app.inject({ method: 'POST', url: '/login', headers: { accept: 'application/json' }, payload: { username: 'chris', password: 'wrong' } });
    expect(refused.statusCode).toBe(401);
    expect((refused.json() as { error: string }).error).toBe('CUBE refused the login');
    const bad = await built.app.inject({ method: 'POST', url: '/login', headers: { accept: 'application/json' }, payload: { username: 'chris' } });
    expect(bad.statusCode).toBe(400);
  });

  it('says when the session did not start', async () => {
    host.spawnError = 'the session exited during boot (code 1)';
    const response = await built.app.inject({ method: 'POST', url: '/login', headers: { accept: 'application/json' }, payload: { username: 'chris', password: 'right' } });
    expect(response.statusCode).toBe(502);
    expect((response.json() as { error: string }).error).toContain('exited during boot');
  });
});

describe('GET /boot/:key', () => {
  it('replays the boot so far and closes on a settled state', async () => {
    host.report = { lines: [{ channel: 'out', text: '[ OK ] Connect' }], state: 'ready' };
    const session = await built.app.inject({ method: 'POST', url: '/login', headers: { accept: 'application/json' }, payload: { username: 'chris', password: 'right' } });
    const key: string = (session.json() as { key: string }).key;
    const boot = await built.app.inject({ method: 'GET', url: `/boot/${key}`, headers: { cookie: cookie_of(session) } });
    expect(boot.statusCode).toBe(200);
    expect(boot.headers['content-type']).toBe('text/event-stream');
    expect(boot.body).toContain('event: line\ndata: {"channel":"out","text":"[ OK ] Connect"}');
    expect(boot.body).toContain('event: ready');
  });

  it('follows a boot still under way: lines as they come, then the end', async () => {
    host.report = { lines: [{ channel: 'out', text: 'first' }], state: 'booting' };
    const session = await built.app.inject({ method: 'POST', url: '/login', headers: { accept: 'application/json' }, payload: { username: 'chris', password: 'right' } });
    const key: string = (session.json() as { key: string }).key;
    const boot: Promise<{ body: string }> = built.app.inject({ method: 'GET', url: `/boot/${key}`, headers: { cookie: cookie_of(session) } });
    await new Promise((r) => setTimeout(r, 50));
    expect(host.listener).not.toBeNull();
    host.listener?.line({ channel: 'err', text: 'second' });
    host.listener?.done('failed', 'it died');
    const body: string = (await boot).body;
    expect(body).toContain('data: {"channel":"out","text":"first"}');
    expect(body).toContain('data: {"channel":"err","text":"second"}');
    expect(body).toContain('event: failed\ndata: {"reason":"it died"}');
  });

  it('answers ready at once for a session it found rather than started', async () => {
    host.found = { identity: 'chris@https://cube.example.org/api/v1/', url: 'ws://127.0.0.1:4444', token: 'ATTACH' };
    const session = await built.app.inject({ method: 'POST', url: '/login', headers: { accept: 'application/json' }, payload: { username: 'chris', password: 'right' } });
    const key: string = (session.json() as { key: string }).key;
    const boot = await built.app.inject({ method: 'GET', url: `/boot/${key}`, headers: { cookie: cookie_of(session) } });
    expect(boot.body).toContain('event: ready');
  });

  it('401s a browser whose cookie names another session, or none', async () => {
    const session = await built.app.inject({ method: 'POST', url: '/login', headers: { accept: 'application/json' }, payload: { username: 'chris', password: 'right' } });
    const key: string = (session.json() as { key: string }).key;
    expect((await built.app.inject({ method: 'GET', url: `/boot/${key}` })).statusCode).toBe(401);
    expect((await built.app.inject({ method: 'GET', url: '/boot/0123456789abcdef', headers: { cookie: cookie_of(session) } })).statusCode).toBe(401);
    expect((await built.app.inject({ method: 'GET', url: `/boot/${key}`, headers: { cookie: 'porter_session=forged.signature' } })).statusCode).toBe(401);
  });
});

describe('the door', () => {
  it('shows the login page, with the reason when there is one', async () => {
    const page = await built.app.inject({ method: 'GET', url: '/login' });
    expect(page.statusCode).toBe(200);
    expect(page.headers['content-type']).toContain('text/html');
    expect(page.body).toContain('name="password"');
    expect(page.body).toContain('https://cube.example.org/api/v1/');
    const refused = await built.app.inject({ method: 'GET', url: '/login?reason=CUBE%20refused%20the%20login' });
    expect(refused.body).toContain('CUBE refused the login');
  });

  it('sends the root to the session when let in, else to the login', async () => {
    expect((await built.app.inject({ method: 'GET', url: '/' })).headers.location).toBe('/login');
    const session = await built.app.inject({ method: 'POST', url: '/login', headers: { accept: 'application/json' }, payload: { username: 'chris', password: 'right' } });
    const key: string = (session.json() as { key: string }).key;
    expect((await built.app.inject({ method: 'GET', url: '/', headers: { cookie: cookie_of(session) } })).headers.location).toBe(`/s/${key}/?door`);
  });

  it('logs a browser out by clearing its cookie, and leaves the session alone', async () => {
    const out = await built.app.inject({ method: 'POST', url: '/logout', headers: { accept: 'application/json' } });
    expect(out.json()).toEqual({ ok: true });
    expect(String(out.headers['set-cookie'])).toContain('porter_session=;');
    const form = await built.app.inject({ method: 'POST', url: '/logout', headers: { accept: 'text/html' } });
    expect(form.statusCode).toBe(303);
    expect(form.headers.location).toBe('/login');
  });
});

describe('the mount', () => {
  it('sends a browser without the right cookie to the login', async () => {
    expect((await built.app.inject({ method: 'GET', url: '/s/0123456789abcdef/' })).statusCode).toBe(302);
    expect((await built.app.inject({ method: 'GET', url: '/s/0123456789abcdef/' })).headers.location).toBe('/login');
  });

  it('404s a key the cookie names but the registry has forgotten', async () => {
    const session = await built.app.inject({ method: 'POST', url: '/login', headers: { accept: 'application/json' }, payload: { username: 'chris', password: 'right' } });
    const key: string = (session.json() as { key: string }).key;
    built.registry.forget(key);
    expect((await built.app.inject({ method: 'GET', url: `/s/${key}/`, headers: { cookie: cookie_of(session) } })).statusCode).toBe(404);
  });

  it('sends the mount without its slash to the directory', async () => {
    const response = await built.app.inject({ method: 'GET', url: '/s/0123456789abcdef' });
    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe('/s/0123456789abcdef/');
  });
});

describe('the registry', () => {
  it('lists what the door let through, and forgets on request', async () => {
    await built.app.inject({ method: 'POST', url: '/login', headers: { accept: 'application/json' }, payload: { username: 'chris', password: 'right' } });
    const all = built.registry.all();
    expect(all.length).toBe(1);
    expect(all[0]?.user).toBe('chris');
    built.registry.forget(all[0]?.key ?? '');
    expect(built.registry.all()).toEqual([]);
    expect((await built.app.inject({ method: 'GET', url: '/healthz' })).json()).toMatchObject({ ok: true, sessions: 0 });
  });
});

describe('address helpers', () => {
  it('splits a mount URL into key and rest', () => {
    expect(mountUrl_split('/s/0123456789abcdef/')).toEqual({ key: '0123456789abcdef', rest: '/' });
    expect(mountUrl_split('/s/0123456789abcdef/assets/x.js?v=1')).toEqual({ key: '0123456789abcdef', rest: '/assets/x.js?v=1' });
    expect(mountUrl_split('/s/short/')).toBeNull();
    expect(mountUrl_split('/elsewhere')).toBeNull();
  });

  it('puts the token on the byte route and the wire, and nowhere else', () => {
    expect(upstreamPath_build('/vfs?path=%2Fa', 'T')).toBe('/vfs?path=%2Fa&token=T');
    expect(upstreamPath_build('/?door', 'T')).toBe('/?door=&token=T');
    expect(upstreamPath_build('/assets/x.js', 'T')).toBe('/assets/x.js');
    expect(upstreamPath_build('sounds/press.mp3', 'T')).toBe('/sounds/press.mp3');
  });

  it('names a berth\'s HTTP origin', () => {
    expect(berthHttp_of({ identity: 'i', url: 'ws://127.0.0.1:4444', token: 't' })).toBe('http://127.0.0.1:4444');
  });
});

describe('the wire through the mount', () => {
  let daemon: WebSocketServer;
  let seenUrl: string | null = null;

  beforeEach(async () => {
    seenUrl = null;
    daemon = new WebSocketServer({ host: '127.0.0.1', port: 0 });
    daemon.on('connection', (socket: WebSocket, request: { url?: string }): void => {
      seenUrl = request.url ?? null;
      socket.on('message', (data: RawData): void => { socket.send(`echo:${data.toString()}`); });
    });
    await new Promise<void>((resolve) => daemon.once('listening', () => resolve()));
  });
  afterEach(async () => {
    daemon.close();
    await built.app.close();
  });

  it('relays the upgrade to the daemon with the token on its URL, and the frames both ways', async () => {
    const port: number = (daemon.address() as AddressInfo).port;
    host.found = { identity: 'chris@https://cube.example.org/api/v1/', url: `ws://127.0.0.1:${port}`, token: 'ATTACH' };
    const session = await built.app.inject({ method: 'POST', url: '/login', headers: { accept: 'application/json' }, payload: { username: 'chris', password: 'right' } });
    const key: string = (session.json() as { key: string }).key;
    await built.app.listen({ host: '127.0.0.1', port: 0 });
    const porterPort: number = (built.app.server.address() as AddressInfo).port;
    const client: WebSocket = new WebSocket(`ws://127.0.0.1:${porterPort}/s/${key}/?door`, { headers: { cookie: cookie_of(session) } });
    await new Promise<void>((resolve, reject) => { client.once('open', () => resolve()); client.once('error', reject); });
    const echoed: Promise<string> = new Promise((resolve) => client.once('message', (data: RawData) => resolve(data.toString())));
    client.send('hello');
    expect(await echoed).toBe('echo:hello');
    expect(seenUrl).toBe('/?door=&token=ATTACH');
    client.close();
  });

  it('drops an upgrade without the cookie, even for a known key', async () => {
    const port: number = (daemon.address() as AddressInfo).port;
    host.found = { identity: 'chris@https://cube.example.org/api/v1/', url: `ws://127.0.0.1:${port}`, token: 'ATTACH' };
    const session = await built.app.inject({ method: 'POST', url: '/login', headers: { accept: 'application/json' }, payload: { username: 'chris', password: 'right' } });
    const key: string = (session.json() as { key: string }).key;
    await built.app.listen({ host: '127.0.0.1', port: 0 });
    const porterPort: number = (built.app.server.address() as AddressInfo).port;
    const client: WebSocket = new WebSocket(`ws://127.0.0.1:${porterPort}/s/${key}/`);
    const outcome: string = await new Promise((resolve) => {
      client.once('open', () => resolve('open'));
      client.once('error', () => resolve('refused'));
    });
    expect(outcome).toBe('refused');
    expect(seenUrl).toBeNull();
  });

  it('drops an upgrade for an unknown key', async () => {
    await built.app.listen({ host: '127.0.0.1', port: 0 });
    const porterPort: number = (built.app.server.address() as AddressInfo).port;
    const client: WebSocket = new WebSocket(`ws://127.0.0.1:${porterPort}/s/0123456789abcdef/`);
    const outcome: string = await new Promise((resolve) => {
      client.once('open', () => resolve('open'));
      client.once('error', () => resolve('refused'));
    });
    expect(outcome).toBe('refused');
  });
});
