/**
 * @file The porter's routes: the door, the boot, and the session behind it.
 *
 * - `GET /login` — the door: a username and a password, nothing else.
 * - `POST /login` — the password goes to CUBE once and comes back a token;
 *   the token starts (or joins) that identity's session; the browser is
 *   given a signed cookie naming the session. A session already up is
 *   entered at once; one that has to boot is watched from the greet, which
 *   the door answers with immediately — a browser is never held for a
 *   boot. A JSON caller gets the mount and the state (`attached` or
 *   `starting`) instead of a redirect. Every login checks the password
 *   even when the session is up: a berth proves the daemon, not the human.
 * - `GET /greet/<key>` — the greeter: the brain awake and the boot rows
 *   arriving, until `ready` hands the browser to the session.
 * - `GET /greeter/brain.js`, `/greeter/ansi.js` — the wire package's own
 *   modules, served from where they are installed, so the greeter draws
 *   the brain and the rows from the same source the console does.
 * - `POST /logout` — the cookie is cleared; the session lives on.
 * - `GET /boot/<key>` — the session's boot as it happens, server-sent, one
 *   event per line the daemon wrote, ending with `ready` or `failed`.
 * - `/s/<key>/…` — the session itself: the argus page and its assets, the
 *   `/vfs` byte route, and the WebSocket wire, proxied to the daemon on
 *   loopback. The attach token is put on the proxied `/vfs` query and the
 *   proxied upgrade URL by the porter; the browser never holds it.
 *
 * The cookie gates everything under `/s/` and `/boot/`: a browser reaches
 * only the session its cookie names, and a request with none is sent to the
 * door. TLS is somebody else's — a caddy, an ingress — and `trustProxy`
 * lets the porter learn from them that the page came over it.
 *
 * @module
 */
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import fastifyCookie, { unsign as cookie_unsign } from '@fastify/cookie';
import fastifyFormbody from '@fastify/formbody';
import replyFrom from '@fastify/reply-from';
import { z } from 'zod';
import { connect as net_connect, type Socket } from 'node:net';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { identity_normalise } from '@fnndsc/calypso/berth';
import type { PorterConfig } from './config.js';
import type { SessionHost, Berth, BootLine } from './host/sessionHost.js';
import { SessionRegistry, type SessionEntry } from './registry.js';
import { cubeToken_mint, type TokenMint } from './cube/auth.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DOOR_COOKIE, doorCookie_options } from './door.js';
import { loginPage_render, greetPage_render } from './greeter.js';

/** What the routes are built over. */
export interface PorterAppOptions {
  config: PorterConfig;
  host: SessionHost;
  /** How a password becomes a token; CUBE's `auth-token/` by default. */
  mint?: (cubeUrl: string, username: string, password: string) => Promise<TokenMint>;
  /** Fastify's logger switch. */
  logger?: boolean;
  /** One line per thing the door does, for the porter's own terminal. */
  log?: (line: string) => void;
}

/** A porter application: the Fastify instance and the registry behind it. */
export interface PorterApp {
  app: FastifyInstance;
  registry: SessionRegistry;
}

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

/**
 * The upstream base for a berth: its `ws://host:port` as `http://`.
 *
 * @param berth - The berth.
 * @returns The daemon's HTTP origin.
 */
export function berthHttp_of(berth: Berth): string {
  return berth.url.replace(/^ws/, 'http');
}

/**
 * The path to hand the daemon for a request under a session's mount, the
 * token added where the daemon wants it.
 *
 * @param rest - The path after `/s/<key>/`, query included.
 * @param token - The session's attach token.
 * @returns The upstream path, always beginning with `/`.
 */
export function upstreamPath_build(rest: string, token: string): string {
  const path: string = rest.startsWith('/') ? rest : `/${rest}`;
  const cut: number = path.indexOf('?');
  const pathname: string = cut === -1 ? path : path.slice(0, cut);
  const query: URLSearchParams = new URLSearchParams(cut === -1 ? '' : path.slice(cut + 1));
  if (pathname === '/vfs' || pathname === '/') {
    // The byte route is token-gated; the wire's upgrade lands on `/`.
    query.set('token', token);
  }
  const text: string = query.toString();
  return text.length > 0 ? `${pathname}?${text}` : pathname;
}

/**
 * Splits a request URL under `/s/` into its key and the rest.
 *
 * @param url - The request URL, query included.
 * @returns The key and the rest (beginning with `/`), or null when the URL
 *   is not under `/s/<key>/`.
 */
export function mountUrl_split(url: string): { key: string; rest: string } | null {
  const match: RegExpMatchArray | null = /^\/s\/([0-9a-f]{16})(\/.*)?$/.exec(url) as RegExpMatchArray | null;
  if (match === null) return null;
  return { key: match[1] ?? '', rest: match[2] ?? '/' };
}

/**
 * The session key a cookie header names, once its signature is checked.
 *
 * @param cookieHeader - The raw `Cookie` header, or undefined.
 * @param secret - The door's signing secret.
 * @returns The key, or null when there is no cookie or its signature fails.
 */
export function cookieKey_read(cookieHeader: string | undefined, secret: string): string | null {
  if (cookieHeader === undefined) return null;
  // The one cookie wanted, out of a header that may carry any number: the
  // plugin parses only for a request it decorated, and an upgrade has none.
  let raw: string | undefined;
  for (const part of cookieHeader.split(';')) {
    const cut: number = part.indexOf('=');
    if (cut === -1) continue;
    if (part.slice(0, cut).trim() !== DOOR_COOKIE) continue;
    try {
      raw = decodeURIComponent(part.slice(cut + 1).trim());
    } catch {
      return null;
    }
    break;
  }
  if (raw === undefined) return null;
  const checked = cookie_unsign(raw, secret);
  return checked.valid && checked.value !== null && /^[0-9a-f]{16}$/.test(checked.value) ? checked.value : null;
}

/** Whether a request would rather be answered in JSON than sent somewhere. */
function request_wantsJson(request: FastifyRequest): boolean {
  const contentType: string = String(request.headers['content-type'] ?? '');
  const accept: string = String(request.headers.accept ?? '');
  return contentType.includes('application/json') || (accept.includes('application/json') && !accept.includes('text/html'));
}

/**
 * Builds the porter's routes over a host and a config.
 *
 * @param options - The config, the session host, and the seams a test replaces.
 * @returns The application, not yet listening.
 */
export async function porterApp_build(options: PorterAppOptions): Promise<PorterApp> {
  const { config, host } = options;
  const mint = options.mint ?? cubeToken_mint;
  const registry: SessionRegistry = new SessionRegistry();
  const app: FastifyInstance = Fastify({ logger: options.logger ?? false, trustProxy: true });
  await app.register(fastifyCookie, { secret: config.secret });
  await app.register(fastifyFormbody);
  await app.register(replyFrom);

  /** The key the request's cookie names, or null. */
  const key_ofRequest = (request: FastifyRequest): string | null => cookieKey_read(request.headers.cookie, config.secret);

  app.get('/healthz', async (): Promise<{ ok: true; cube: string; sessions: number }> => ({ ok: true, cube: config.cubeUrl, sessions: registry.all().length }));

  app.get('/', async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const key: string | null = key_ofRequest(request);
    const entry: SessionEntry | null = key === null ? null : registry.get(key);
    await reply.redirect(entry === null ? '/login' : `/s/${entry.key}/?door`, 302);
  });

  app.get('/login', async (request: FastifyRequest, reply: FastifyReply): Promise<string> => {
    const reason: unknown = (request.query as { reason?: unknown }).reason;
    void reply.type('text/html; charset=utf-8');
    return loginPage_render(config.cubeUrl, typeof reason === 'string' && reason.length > 0 ? reason : null);
  });

  app.post('/login', async (request: FastifyRequest, reply: FastifyReply): Promise<unknown> => {
    const wantsJson: boolean = request_wantsJson(request);
    const refuse = async (status: number, reason: string): Promise<unknown> =>
      wantsJson ? reply.code(status).send({ error: reason }) : reply.redirect(`/login?reason=${encodeURIComponent(reason)}`, 303);
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) {
      return refuse(400, 'a username and a password are required');
    }
    const { username, password } = parsed.data;
    const minted: TokenMint = await mint(config.cubeUrl, username, password);
    if (minted.token === null) {
      return refuse(401, minted.reason ?? 'refused');
    }
    const identity: string = identity_normalise(username, config.cubeUrl);
    const found: Berth | null = await host.find(identity);
    const key: string = registry.key_of(identity);
    void reply.setCookie(DOOR_COOKIE, key, doorCookie_options(config.cookieHours, request.protocol === 'https'));
    if (found !== null) {
      registry.note(identity, username, found);
      options.log?.(`attached ${username} to the session up at ${found.url}`);
      return wantsJson ? { key, mount: `/s/${key}/`, state: 'attached' } : reply.redirect(`/s/${key}/?door`, 303);
    }
    // The boot is watched, not waited for: the door answers now, and the
    // greet follows the rows until the berth answers. The berth reaches the
    // registry when the boot ends, so the mount refuses until then.
    registry.pending_note(identity, username);
    host.spawn_begin(identity, username, config.cubeUrl, minted.token);
    options.log?.(`starting a session for ${username}`);
    return wantsJson ? { key, mount: `/s/${key}/`, state: 'starting' } : reply.redirect(`/greet/${key}`, 303);
  });

  app.get('/greet/:key', async (request: FastifyRequest, reply: FastifyReply): Promise<unknown> => {
    const key: string = (request.params as { key: string }).key;
    if (key_ofRequest(request) !== key) {
      return reply.redirect('/login', 302);
    }
    void reply.type('text/html; charset=utf-8');
    return greetPage_render(config.cubeUrl, key);
  });

  // The greeter's two modules: the wire package's own, from where they are
  // installed. Read once; a porter does not restart for a menu upgrade.
  const greeterModules: Record<string, string> = {
    'brain.js': readFileSync(fileURLToPath(import.meta.resolve('@fnndsc/menu/logo')), 'utf-8'),
    'ansi.js': readFileSync(fileURLToPath(import.meta.resolve('@fnndsc/menu/ansi')), 'utf-8'),
  };
  app.get('/greeter/:name', async (request: FastifyRequest, reply: FastifyReply): Promise<unknown> => {
    const name: string = (request.params as { name: string }).name;
    const source: string | undefined = greeterModules[name];
    if (source === undefined) {
      return reply.code(404).send({ error: 'no such greeter module' });
    }
    void reply.type('text/javascript; charset=utf-8');
    return source;
  });

  app.post('/logout', async (request: FastifyRequest, reply: FastifyReply): Promise<unknown> => {
    void reply.clearCookie(DOOR_COOKIE, { path: '/' });
    return request_wantsJson(request) ? { ok: true } : reply.redirect('/login', 303);
  });

  app.get('/boot/:key', async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const key: string = (request.params as { key: string }).key;
    if (key_ofRequest(request) !== key) {
      await reply.code(401).send({ error: 'this browser was not let in to that session' });
      return;
    }
    const identity: string | null = registry.identity_of(key);
    if (identity === null) {
      await reply.code(404).send({ error: 'no session behind that key' });
      return;
    }
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    const event_send = (name: string, data: unknown): void => {
      reply.raw.write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`);
    };
    const followed = host.boot_follow(identity, {
      line: (line: BootLine): void => event_send('line', line),
      done: (state: 'ready' | 'failed', reason?: string): void => {
        void registry.settle(identity, host).then((): void => {
          event_send(state, { reason: reason ?? null });
          reply.raw.end();
        });
      },
    });
    if (followed === null) {
      // A session this porter found rather than started has no boot to
      // show: it is up, which is the only thing a greeter needs to hear.
      event_send('ready', { reason: null });
      reply.raw.end();
      return;
    }
    for (const line of followed.report.lines) event_send('line', line);
    if (followed.report.state !== 'booting') {
      await registry.settle(identity, host);
      event_send(followed.report.state, { reason: followed.report.reason ?? null });
      reply.raw.end();
      return;
    }
    request.raw.once('close', (): void => followed.release());
  });

  // The session itself, over HTTP: the page, its assets, and /vfs.
  app.all('/s/:key/*', async (request: FastifyRequest, reply: FastifyReply): Promise<unknown> => {
    const split = mountUrl_split(request.url);
    if (split === null || key_ofRequest(request) !== split.key) {
      return reply.redirect('/login', 302);
    }
    const entry: SessionEntry | null = registry.get(split.key);
    if (entry === null) {
      return reply.code(404).send({ error: 'no session behind that key' });
    }
    return reply.from(upstreamPath_build(split.rest, entry.berth.token), {
      getUpstream: (): string => berthHttp_of(entry.berth),
    });
  });
  app.all('/s/:key', async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    // The mount without its slash: the page's relative addresses need the
    // directory, so send the browser to it.
    const key: string = (request.params as { key: string }).key;
    await reply.redirect(`/s/${key}/`, 302);
  });

  // The session's wire: the upgrade is relayed byte for byte to the daemon,
  // with the token on the upgrade URL, which the daemon reads.
  app.addHook('onReady', async (): Promise<void> => {
    app.server.on('upgrade', (request: IncomingMessage, socket: Duplex, head: Buffer): void => {
      const split = mountUrl_split(request.url ?? '/');
      const entry: SessionEntry | null = split === null ? null : registry.get(split.key);
      if (split === null || entry === null || cookieKey_read(request.headers.cookie, config.secret) !== split.key) {
        socket.destroy();
        return;
      }
      const target: URL = new URL(entry.berth.url);
      const upstream: Socket = net_connect(Number(target.port), target.hostname, (): void => {
        const path: string = upstreamPath_build(split.rest, entry.berth.token);
        const lines: string[] = [`${request.method ?? 'GET'} ${path} HTTP/1.1`];
        for (const [name, value] of Object.entries(request.headers)) {
          lines.push(`${name}: ${Array.isArray(value) ? value.join(', ') : value ?? ''}`);
        }
        upstream.write(`${lines.join('\r\n')}\r\n\r\n`);
        if (head.length > 0) upstream.write(head);
        socket.pipe(upstream);
        upstream.pipe(socket);
      });
      upstream.on('error', (): void => { socket.destroy(); });
      socket.on('error', (): void => { upstream.destroy(); });
    });
  });

  return { app, registry };
}
