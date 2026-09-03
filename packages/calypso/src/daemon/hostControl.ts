/**
 * @file Host control: the daemon's own declared capabilities.
 *
 * Capabilities are declared, never detected. Surfaces declare theirs on
 * attach; this lets the HOST declare too. Off by default. With
 * `--host-control` (bare = every tier) the daemon runs `!cmd` itself, lets
 * `upload`/`download` reach its own disk, and runs pipe segments itself —
 * the AI-harness permission model applied to the session daemon: the
 * operator who starts the daemon decides what it may do on the machine it
 * runs on. The host always wins under the policy, so one `!` means one
 * machine, and every surface is told (attach ack, face, prompt, lamp).
 *
 * A non-loopback bind turns the attach token — a bearer secret in a URL —
 * into a shell on this host for anyone holding it, so that combination
 * refuses unless `--expose-host-control` is typed as well.
 *
 * @module
 */
import { spawn, type ChildProcess } from 'child_process';

/** The tiers the policy can grant. */
export const HOST_CONTROL_TIERS: readonly HostControlTier[] = ['shell', 'files', 'pipes'];
export type HostControlTier = 'shell' | 'files' | 'pipes';

/**
 * The daemon's host-control policy.
 *
 * @property tiers - What the host does itself; empty means off.
 * @property exposed - `--expose-host-control` was typed.
 */
export interface HostControlPolicy {
  tiers: ReadonlySet<HostControlTier>;
  exposed: boolean;
}

/** The raw inputs a launcher collected (a flag value, an env value, the override). */
export interface HostControlInputs {
  /** `--host-control` value: true for bare, a tier list string, undefined when absent. */
  flag?: string | boolean;
  /** `CALYPSO_HOST_CONTROL`: `all`, a tier list, or unset. */
  env?: string;
  /** `--expose-host-control`. */
  exposed?: boolean;
}

/** The policy that grants nothing. */
export const HOST_CONTROL_OFF: HostControlPolicy = { tiers: new Set(), exposed: false };

/**
 * Parses a tier list (`shell,files`, `all`, or empty for all).
 *
 * @param value - The list as typed.
 * @returns The tiers, or an error naming the unknown word.
 */
export function hostControlTiers_parse(value: string | boolean | undefined): { tiers: Set<HostControlTier> } | { error: string } {
  if (value === undefined || value === false) return { tiers: new Set() };
  if (value === true || value.trim() === '' || value.trim() === 'all') return { tiers: new Set(HOST_CONTROL_TIERS) };
  const tiers: Set<HostControlTier> = new Set();
  for (const word of value.split(',').map((part: string): string => part.trim()).filter((part: string): boolean => part !== '')) {
    if (!(HOST_CONTROL_TIERS as readonly string[]).includes(word)) {
      return { error: `unknown host-control tier '${word}' (shell, files, pipes, or all)` };
    }
    tiers.add(word as HostControlTier);
  }
  return { tiers };
}

/**
 * Builds the policy from what a launcher collected: the flag wins over the
 * env twin, the override is only ever typed.
 *
 * @param inputs - Flag, env, override.
 * @returns The policy, or an error to print and refuse on.
 */
export function hostControl_fromInputs(inputs: HostControlInputs): { policy: HostControlPolicy } | { error: string } {
  const source: string | boolean | undefined = inputs.flag !== undefined && inputs.flag !== false ? inputs.flag : inputs.env;
  const parsed = hostControlTiers_parse(source);
  if ('error' in parsed) return parsed;
  return { policy: { tiers: parsed.tiers, exposed: inputs.exposed === true } };
}

/**
 * Parses a raw argv (the standalone calypso binary) and the environment.
 *
 * @param argv - Process arguments.
 * @param env - Process environment.
 * @returns The policy, or an error.
 */
export function hostControl_parseArgv(argv: readonly string[], env: NodeJS.ProcessEnv): { policy: HostControlPolicy } | { error: string } {
  let flag: string | boolean | undefined;
  for (let index: number = 0; index < argv.length; index++) {
    const word: string = argv[index] ?? '';
    if (word === '--host-control') {
      const next: string | undefined = argv[index + 1];
      flag = next !== undefined && !next.startsWith('-') ? next : true;
    } else if (word.startsWith('--host-control=')) {
      flag = word.slice('--host-control='.length);
    }
  }
  return hostControl_fromInputs({ flag, env: env['CALYPSO_HOST_CONTROL'], exposed: argv.includes('--expose-host-control') });
}

/**
 * The launch guard: host control on a non-loopback bind refuses unless the
 * operator typed the override.
 *
 * @param policy - The policy.
 * @param bindHost - The bind address.
 * @returns The refusal line, or null when the launch may proceed.
 */
export function hostControl_guard(policy: HostControlPolicy, bindHost: string): string | null {
  if (policy.tiers.size === 0 || bindHost === '127.0.0.1' || bindHost === 'localhost' || bindHost === '::1') return null;
  if (policy.exposed) return null;
  return `--host-control with CALYPSO_BIND=${bindHost} would hand a shell on this host to anyone holding the attach URL; bind to loopback, or type --expose-host-control if you mean it.`;
}

/**
 * The policy as a readout: `shell files pipes`, or empty when off.
 *
 * @param policy - The policy.
 * @returns The tiers in canonical order.
 */
export function hostControl_describe(policy: HostControlPolicy): string {
  return HOST_CONTROL_TIERS.filter((tier: HostControlTier): boolean => policy.tiers.has(tier)).join(' ');
}

/** The tiers as the attach ack carries them. */
export function hostControl_tiers(policy: HostControlPolicy): string[] {
  return HOST_CONTROL_TIERS.filter((tier: HostControlTier): boolean => policy.tiers.has(tier));
}

/**
 * Runs a shell command on the daemon host: `sh -c`, stdin closed (a daemon
 * has no terminal to offer), stdout and stderr streamed to the caller as
 * they arrive, working directory the daemon's own.
 *
 * @param command - The command without its leading `!`.
 * @param write - Receives output chunks by channel.
 * @returns The exit code (1 when the process died without one).
 */
export function hostShell_run(command: string, write: (channel: 'data' | 'err', chunk: string) => void): Promise<number> {
  return new Promise((resolve: (code: number) => void, reject: (error: Error) => void): void => {
    const child: ChildProcess = spawn(command, { shell: true, stdio: ['ignore', 'pipe', 'pipe'], cwd: process.cwd() });
    child.stdout?.on('data', (chunk: Buffer): void => write('data', chunk.toString('utf8')));
    child.stderr?.on('data', (chunk: Buffer): void => write('err', chunk.toString('utf8')));
    child.once('error', (error: Error): void => reject(error));
    child.once('close', (code: number | null): void => resolve(code ?? 1));
  });
}

/**
 * Runs one pipeline segment on the daemon host: the input on stdin, the
 * output collected.
 *
 * @param command - The segment's command.
 * @param input - The upstream bytes.
 * @returns The segment's stdout.
 */
export function hostPipe_run(command: string, input: Buffer): Promise<Buffer> {
  return new Promise((resolve: (output: Buffer) => void, reject: (error: Error) => void): void => {
    const child: ChildProcess = spawn(command, { shell: true, stdio: ['pipe', 'pipe', 'inherit'], cwd: process.cwd() });
    const chunks: Buffer[] = [];
    child.stdout?.on('data', (chunk: Buffer): void => { chunks.push(chunk); });
    child.once('error', (error: Error): void => reject(error));
    child.once('close', (): void => resolve(Buffer.concat(chunks)));
    child.stdin?.end(input);
  });
}
