/**
 * @file Sessions as child processes on this host, one per identity, each in
 * four directories of its own.
 *
 * A session is `chell --daemon <user>@<url> --auth-token-stdin`: the token
 * on stdin, one line, never argv; the config, runtime, cache and tmp
 * directories under the porter's state, keyed by the identity's berth key,
 * because a daemon that shares any of them with another identity's has cost
 * real sessions their working directory. The child's berth lands in its own
 * runtime directory, and that is where the host reads it back.
 *
 * The boot's stdout and stderr are kept, line by line, for as long as the
 * child lives: a greeter that attaches late replays them, one that is there
 * follows them, and the terminal boot and the browser boot are the same
 * text.
 *
 * @module
 */
import { spawn as childSpawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { berthKey_compute, berth_pathIn, berthUrl_isAlive } from '@fnndsc/calypso/berth';
import type { Berth, BootLine, BootListener, BootReport, SessionHost } from './sessionHost.js';

/** The four directories a session owns. */
export interface SessionDirs {
  config: string;
  runtime: string;
  cache: string;
  tmp: string;
}

/** What the host needs of a child it started. */
export interface SpawnedSession {
  pid: number | undefined;
  stdout: NodeJS.ReadableStream | null;
  stderr: NodeJS.ReadableStream | null;
  stdin: NodeJS.WritableStream | null;
  exitCode: number | null;
  kill(signal?: NodeJS.Signals): boolean;
  once(event: 'exit', listener: (code: number | null) => void): unknown;
}

/** A process spawner with the shape of `child_process.spawn`. */
export type SessionSpawn = (command: string, args: string[], options: { env: NodeJS.ProcessEnv; stdio: ['pipe', 'pipe', 'pipe'] }) => SpawnedSession;

/** Whether a berth's daemon answers on the wire. */
export type LivenessProbe = (url: string) => Promise<boolean>;

/** What the process host is built from. */
export interface ProcessHostOptions {
  /** Where each identity's subtree goes. */
  stateDir: string;
  /** The chell entry to run. */
  chellEntry: string;
  /** The spawner; `child_process.spawn` by default. */
  spawn?: SessionSpawn;
  /** The liveness probe; a TCP connect to the berth by default. */
  alive?: LivenessProbe;
  /** How long a boot may take before it is called failed, in ms. */
  bootTimeoutMs?: number;
  /** How often to look for the berth while booting, in ms. */
  pollMs?: number;
}

/** One session this host knows about. */
interface SessionRecord {
  identity: string;
  child: SpawnedSession | null;
  lines: BootLine[];
  state: 'booting' | 'ready' | 'failed';
  reason?: string;
  listeners: Set<BootListener>;
  starting: Promise<Berth> | null;
}

/** Default spawner: a real child with piped streams. */
const spawn_real: SessionSpawn = (command: string, args: string[], options: { env: NodeJS.ProcessEnv; stdio: ['pipe', 'pipe', 'pipe'] }): SpawnedSession => {
  const child: ChildProcess = childSpawn(command, args, { env: options.env, stdio: options.stdio });
  return child as unknown as SpawnedSession;
};

/**
 * Splits a stream's chunks into lines, handing over each complete one.
 *
 * @param stream - The stream to read.
 * @param onLine - Told each line without its ending.
 */
function stream_lines(stream: NodeJS.ReadableStream | null, onLine: (line: string) => void): void {
  if (stream === null) return;
  let buffered: string = '';
  stream.on('data', (chunk: Buffer | string): void => {
    buffered += chunk.toString();
    let cut: number = buffered.indexOf('\n');
    while (cut !== -1) {
      onLine(buffered.slice(0, cut).replace(/\r$/, ''));
      buffered = buffered.slice(cut + 1);
      cut = buffered.indexOf('\n');
    }
  });
  stream.on('end', (): void => {
    if (buffered.length > 0) onLine(buffered);
    buffered = '';
  });
}

/** Sessions as child processes on this host. */
export class ProcessHost implements SessionHost {
  private readonly stateDir: string;
  private readonly chellEntry: string;
  private readonly spawner: SessionSpawn;
  private readonly alive: LivenessProbe;
  private readonly bootTimeoutMs: number;
  private readonly pollMs: number;
  private readonly sessions: Map<string, SessionRecord> = new Map();

  constructor(options: ProcessHostOptions) {
    this.stateDir = options.stateDir;
    this.chellEntry = options.chellEntry;
    this.spawner = options.spawn ?? spawn_real;
    this.alive = options.alive ?? ((url: string): Promise<boolean> => berthUrl_isAlive(url));
    this.bootTimeoutMs = options.bootTimeoutMs ?? 120_000;
    this.pollMs = options.pollMs ?? 250;
  }

  /**
   * The four directories an identity's session owns, under the state dir.
   *
   * @param identity - The normalised identity.
   * @returns The directories; not necessarily existing yet.
   */
  public dirs_of(identity: string): SessionDirs {
    const root: string = join(this.stateDir, berthKey_compute(identity));
    return {
      config: join(root, 'config'),
      runtime: join(root, 'run'),
      cache: join(root, 'cache'),
      tmp: join(root, 'tmp'),
    };
  }

  /** Reads an identity's berth from its own runtime directory, if written. */
  private berth_read(identity: string): Berth | null {
    const path: string = berth_pathIn(this.dirs_of(identity).runtime, identity);
    if (!existsSync(path)) return null;
    try {
      const parsed: Partial<Berth> = JSON.parse(readFileSync(path, 'utf-8')) as Partial<Berth>;
      if (typeof parsed.url === 'string' && typeof parsed.token === 'string' && typeof parsed.identity === 'string') {
        return { identity: parsed.identity, url: parsed.url, token: parsed.token };
      }
    } catch {
      // A half-written berth reads as none; the next poll reads it whole.
    }
    return null;
  }

  /** @inheritdoc */
  public async find(identity: string): Promise<Berth | null> {
    const berth: Berth | null = this.berth_read(identity);
    if (berth === null) return null;
    return (await this.alive(berth.url)) ? berth : null;
  }

  /** @inheritdoc */
  public async spawn(identity: string, user: string, cubeUrl: string, token: string): Promise<Berth> {
    const existing: SessionRecord | undefined = this.sessions.get(identity);
    if (existing?.starting) return existing.starting;
    const record: SessionRecord = {
      identity,
      child: null,
      lines: [],
      state: 'booting',
      listeners: new Set(),
      starting: null,
    };
    this.sessions.set(identity, record);
    record.starting = this.boot_run(record, user, cubeUrl, token).finally((): void => { record.starting = null; });
    return record.starting;
  }

  /** Starts the child and waits for its berth to answer. */
  private async boot_run(record: SessionRecord, user: string, cubeUrl: string, token: string): Promise<Berth> {
    const dirs: SessionDirs = this.dirs_of(record.identity);
    for (const dir of Object.values(dirs)) mkdirSync(dir, { recursive: true, mode: 0o700 });
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      XDG_CONFIG_HOME: dirs.config,
      XDG_RUNTIME_DIR: dirs.runtime,
      XDG_CACHE_HOME: dirs.cache,
      TMPDIR: dirs.tmp,
      // The boot rows are for a greeter that renders them as a terminal
      // would; chalk sees no TTY here and would strip the colour.
      FORCE_COLOR: '3',
    };
    const child: SpawnedSession = this.spawner(process.execPath, [this.chellEntry, `${user}@${cubeUrl}`, '--daemon', '--auth-token-stdin'], { env, stdio: ['pipe', 'pipe', 'pipe'] });
    record.child = child;
    const line_note = (channel: 'out' | 'err', text: string): void => {
      const line: BootLine = { channel, text };
      record.lines.push(line);
      for (const listener of record.listeners) listener.line(line);
    };
    stream_lines(child.stdout, (text: string): void => line_note('out', text));
    stream_lines(child.stderr, (text: string): void => line_note('err', text));
    child.stdin?.end(`${token}\n`);
    let exited: number | null = null;
    child.once('exit', (code: number | null): void => { exited = code ?? 0; });

    const deadline: number = Date.now() + this.bootTimeoutMs;
    while (Date.now() < deadline) {
      if (exited !== null) {
        return this.boot_end(record, 'failed', `the session exited during boot (code ${exited})`);
      }
      const berth: Berth | null = this.berth_read(record.identity);
      if (berth !== null && (await this.alive(berth.url))) {
        this.boot_end(record, 'ready');
        return berth;
      }
      await new Promise<void>((resolve: () => void): void => { setTimeout(resolve, this.pollMs); });
    }
    child.kill('SIGTERM');
    return this.boot_end(record, 'failed', `the session did not answer within ${Math.round(this.bootTimeoutMs / 1000)} s`);
  }

  /** Settles a boot and tells everyone following it. */
  private boot_end(record: SessionRecord, state: 'ready', reason?: undefined): void;
  private boot_end(record: SessionRecord, state: 'failed', reason: string): never;
  private boot_end(record: SessionRecord, state: 'ready' | 'failed', reason?: string): void {
    record.state = state;
    record.reason = reason;
    for (const listener of record.listeners) listener.done(state, reason);
    record.listeners.clear();
    if (state === 'failed') throw new Error(reason);
  }

  /** @inheritdoc */
  public boot_follow(identity: string, listener: BootListener): { report: BootReport; release: () => void } | null {
    const record: SessionRecord | undefined = this.sessions.get(identity);
    if (record === undefined) return null;
    const report: BootReport = { lines: [...record.lines], state: record.state, ...(record.reason !== undefined ? { reason: record.reason } : {}) };
    if (record.state === 'booting') record.listeners.add(listener);
    return { report, release: (): void => { record.listeners.delete(listener); } };
  }

  /** @inheritdoc */
  public async evict(identity: string): Promise<boolean> {
    const record: SessionRecord | undefined = this.sessions.get(identity);
    if (record?.child && record.child.exitCode === null) {
      record.child.kill('SIGTERM');
      this.sessions.delete(identity);
      return true;
    }
    // A session this porter did not start — an earlier porter's, still up —
    // is found by its berth but not owned; there is no pid to signal.
    this.sessions.delete(identity);
    return false;
  }
}
