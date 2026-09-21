/**
 * @file Sessions as processes: four directories each, the token on stdin,
 * the boot followed, the berth read from where the child put it.
 */
import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { berth_pathIn } from '@fnndsc/calypso/berth';
import { ProcessHost, type SpawnedSession, type SessionSpawn } from '../../src/host/processHost.js';
import type { BootLine } from '../../src/host/sessionHost.js';

const IDENTITY: string = 'chris@https://cube.example.org/api/v1/';

/** A child the test drives: streams it can write, an exit it can fire. */
class FakeChild extends EventEmitter implements SpawnedSession {
  public pid: number = 4242;
  public stdout: PassThrough = new PassThrough();
  public stderr: PassThrough = new PassThrough();
  public stdin: PassThrough = new PassThrough();
  public exitCode: number | null = null;
  public stdinText: string = '';
  public killed: NodeJS.Signals | null = null;
  constructor() {
    super();
    this.stdin.on('data', (chunk: Buffer): void => { this.stdinText += chunk.toString(); });
  }
  kill(signal?: NodeJS.Signals): boolean { this.killed = signal ?? 'SIGTERM'; this.exit(143); return true; }
  exit(code: number): void { this.exitCode = code; this.emit('exit', code); }
}

let stateDir: string;
let child: FakeChild;
let spawnCalls: Array<{ command: string; args: string[]; env: NodeJS.ProcessEnv }>;
let alive: boolean;

const spawn: SessionSpawn = (command, args, options): SpawnedSession => {
  spawnCalls.push({ command, args, env: options.env });
  return child;
};

function host_make(): ProcessHost {
  return new ProcessHost({ stateDir, chellEntry: '/opt/chell/dist/index.js', spawn, alive: async (): Promise<boolean> => alive, bootTimeoutMs: 2_000, pollMs: 20 });
}

function berth_plant(host: ProcessHost): void {
  const runtime: string = host.dirs_of(IDENTITY).runtime;
  const path: string = berth_pathIn(runtime, IDENTITY);
  mkdirSync(join(runtime, 'calypso'), { recursive: true });
  writeFileSync(path, JSON.stringify({ identity: IDENTITY, url: 'ws://127.0.0.1:4444', token: 'ATTACH' }));
}

beforeEach(() => {
  stateDir = mkdtempSync(join(tmpdir(), 'porter-host-'));
  child = new FakeChild();
  spawnCalls = [];
  alive = true;
});
afterEach(() => { rmSync(stateDir, { recursive: true, force: true }); });

describe('ProcessHost', () => {
  it('finds nothing before a session exists, and a berth that answers after', async () => {
    const host: ProcessHost = host_make();
    expect(await host.find(IDENTITY)).toBeNull();
    berth_plant(host);
    expect(await host.find(IDENTITY)).toEqual({ identity: IDENTITY, url: 'ws://127.0.0.1:4444', token: 'ATTACH' });
    alive = false;
    expect(await host.find(IDENTITY)).toBeNull();
  });

  it('starts chell with the token on stdin, in four directories of its own', async () => {
    const host: ProcessHost = host_make();
    const starting: Promise<unknown> = host.spawn(IDENTITY, 'chris', 'https://cube.example.org/api/v1/', 'MINTED');
    await new Promise((r) => setTimeout(r, 30));
    const call = spawnCalls[0];
    expect(call).toBeDefined();
    expect(call?.command).toBe(process.execPath);
    expect(call?.args).toEqual(['/opt/chell/dist/index.js', 'chris@https://cube.example.org/api/v1/', '--daemon', '--auth-token-stdin', '--no-logo']);
    expect(call?.args.join(' ')).not.toContain('MINTED');
    expect(child.stdinText).toBe('MINTED\n');
    const dirs = host.dirs_of(IDENTITY);
    expect(call?.env.XDG_CONFIG_HOME).toBe(dirs.config);
    expect(call?.env.XDG_RUNTIME_DIR).toBe(dirs.runtime);
    expect(call?.env.XDG_CACHE_HOME).toBe(dirs.cache);
    expect(call?.env.TMPDIR).toBe(dirs.tmp);
    for (const dir of Object.values(dirs)) expect(existsSync(dir)).toBe(true);
    berth_plant(host);
    const berth = await starting;
    expect(berth).toEqual({ identity: IDENTITY, url: 'ws://127.0.0.1:4444', token: 'ATTACH' });
  });

  it('keeps the boot for a follower, and tells one who is there', async () => {
    const host: ProcessHost = host_make();
    const starting: Promise<unknown> = host.spawn(IDENTITY, 'chris', 'https://cube.example.org/api/v1/', 'MINTED');
    await new Promise((r) => setTimeout(r, 10));
    child.stdout.write('[ OK ] Session\n[ OK ] Con');
    child.stderr.write('warm\n');
    await new Promise((r) => setTimeout(r, 10));
    const seen: BootLine[] = [];
    let ended: string | null = null;
    const followed = host.boot_follow(IDENTITY, { line: (line: BootLine): void => { seen.push(line); }, done: (state: string): void => { ended = state; } });
    expect(followed?.report.state).toBe('booting');
    expect(followed?.report.lines).toEqual([{ channel: 'out', text: '[ OK ] Session' }, { channel: 'err', text: 'warm' }]);
    child.stdout.write('nect\n');
    await new Promise((r) => setTimeout(r, 10));
    expect(seen).toEqual([{ channel: 'out', text: '[ OK ] Connect' }]);
    berth_plant(host);
    await starting;
    expect(ended).toBe('ready');
    expect(host.boot_follow(IDENTITY, { line: (): void => undefined, done: (): void => undefined })?.report.state).toBe('ready');
  });

  it('fails the boot when the child exits first', async () => {
    const host: ProcessHost = host_make();
    const starting: Promise<unknown> = host.spawn(IDENTITY, 'chris', 'https://cube.example.org/api/v1/', 'BAD');
    await new Promise((r) => setTimeout(r, 10));
    child.exit(1);
    await expect(starting).rejects.toThrow('exited during boot (code 1)');
    expect(host.boot_follow(IDENTITY, { line: (): void => undefined, done: (): void => undefined })?.report.state).toBe('failed');
  });

  it('gives up on a boot that never answers, and kills the child', async () => {
    const host: ProcessHost = new ProcessHost({ stateDir, chellEntry: '/opt/chell/dist/index.js', spawn, alive: async (): Promise<boolean> => true, bootTimeoutMs: 100, pollMs: 20 });
    await expect(host.spawn(IDENTITY, 'chris', 'https://cube.example.org/api/v1/', 'MINTED')).rejects.toThrow('did not answer');
    expect(child.killed).toBe('SIGTERM');
  });

  it('joins a boot already under way rather than starting a rival', async () => {
    const host: ProcessHost = host_make();
    const first: Promise<unknown> = host.spawn(IDENTITY, 'chris', 'https://cube.example.org/api/v1/', 'MINTED');
    const second: Promise<unknown> = host.spawn(IDENTITY, 'chris', 'https://cube.example.org/api/v1/', 'MINTED');
    berth_plant(host);
    const [one, two] = await Promise.all([first, second]);
    expect(two).toEqual(one);
    expect(spawnCalls.length).toBe(1);
  });

  it('begins a boot without holding anyone, and records how it ended', async () => {
    const host: ProcessHost = host_make();
    host.spawn_begin(IDENTITY, 'chris', 'https://cube.example.org/api/v1/', 'BAD');
    await new Promise((r) => setTimeout(r, 10));
    child.exit(1);
    await new Promise((r) => setTimeout(r, 60));
    expect(host.boot_follow(IDENTITY, { line: (): void => undefined, done: (): void => undefined })?.report).toMatchObject({ state: 'failed', reason: 'the session exited during boot (code 1)' });
  });

  it('evicts a session it started, and says so', async () => {
    const host: ProcessHost = host_make();
    const starting: Promise<unknown> = host.spawn(IDENTITY, 'chris', 'https://cube.example.org/api/v1/', 'MINTED');
    berth_plant(host);
    await starting;
    expect(await host.evict(IDENTITY)).toBe(true);
    expect(child.killed).toBe('SIGTERM');
    expect(await host.evict(IDENTITY)).toBe(false);
  });
});
