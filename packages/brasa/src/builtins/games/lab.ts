/**
 * @file The lab's own toys: `who`, `uptime`, `ping`, `chrisfetch`, `say`.
 *
 * Small tools that happen to be fun. `who` names the surfaces on this
 * session, `uptime` how long the process has been up, `ping` the round
 * trip to CUBE, `chrisfetch` the brain beside the session's facts, and
 * `say` hands words to a surface with a voice (the console prints them).
 *
 * @module
 */
import { chrisContext, requestLedger_snapshot, type LedgerSnapshot } from '@fnndsc/cumin';
import chalk from 'chalk';
import { surface_get, type SurfacePeer } from '../../core/surface.js';
import { motd_gather } from '../sys/motd.js';
import { BRAIN } from './cowsay.js';
import { text_input } from './stdin.js';
import { CommandEnvelope, envelope_ok, envelope_error } from '@fnndsc/menu';

/** Round trips `ping` makes when not told. */
export const PING_COUNT: number = 3;
/** The most round trips `ping` makes however asked. */
export const PING_MAX: number = 20;
/** How long one round trip may take before it is called lost. */
const PING_TIMEOUT_MS: number = 8_000;

/** A span of seconds in words: `2d 3h 04m`, `17m 05s`. */
export function uptime_words(seconds: number): string {
  const s: number = Math.floor(seconds);
  const days: number = Math.floor(s / 86400);
  const hours: number = Math.floor((s % 86400) / 3600);
  const minutes: number = Math.floor((s % 3600) / 60);
  const secs: number = s % 60;
  if (days > 0) return `${days}d ${hours}h ${String(minutes).padStart(2, '0')}m`;
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, '0')}m`;
  return `${minutes}m ${String(secs).padStart(2, '0')}s`;
}

/** `who`: the surfaces attached to this session. */
export async function builtin_who(_args: string[]): Promise<CommandEnvelope> {
  const peers: SurfacePeer[] | null = surface_get().peers?.() ?? null;
  const user: string = (await chrisContext.ChRISuser_get()) ?? '?';
  if (peers === null) {
    return envelope_ok(`${user}  this terminal\n`, { kind: 'games.who', data: { user, peers: [] } });
  }
  const lines: string[] = peers.map((p: SurfacePeer): string =>
    `${user.padEnd(16)} ${p.kind.padEnd(8)} ${p.id}${p.you ? chalk.gray('  (you)') : ''}`);
  return envelope_ok(`${lines.join('\n')}\n`, { kind: 'games.who', data: { user, peers } });
}

/** `uptime`: how long this process has been up, and who is here. */
export async function builtin_uptime(_args: string[]): Promise<CommandEnvelope> {
  const seconds: number = process.uptime();
  const peers: SurfacePeer[] | null = surface_get().peers?.() ?? null;
  const since: Date = new Date(Date.now() - seconds * 1000);
  const now: string = new Date().toTimeString().slice(0, 8);
  const who: string = peers === null ? '' : `, ${peers.length} surface${peers.length === 1 ? '' : 's'}`;
  const line: string = ` ${now}  up ${uptime_words(seconds)}${who}  (since ${since.toISOString().replace('T', ' ').slice(0, 19)}Z, pid ${process.pid})`;
  return envelope_ok(`${line}\n`, { kind: 'games.uptime', data: { seconds, since: since.toISOString(), pid: process.pid, surfaces: peers?.length ?? null } });
}

/** One round trip's outcome. */
export interface PingSample { seq: number; ms: number | null; status: number | null }

/** What `ping` uses to reach CUBE; a test hands in its own. */
export type PingFetch = (url: string, init: { method: string; signal: AbortSignal }) => Promise<{ status: number }>;

/**
 * Round-trips to a URL `count` times.
 *
 * @param url - Where.
 * @param count - How many.
 * @param fetchFn - The fetch to use.
 * @param onSample - Told each sample as it lands, for a surface that streams.
 */
export async function ping_run(url: string, count: number, fetchFn: PingFetch, onSample?: (s: PingSample) => void): Promise<PingSample[]> {
  const samples: PingSample[] = [];
  for (let seq: number = 1; seq <= count; seq++) {
    const started: number = performance.now();
    const controller: AbortController = new AbortController();
    const timer: NodeJS.Timeout = setTimeout((): void => controller.abort(), PING_TIMEOUT_MS);
    let sample: PingSample;
    try {
      const response: { status: number } = await fetchFn(url, { method: 'GET', signal: controller.signal });
      sample = { seq, ms: Math.round((performance.now() - started) * 10) / 10, status: response.status };
    } catch {
      sample = { seq, ms: null, status: null };
    } finally {
      clearTimeout(timer);
    }
    samples.push(sample);
    onSample?.(sample);
  }
  return samples;
}

/** The summary line, as ping prints it. */
export function ping_summary(samples: PingSample[]): string {
  const got: number[] = samples.map((s: PingSample): number | null => s.ms).filter((ms: number | null): ms is number => ms !== null);
  const lost: number = samples.length - got.length;
  const loss: string = samples.length === 0 ? '0' : String(Math.round((lost / samples.length) * 100));
  let out: string = `${samples.length} sent, ${got.length} answered, ${loss}% lost`;
  if (got.length > 0) {
    const min: number = Math.min(...got); const max: number = Math.max(...got);
    const avg: number = got.reduce((a: number, b: number): number => a + b, 0) / got.length;
    out += `\nround-trip min/avg/max = ${min}/${avg.toFixed(1)}/${max} ms`;
  }
  return out;
}

/** `ping [-c N]`: round trips to CUBE. */
export async function builtin_ping(args: string[], fetchFn: PingFetch = (url, init) => fetch(url, init)): Promise<CommandEnvelope> {
  let count: number = PING_COUNT;
  for (let i: number = 0; i < args.length; i++) {
    if (args[i] === '-c') {
      const n: number = Number(args[i + 1]);
      if (!Number.isInteger(n) || n < 1) return envelope_error('', undefined, 'ping: -c wants a positive whole number\n');
      count = Math.min(n, PING_MAX); i++;
    } else if (args[i] !== 'cube') {
      return envelope_error('', undefined, `ping: only CUBE is pinged from here (ping [-c N] [cube]); '${args[i]}' is not that\n`);
    }
  }
  const url: string | null = await chrisContext.ChRISURL_get();
  if (url === null) return envelope_error('', undefined, 'ping: not connected to a CUBE\n');
  const lines: string[] = [`PING cube (${url})`];
  const samples: PingSample[] = await ping_run(url, count, fetchFn, (s: PingSample): void => {
    lines.push(s.ms === null ? `seq=${s.seq} lost (no answer in ${PING_TIMEOUT_MS / 1000}s)` : `seq=${s.seq} http=${s.status} time=${s.ms} ms`);
  });
  const ledger: LedgerSnapshot = requestLedger_snapshot({ last: 0 });
  const recent: string = ledger.total > 0 ? `\nthis session's own calls: ${ledger.total} to CUBE, ${(ledger.ms / ledger.total).toFixed(0)} ms each on average` : '';
  return envelope_ok(`${lines.join('\n')}\n--- cube ping statistics ---\n${ping_summary(samples)}${recent}\n`, { kind: 'games.ping', data: { url, samples } });
}

/** `chrisfetch`: the brain beside the session's facts, neofetch style. */
export async function builtin_chrisfetch(_args: string[]): Promise<CommandEnvelope> {
  const user: string = (await chrisContext.ChRISuser_get()) ?? '?';
  const url: string | null = await chrisContext.ChRISURL_get();
  const host: string = url === null ? '(not connected)' : url.replace(/^https?:\/\//, '').replace(/\/api\/v1\/?$/, '');
  const motd = motd_gather(user, 'chrisfetch');
  const peers: SurfacePeer[] | null = surface_get().peers?.() ?? null;
  const facts: Array<[string, string]> = [
    ['CUBE', host],
    ['Feeds', `${motd.feeds.total} (${motd.feeds.own} own, ${motd.feeds.shared} shared, ${motd.feeds.public} public)`],
    ['Jobs', `${motd.jobs.total.toLocaleString('en-US')} run · ${motd.jobs.running} running · ${motd.jobs.scheduled} scheduled`],
    ['Failed', motd.failureRate === null ? 'none settled yet' : `${(motd.failureRate * 100).toFixed(1)} %`],
    ['Index', motd.index.state === 'current' ? 'whole' : `${motd.index.state} (${motd.index.loaded}/${motd.index.total})`],
    ['Surfaces', peers === null ? 'this terminal' : `${peers.length} attached (${peers.filter((p: SurfacePeer): boolean => p.kind === 'browser').length} browser, ${peers.filter((p: SurfacePeer): boolean => p.kind === 'chell').length} chell)`],
    ['Uptime', uptime_words(process.uptime())],
    ['Node', process.version],
  ];
  const title: string = `${chalk.bold.cyan(user)}@${chalk.bold.cyan(host.split(':')[0] ?? host)}`;
  const right: string[] = [title, chalk.gray('─'.repeat(Math.min(40, user.length + host.length + 1))), ...facts.map(([k, v]: [string, string]): string => `${chalk.cyan(k.padEnd(9))}${v}`)];
  const rows: number = Math.max(BRAIN.length, right.length);
  const lines: string[] = [];
  for (let i: number = 0; i < rows; i++) {
    const left: string = (BRAIN[i] ?? '').padEnd(27);
    lines.push(`${chalk.cyan(left)}  ${right[i] ?? ''}`.trimEnd());
  }
  return envelope_ok(`${lines.join('\n')}\n`, { kind: 'games.chrisfetch', data: { user, cube: url, feeds: motd.feeds, jobs: motd.jobs, failureRate: motd.failureRate, index: motd.index, surfaces: peers, uptimeSeconds: process.uptime() } });
}

/** `say [text]`: a surface with a voice speaks it; the console prints it. */
export async function builtin_say(args: string[]): Promise<CommandEnvelope> {
  const text: string | null = text_input(args);
  if (text === null) return envelope_error('', undefined, 'say: nothing to say (say hello, or fortune | say)\n');
  const said: string = text.replace(/\n$/, '').replace(/\s+/g, ' ').trim();
  return envelope_ok(`${chalk.gray('♪')} ${said}\n`, { kind: 'games.say', data: { text: said } });
}
