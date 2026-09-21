/**
 * @file The porter's routes: a session is asked for, watched booting, and
 * reached through.
 *
 * - `POST /sessions` — a username and password. The password goes to CUBE
 *   once and comes back as a token; the token starts (or joins) that
 *   identity's session; the answer is where the session is mounted.
 * - `GET /boot/<key>` — the session's boot as it happens, server-sent, one
 *   event per line the daemon wrote, ending with `ready` or `failed`.
 * - `/s/<key>/…` — the session itself: the argus page and its assets, the
 *   `/vfs` byte route, and the WebSocket wire, proxied to the daemon on
 *   loopback. The attach token is put on the proxied `/vfs` query and the
 *   proxied upgrade URL by the porter; the browser never holds it.
 *
 * This is the shape without the door: nothing here checks a cookie yet, so
 * a porter at this stage listens on loopback only. The door — the login
 * page, the cookie, LOG OUT — comes next and gates `/s/` and `/boot/`.
 *
 * @module
 */
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
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

/** What the routes are built over. */
export interface PorterAppOptions {
  config: PorterConfig;
  host: SessionHost;
  /** How a password becomes a token; CUBE's `auth-token/` by default. */
  mint?: (cubeUrl: string, username: string, password: string) => Promise<TokenMint>;
  /** Fastify's logger switch. */
  logger?: boolean;
}

/** A porter application: the Fastify instance and the registry behind it. */
export interface PorterApp {
  app: FastifyInstance;
  registry: SessionRegistry;
}

const sessionRequestSchema = z.object({
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
 * Builds the porter's routes over a host and a config.
 *
 * @param options - The config, the session host, and the seams a test replaces.
 * @returns The application, not yet listening.
 */
export async function porterApp_build(options: PorterAppOptions): Promise<PorterApp> {
  const { config, host } = options;
  const mint = options.mint ?? cubeToken_mint;
  const registry: SessionRegistry = new SessionRegistry();
  const app: FastifyInstance = Fastify({ logger: options.logger ?? false });
  await app.register(replyFrom);

  app.get('/healthz', async (): Promise<{ ok: true; cube: string; sessions: number }> => ({ ok: true, cube: config.cubeUrl, sessions: registry.all().length }));

  app.post('/sessions', async (request: FastifyRequest, reply: FastifyReply): Promise<unknown> => {
    const parsed = sessionRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'a username and a password are required' });
    }
    const { username, password } = parsed.data;
    const minted: TokenMint = await mint(config.cubeUrl, username, password);
    if (minted.token === null) {
      return reply.code(401).send({ error: minted.reason ?? 'refused' });
    }
    const identity: string = identity_normalise(username, config.cubeUrl);
    const found: Berth | null = await host.find(identity);
    const state: 'attached' | 'started' = found !== null ? 'attached' : 'started';
    let berth: Berth;
    if (found !== null) {
      berth = found;
    } else {
      try {
        berth = await host.spawn(identity, username, config.cubeUrl, minted.token);
      } catch (error: unknown) {
        return reply.code(502).send({ error: `the session did not start: ${error instanceof Error ? error.message : String(error)}` });
      }
    }
    const entry: SessionEntry = registry.note(identity, username, berth);
    return { key: entry.key, mount: `/s/${entry.key}/`, state };
  });

  app.get('/boot/:key', async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const key: string = (request.params as { key: string }).key;
    const entry: SessionEntry | null = registry.get(key);
    if (entry === null) {
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
    const followed = host.boot_follow(entry.identity, {
      line: (line: BootLine): void => event_send('line', line),
      done: (state: 'ready' | 'failed', reason?: string): void => {
        event_send(state, { reason: reason ?? null });
        reply.raw.end();
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
      event_send(followed.report.state, { reason: followed.report.reason ?? null });
      reply.raw.end();
      return;
    }
    request.raw.once('close', (): void => followed.release());
  });

  // The session itself, over HTTP: the page, its assets, and /vfs.
  app.all('/s/:key/*', async (request: FastifyRequest, reply: FastifyReply): Promise<unknown> => {
    const split = mountUrl_split(request.url);
    const entry: SessionEntry | null = split === null ? null : registry.get(split.key);
    if (split === null || entry === null) {
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
      if (split === null || entry === null) {
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
