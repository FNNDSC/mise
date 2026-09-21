/**
 * @file Exemplar 14 — a session started by a front that already logged in.
 *
 * The porter — the display manager the browser surface needs — exchanges
 * the operator's password for a CUBE token itself and starts that
 * identity's daemon with the token, never the password: `chell --daemon
 * <user>@<url> --auth-token-stdin`, the token on stdin, off a TTY, in
 * directories of its own. This program does exactly that against a live
 * CUBE and proves what the porter will rely on: the Connect row on stdout,
 * a berth that answers, and a daemon that keeps listening with no terminal
 * to end its boot on. Then it proves a refusal: a token the server will not
 * have leaves the daemon unstarted and the saved context unwritten.
 *
 * Nothing is created in CUBE.
 *
 *   node exemplars/ts/dist/14_tokenLogin.js
 *
 * @module
 */

import { ChildProcessWithoutNullStreams, spawn } from 'child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { WebSocket } from 'ws';
import { env_load, check, section, summary_exit, sleep, restToken_get, CubeEnv } from './lib/harness.js';

interface Berth {
  url: string;
  token: string;
}

interface DaemonRun {
  process: ChildProcessWithoutNullStreams;
  output: string[];
}

/** Package root, from `exemplars/ts/dist` at runtime. */
const PACKAGE_ROOT: string = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

/**
 * The four directories a private daemon must own: config (the saved
 * context and token), runtime (the berth), cache (the working directory and
 * the /proc shards), and tmp. Sharing any of them with the operator's own
 * daemon has cost real sessions their working directory.
 */
interface IsolatedDirs {
  config: string;
  runtime: string;
  cache: string;
  tmp: string;
}

function dirs_make(): IsolatedDirs {
  return {
    config: mkdtempSync(path.join(tmpdir(), 'chell-token-config-')),
    runtime: mkdtempSync(path.join(tmpdir(), 'chell-token-runtime-')),
    cache: mkdtempSync(path.join(tmpdir(), 'chell-token-cache-')),
    tmp: mkdtempSync(path.join(tmpdir(), 'chell-token-tmp-')),
  };
}

function dirs_remove(dirs: IsolatedDirs): void {
  for (const dir of Object.values(dirs)) rmSync(dir, { recursive: true, force: true });
}

/**
 * Starts a daemon off a TTY with the token on stdin.
 *
 * @param env - Live CUBE configuration.
 * @param dirs - The daemon's own directories.
 * @param token - The CUBE token to hand over.
 */
function daemon_start(env: CubeEnv, dirs: IsolatedDirs, token: string): DaemonRun {
  const args: string[] = [
    'dist/index.js', `${env.user}@${env.url}`, '--daemon', '--auth-token-stdin',
    '--no-logo', '--no-prefetch-feeds', '--no-prefetch-plugins', '--no-prefetch-jobs',
  ];
  const child: ChildProcessWithoutNullStreams = spawn(process.execPath, args, {
    cwd: PACKAGE_ROOT,
    env: {
      ...process.env,
      XDG_CONFIG_HOME: dirs.config,
      XDG_RUNTIME_DIR: dirs.runtime,
      XDG_CACHE_HOME: dirs.cache,
      TMPDIR: dirs.tmp,
      FORCE_COLOR: '0',
    },
  });
  const output: string[] = [];
  child.stdout.on('data', (chunk: Buffer) => output.push(chunk.toString('utf-8')));
  child.stderr.on('data', (chunk: Buffer) => output.push(chunk.toString('utf-8')));
  // The token, one line, and then the pipe closes: a porter holds nothing
  // open it does not need, and the daemon must not need it.
  child.stdin.end(`${token}\n`);
  return { process: child, output };
}

/** Reads the one berth the isolated runtime directory can hold. */
function berth_read(dirs: IsolatedDirs): Berth | null {
  const berthDir: string = path.join(dirs.runtime, 'calypso');
  if (!existsSync(berthDir)) return null;
  for (const name of readdirSync(berthDir)) {
    if (!name.startsWith('berth-') || !name.endsWith('.json')) continue;
    try {
      const parsed: Partial<Berth> = JSON.parse(readFileSync(path.join(berthDir, name), 'utf-8')) as Partial<Berth>;
      if (typeof parsed.url === 'string' && typeof parsed.token === 'string') return { url: parsed.url, token: parsed.token };
    } catch {
      continue;
    }
  }
  return null;
}

/** Waits for a berth, or for the daemon to give up. */
async function berth_await(run: DaemonRun, dirs: IsolatedDirs, timeoutMs: number): Promise<Berth | null> {
  const deadline: number = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (run.process.exitCode !== null) return null;
    const berth: Berth | null = berth_read(dirs);
    if (berth) return berth;
    await sleep(250);
  }
  return berth_read(dirs);
}

/** Waits for the daemon to exit, or reports that it did not. */
async function exit_await(run: DaemonRun, timeoutMs: number): Promise<number | null> {
  const deadline: number = Date.now() + timeoutMs;
  while (Date.now() < deadline && run.process.exitCode === null) await sleep(100);
  return run.process.exitCode;
}

/** Opens the wire and closes it: a berth that answers is a daemon that listens. */
function berth_answers(berth: Berth): Promise<boolean> {
  return new Promise<boolean>((resolve: (answers: boolean) => void): void => {
    const ws: WebSocket = new WebSocket(berth.url);
    const timer: NodeJS.Timeout = setTimeout((): void => { ws.terminate(); resolve(false); }, 5_000);
    ws.once('open', (): void => { clearTimeout(timer); ws.close(); resolve(true); });
    ws.once('error', (): void => { clearTimeout(timer); resolve(false); });
  });
}

async function daemon_stop(run: DaemonRun): Promise<void> {
  if (run.process.exitCode !== null) return;
  run.process.kill('SIGTERM');
  if ((await exit_await(run, 5_000)) === null) run.process.kill('SIGKILL');
}

/** Whether a saved token was written anywhere under the config directory. */
function savedToken_exists(dirs: IsolatedDirs): boolean {
  const walk = (dir: string): boolean => {
    if (!existsSync(dir)) return false;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full: string = path.join(dir, entry.name);
      if (entry.isDirectory() && walk(full)) return true;
      if (entry.isFile() && entry.name.endsWith('_token.txt')) return true;
    }
    return false;
  };
  return walk(dirs.config);
}

async function main(): Promise<void> {
  const env: CubeEnv = env_load();

  section('Token minted at the door');
  const token: string = await restToken_get(env.url, env.user, env.password);
  check('CUBE issued a token for the operator', token.length > 0);

  section('A daemon started with the token, off a TTY');
  const dirs: IsolatedDirs = dirs_make();
  const run: DaemonRun = daemon_start(env, dirs, token);
  try {
    const berth: Berth | null = await berth_await(run, dirs, 60_000);
    const transcript: string = run.output.join('');
    check('the daemon published a berth', berth !== null);
    check('the boot wrote the Connect row for a token login', /Connect\s+Connected to .* \(token\)/.test(transcript));
    check('the daemon said it keeps listening with no terminal', transcript.includes('No terminal here; the daemon keeps listening'));
    check('the daemon is still up after its boot', run.process.exitCode === null);
    check('the token was saved for the identity', savedToken_exists(dirs));
    if (berth) check('the berth answers on the wire', await berth_answers(berth));
    check('no password appears in the daemon transcript', !transcript.includes(env.password));
  } finally {
    await daemon_stop(run);
    dirs_remove(dirs);
  }

  section('A token the server will not have');
  const refusedDirs: IsolatedDirs = dirs_make();
  const refused: DaemonRun = daemon_start(env, refusedDirs, 'not-a-token');
  try {
    const exitCode: number | null = await exit_await(refused, 60_000);
    const transcript: string = refused.output.join('');
    check('the daemon exited instead of hosting an offline session', exitCode !== null && exitCode !== 0);
    check('the refusal names the identity', transcript.includes(`refused the token for ${env.user}`));
    check('no berth was published', berth_read(refusedDirs) === null);
    check('no token was saved', !savedToken_exists(refusedDirs));
  } finally {
    await daemon_stop(refused);
    dirs_remove(refusedDirs);
  }

  summary_exit();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
