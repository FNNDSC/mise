/**
 * @file The lab's own toys: `who`, `uptime`, `say`.
 *
 * Small tools that happen to be fun. `who` names the surfaces on this
 * session, `uptime` how long the process has been up, and `say` hands words
 * to a surface with a voice (the console prints them). The ChRIS lab's
 * `ping` and `chrisfetch` are in `chrislab.ts`.
 *
 * @module
 */
import { backendInstalled_get } from '../../core/backend.js';
import chalk from 'chalk';
import { surface_get, type SurfacePeer } from '../../core/surface.js';
import { text_input } from './stdin.js';
import { CommandEnvelope, envelope_ok, envelope_error } from '@fnndsc/menu';

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
  const user: string = (await backendInstalled_get()?.session.user_get()) ?? '?';
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

/** `say [text]`: a surface with a voice speaks it; the console prints it. */
export async function builtin_say(args: string[]): Promise<CommandEnvelope> {
  const text: string | null = text_input(args);
  if (text === null) return envelope_error('', undefined, 'say: nothing to say (say hello, or fortune | say)\n');
  const said: string = text.replace(/\n$/, '').replace(/\s+/g, ' ').trim();
  return envelope_ok(`${chalk.gray('♪')} ${said}\n`, { kind: 'games.say', data: { text: said } });
}
