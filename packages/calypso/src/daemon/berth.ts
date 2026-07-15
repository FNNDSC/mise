/**
 * @file Identity-keyed daemon berths.
 *
 * A *berth* is the advertised location of one running CALYPSO daemon, keyed by
 * the CUBE identity it hosts. It supersedes the single per-OS-user discovery
 * file: several daemons — one per `<user>@<url>` identity — can now advertise on
 * one machine, each in its own file, and a surface resolves the one it wants by
 * identity.
 *
 * The berth records the daemon's WebSocket address and attach token. Files live
 * in the user's runtime directory (`$XDG_RUNTIME_DIR`, else the system temp dir)
 * under an owned `calypso/` subdirectory, `0700` on the directory and `0600` on
 * each file — the same same-user perimeter the single-file discovery used, now
 * multiplied by identity. See docs/session-supervisor.adoc for the design.
 *
 * All berth lookup goes through the {@link BerthResolver} seam so a future
 * network `PorterBerthResolver` can replace the local one without any surface
 * change. Liveness (is the daemon still there?) is supplied to the local
 * resolver as an injected probe, keeping this server-side package free of a
 * WebSocket client: the surface injects a probe backed by its own attach client.
 *
 * @module
 */
import { writeFileSync, readFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { createHash } from 'node:crypto';
import { connect as net_connect, type Socket } from 'node:net';

/** The prefix of every berth filename, so a directory scan finds only berths. */
const BERTH_FILE_PREFIX: string = 'berth-';
/** The owned subdirectory berths live under, inside the runtime directory. */
const BERTH_SUBDIR: string = 'calypso';

/**
 * The advertised location of one running daemon, keyed by CUBE identity.
 *
 * @property identity - The normalised `<user>@<url>` this daemon hosts; stored
 *   so a resolve can verify an exact match rather than trust the filename hash
 *   alone.
 * @property url - The daemon's WebSocket address (e.g. `ws://127.0.0.1:54321`).
 * @property token - The attach token gating the daemon's handshake.
 */
export interface Berth {
  identity: string;
  url: string;
  token: string;
}

/**
 * Normalises a `<user>@<url>` identity lexically — no DNS, no network.
 *
 * The URL scheme and host are lowercased; the trailing slash CUBE requires is
 * preserved; the port and the user's case are kept exactly. Host aliases (a
 * short hostname versus its FQDN) are deliberately *not* merged: that is DNS
 * resolution, not string rewriting, and a key that depends on DNS breaks under
 * load balancers and split-horizon resolution. The rule is "same string, same
 * daemon" — operators adopt one canonical URL per CUBE by convention.
 *
 * @param user - The CUBE username, used with exact case.
 * @param cubeUrl - The CUBE API URL as the user typed it (scheme included).
 * @returns The normalised identity string used as the berth key input.
 */
export function identity_normalise(user: string, cubeUrl: string): string {
  const schemeSplit: number = cubeUrl.indexOf('://');
  let normalisedUrl: string;
  if (schemeSplit === -1) {
    normalisedUrl = cubeUrl;
  } else {
    const scheme: string = cubeUrl.slice(0, schemeSplit).toLowerCase();
    const rest: string = cubeUrl.slice(schemeSplit + 3);
    // Lowercase only the authority (host[:port]); leave the path exactly as
    // written, including the trailing slash CUBE requires.
    const pathStart: number = rest.indexOf('/');
    const authority: string = pathStart === -1 ? rest : rest.slice(0, pathStart);
    const path: string = pathStart === -1 ? '' : rest.slice(pathStart);
    normalisedUrl = `${scheme}://${authority.toLowerCase()}${path}`;
  }
  return `${user}@${normalisedUrl}`;
}

/** The reserved identity for a daemon started with no restored CUBE session. */
export const DISCONNECTED_IDENTITY: string = 'disconnected@no-cube';

/**
 * Derives the berth identity for a session, falling back to the reserved
 * disconnected identity when there is no restored user/URL. Both the daemon
 * (writing its berth) and a surface (guarding against a duplicate, or attaching)
 * key on this so they always agree.
 *
 * @param user - The connected CUBE username, or null/undefined when disconnected.
 * @param cubeUrl - The connected CUBE URL, or null/undefined when disconnected.
 * @returns The normalised identity, or {@link DISCONNECTED_IDENTITY}.
 */
export function identity_forSession(user: string | null | undefined, cubeUrl: string | null | undefined): string {
  return user && cubeUrl ? identity_normalise(user, cubeUrl) : DISCONNECTED_IDENTITY;
}

/**
 * Computes the short, filesystem-safe key for a normalised identity.
 *
 * @param identity - A normalised identity from {@link identity_normalise}.
 * @returns The first 16 hex characters of the identity's SHA-256 digest.
 */
export function berthKey_compute(identity: string): string {
  return createHash('sha256').update(identity).digest('hex').slice(0, 16);
}

/**
 * The directory berths live in: `$XDG_RUNTIME_DIR/calypso` when the runtime
 * directory is set (Linux, per-user `0700`, cleared on logout), else the system
 * temp directory (macOS `TMPDIR` is already per-user-private; Linux `/tmp`).
 *
 * @returns The absolute berth directory path (not guaranteed to exist yet).
 */
export function berthDir_path(): string {
  const runtimeDir: string = process.env.XDG_RUNTIME_DIR || tmpdir();
  return join(runtimeDir, BERTH_SUBDIR);
}

/**
 * Ensures the berth directory exists, owner-only (`0700`).
 */
function berthDir_ensure(): void {
  mkdirSync(berthDir_path(), { recursive: true, mode: 0o700 });
}

/**
 * The absolute path of one identity's berth file.
 *
 * @param identity - A normalised identity from {@link identity_normalise}.
 * @returns The berth file path (may not exist).
 */
export function berth_path(identity: string): string {
  return join(berthDir_path(), `${BERTH_FILE_PREFIX}${berthKey_compute(identity)}.json`);
}

/**
 * Writes a berth to its identity-keyed file, readable only by the current user.
 *
 * @param berth - The berth to advertise; its `identity` must be normalised.
 */
export function berth_write(berth: Berth): void {
  berthDir_ensure();
  writeFileSync(berth_path(berth.identity), JSON.stringify(berth), { mode: 0o600 });
}

/**
 * Validates that an unknown parsed value is a well-formed {@link Berth}.
 *
 * @param parsed - The value read from a berth file.
 * @returns The value as a Berth, or null when it is malformed.
 */
function berth_validate(parsed: unknown): Berth | null {
  if (
    typeof parsed === 'object' && parsed !== null &&
    typeof (parsed as Berth).identity === 'string' &&
    typeof (parsed as Berth).url === 'string' &&
    typeof (parsed as Berth).token === 'string'
  ) {
    return parsed as Berth;
  }
  return null;
}

/**
 * Reads one identity's berth from disk, verifying the stored identity matches
 * exactly (so a hash collision can never mis-route).
 *
 * @param identity - A normalised identity from {@link identity_normalise}.
 * @returns The berth, or null when none is advertised or it is malformed.
 */
export function berth_read(identity: string): Berth | null {
  const path: string = berth_path(identity);
  if (!existsSync(path)) {
    return null;
  }
  try {
    const berth: Berth | null = berth_validate(JSON.parse(readFileSync(path, 'utf-8')));
    return berth && berth.identity === identity ? berth : null;
  } catch {
    return null;
  }
}

/**
 * Reads every advertised berth in the berth directory.
 *
 * @returns All well-formed berths; an empty array when the directory is absent
 *   or holds none.
 */
export function berthAll_read(): Berth[] {
  const dir: string = berthDir_path();
  if (!existsSync(dir)) {
    return [];
  }
  const berths: Berth[] = [];
  for (const name of readdirSync(dir)) {
    if (!name.startsWith(BERTH_FILE_PREFIX) || !name.endsWith('.json')) {
      continue;
    }
    try {
      const berth: Berth | null = berth_validate(JSON.parse(readFileSync(join(dir, name), 'utf-8')));
      if (berth) {
        berths.push(berth);
      }
    } catch {
      // A malformed or vanished file is simply skipped.
    }
  }
  return berths;
}

/**
 * Removes an identity's berth file if present (used to reap a berth whose
 * daemon a liveness probe found dead).
 *
 * @param identity - A normalised identity from {@link identity_normalise}.
 */
export function berth_remove(identity: string): void {
  const path: string = berth_path(identity);
  if (existsSync(path)) {
    try {
      unlinkSync(path);
    } catch {
      // Already gone: the reap is a best-effort convenience.
    }
  }
}

/**
 * Reports whether something is listening at a berth's WebSocket address, by a
 * plain TCP connect — no WebSocket handshake, so this stays within the daemon
 * package (which has no client). It is the liveness check `daemon_launch` uses
 * to refuse starting a rival for an identity that is already hosted; a surface's
 * resolver uses a stronger handshake probe for attach.
 *
 * @param url - A `ws://host:port` berth URL.
 * @param timeoutMs - How long to wait for the TCP connect (default 500 ms).
 * @returns True when the port accepts a connection.
 */
export function berthUrl_isAlive(url: string, timeoutMs: number = 500): Promise<boolean> {
  return new Promise((resolve: (alive: boolean) => void): void => {
    let host: string;
    let port: number;
    try {
      const parsed: URL = new URL(url);
      host = parsed.hostname;
      port = Number(parsed.port);
    } catch {
      resolve(false);
      return;
    }
    if (!port) {
      resolve(false);
      return;
    }
    const socket: Socket = net_connect({ host, port });
    const settle = (alive: boolean): void => {
      socket.destroy();
      resolve(alive);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', (): void => settle(true));
    socket.once('timeout', (): void => settle(false));
    socket.once('error', (): void => settle(false));
  });
}

/**
 * A probe that reports whether a berth's daemon is actually reachable. The
 * surface supplies one backed by its attach client; the local resolver uses it
 * to reap dead berths on read.
 */
export type BerthLivenessProbe = (berth: Berth) => Promise<boolean>;

/**
 * The berth lookup seam. Tier 1 ships {@link LocalBerthResolver} over the local
 * files; a future tier-2 `PorterBerthResolver` will implement the same contract
 * over the network. Every surface depends only on this interface.
 */
export interface BerthResolver {
  /**
   * Resolves one identity to a live berth.
   *
   * @param identity - A normalised identity from {@link identity_normalise}.
   * @returns The live berth, or null when none is advertised or it is dead.
   */
  resolve(identity: string): Promise<Berth | null>;
  /**
   * Lists every live berth (for a bare `--remote` with several daemons).
   *
   * @returns The live berths, dead ones reaped.
   */
  list(): Promise<Berth[]>;
}

/**
 * The tier-1 resolver: reads identity-keyed berth files and, when given a
 * liveness probe, reaps any berth whose daemon has gone (passive cleanup — the
 * next read of a stale berth removes it). Without a probe it returns berths as
 * recorded, trusting the caller's own attach to surface a dead one.
 */
export class LocalBerthResolver implements BerthResolver {
  /**
   * @param liveness_probe - Optional reachability probe; when present, dead
   *   berths are reaped and never returned.
   */
  constructor(private readonly liveness_probe?: BerthLivenessProbe) {}

  /** @inheritdoc */
  public async resolve(identity: string): Promise<Berth | null> {
    const berth: Berth | null = berth_read(identity);
    if (!berth) {
      return null;
    }
    if (this.liveness_probe && !(await this.liveness_probe(berth))) {
      berth_remove(berth.identity);
      return null;
    }
    return berth;
  }

  /** @inheritdoc */
  public async list(): Promise<Berth[]> {
    const berths: Berth[] = berthAll_read();
    if (!this.liveness_probe) {
      return berths;
    }
    const live: Berth[] = [];
    for (const berth of berths) {
      if (await this.liveness_probe(berth)) {
        live.push(berth);
      } else {
        berth_remove(berth.identity);
      }
    }
    return live;
  }
}
