/**
 * @file Chimes: `timer`, `leave` and `stopwatch`.
 *
 * A chime is a word said later. The kernel keeps it on a clock and, when
 * the time comes, publishes it on the ambient channel as an envelope of
 * its own — the same road a refreshed listing takes — so every surface on
 * the session hears it: ARGUS notes it in the console and speaks it, a
 * remote chell prints it. Nothing holds the lane while it waits. A chime
 * lives as long as the process: a session's chimes end with it.
 *
 * @module
 */
import { CommandEnvelope, envelope_ok, envelope_error } from '@fnndsc/cumin';
import chalk from 'chalk';
import { ambient_publish } from '../../core/ambient.js';

/** A chime waiting its turn. */
export interface Chime {
  id: number;
  /** When it sounds, epoch ms. */
  at: number;
  text: string;
  /** What set it. */
  source: 'timer' | 'leave';
}

/** The longest a chime may wait. */
export const CHIME_MAX_MS: number = 24 * 3600 * 1000;

const pending: Map<number, { chime: Chime; handle: NodeJS.Timeout }> = new Map();
let nextId: number = 1;

/** What sounding a chime does; a test hands in its own ear. */
export type ChimeSound = (chime: Chime) => void;

const chime_sound: ChimeSound = (chime: Chime): void => {
  ambient_publish({
    kind: 'envelope',
    envelope: envelope_ok(`${chalk.yellow('🔔')} ${chime.text}\n`, { kind: 'games.chime', data: { id: chime.id, text: chime.text, source: chime.source, at: new Date(chime.at).toISOString() } }),
  });
};

/**
 * Sets a chime.
 *
 * @param delayMs - How long from now.
 * @param text - What it says.
 * @param source - What set it.
 * @param sound - How it sounds (the ambient channel by default).
 * @returns The chime.
 */
export function chime_set(delayMs: number, text: string, source: Chime['source'], sound: ChimeSound = chime_sound): Chime {
  const chime: Chime = { id: nextId++, at: Date.now() + delayMs, text, source };
  const handle: NodeJS.Timeout = setTimeout((): void => {
    pending.delete(chime.id);
    sound(chime);
  }, delayMs);
  // A waiting chime must not hold the process open on its own.
  handle.unref();
  pending.set(chime.id, { chime, handle });
  return chime;
}

/** The chimes still waiting, soonest first. */
export function chimes_list(): Chime[] {
  return [...pending.values()].map((p): Chime => p.chime).sort((a: Chime, b: Chime): number => a.at - b.at);
}

/**
 * Cancels one chime, or every chime of a source, or all of them.
 *
 * @returns How many were cancelled.
 */
export function chimes_cancel(which: number | Chime['source'] | 'all'): number {
  let count: number = 0;
  for (const [id, entry] of pending) {
    if (which === 'all' || which === id || which === entry.chime.source) {
      clearTimeout(entry.handle);
      pending.delete(id);
      count++;
    }
  }
  return count;
}

/**
 * Reads a duration: `90s`, `5m`, `1h30m`, `2:30` (m:ss), `1:00:00`, or a bare number of minutes.
 *
 * @returns Milliseconds, or null when the words are not a duration.
 */
export function duration_parse(text: string): number | null {
  const t: string = text.trim().toLowerCase();
  if (/^\d+$/.test(t)) return Number(t) * 60_000;
  const clock: RegExpMatchArray | null = /^(\d+):(\d{1,2})(?::(\d{1,2}))?$/.exec(t);
  if (clock !== null) {
    const parts: number[] = [clock[1], clock[2], clock[3]].filter((p): p is string => p !== undefined).map(Number);
    const seconds: number = parts.length === 3 ? (parts[0] as number) * 3600 + (parts[1] as number) * 60 + (parts[2] as number) : (parts[0] as number) * 60 + (parts[1] as number);
    return seconds * 1000;
  }
  const units: RegExpMatchArray | null = /^(?:(\d+(?:\.\d+)?)h)?(?:(\d+(?:\.\d+)?)m)?(?:(\d+(?:\.\d+)?)s)?$/.exec(t);
  if (units === null || units[0] === '') return null;
  const [, h, m, s] = units;
  return Math.round(((Number(h ?? 0)) * 3600 + Number(m ?? 0) * 60 + Number(s ?? 0)) * 1000);
}

/** A span in words: `1h 05m`, `4m 30s`, `12s`. */
export function span_words(ms: number): string {
  const total: number = Math.max(0, Math.round(ms / 1000));
  const h: number = Math.floor(total / 3600); const m: number = Math.floor((total % 3600) / 60); const s: number = total % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  if (m > 0) return `${m}m ${String(s).padStart(2, '0')}s`;
  return `${s}s`;
}

function chimes_render(): string {
  const list: Chime[] = chimes_list();
  if (list.length === 0) return `${chalk.gray('no chimes waiting')}\n`;
  return list.map((c: Chime): string => `${String(c.id).padStart(3)}  ${c.source.padEnd(5)}  in ${span_words(c.at - Date.now()).padEnd(8)}  ${c.text}`).join('\n') + '\n';
}

/** `timer <duration> [words] | timer | timer cancel [id|all]` */
export async function builtin_timer(args: string[]): Promise<CommandEnvelope> {
  if (args.length === 0) return envelope_ok(chimes_render(), { kind: 'games.chimes', data: { chimes: chimes_list() } });
  if (args[0] === 'cancel') {
    const which: number | 'timer' | 'all' = args[1] === undefined ? 'timer' : args[1] === 'all' ? 'all' : Number(args[1]);
    if (typeof which === 'number' && !Number.isInteger(which)) return envelope_error('', undefined, 'timer: cancel wants a chime id, or all\n');
    const n: number = chimes_cancel(which);
    return envelope_ok(`${n} chime${n === 1 ? '' : 's'} cancelled\n`, { kind: 'games.chimes', data: { cancelled: n } });
  }
  const ms: number | null = duration_parse(args[0] as string);
  if (ms === null || ms <= 0) return envelope_error('', undefined, `timer: '${args[0]}' is not a duration (try 90s, 5m, 1h30m, 2:30)\n`);
  if (ms > CHIME_MAX_MS) return envelope_error('', undefined, 'timer: a day is the most a timer waits\n');
  const words: string = args.slice(1).join(' ') || `timer: ${span_words(ms)} is up`;
  const chime: Chime = chime_set(ms, words, 'timer');
  return envelope_ok(`timer ${chime.id} set: ${span_words(ms)} from now (${new Date(chime.at).toTimeString().slice(0, 8)}) — ${words}\n`, { kind: 'games.chimes', data: { set: chime } });
}

/** Reads `+hhmm` (from now) or `hhmm` (a clock time, today or tomorrow) as a delay. */
export function leave_delay(text: string, now: Date = new Date()): number | null {
  const m: RegExpMatchArray | null = /^(\+)?(\d{1,2}):?(\d{2})$/.exec(text.trim());
  if (m === null) return null;
  const hours: number = Number(m[2]); const minutes: number = Number(m[3]);
  if (minutes > 59 || hours > 23 && m[1] === undefined) return null;
  if (m[1] === '+') return (hours * 60 + minutes) * 60_000;
  const at: Date = new Date(now); at.setHours(hours, minutes, 0, 0);
  if (at.getTime() <= now.getTime()) at.setDate(at.getDate() + 1);
  return at.getTime() - now.getTime();
}

/** `leave [+hhmm | hhmm] | leave cancel` — BSD's leave: a word five minutes before, one at the time, and one after. */
export async function builtin_leave(args: string[]): Promise<CommandEnvelope> {
  if (args.length === 0) {
    const mine: Chime[] = chimes_list().filter((c: Chime): boolean => c.source === 'leave');
    if (mine.length === 0) return envelope_ok(`${chalk.gray('no leave set (leave +0030, or leave 1730)')}\n`, { kind: 'games.chimes', data: { chimes: [] } });
    const last: Chime = mine[mine.length - 1] as Chime;
    return envelope_ok(`leaving at ${new Date(last.at - 60_000).toTimeString().slice(0, 5)} — in ${span_words(last.at - 60_000 - Date.now())}\n`, { kind: 'games.chimes', data: { chimes: mine } });
  }
  if (args[0] === 'cancel') {
    const n: number = chimes_cancel('leave');
    return envelope_ok(`${n === 0 ? 'no leave was set' : 'leave cancelled'}\n`, { kind: 'games.chimes', data: { cancelled: n } });
  }
  const delay: number | null = leave_delay(args[0] as string);
  if (delay === null) return envelope_error('', undefined, `leave: '${args[0]}' is not a time (leave +hhmm from now, or leave hhmm)\n`);
  chimes_cancel('leave');
  const at: Date = new Date(Date.now() + delay);
  if (delay > 5 * 60_000) chime_set(delay - 5 * 60_000, 'You have to leave in 5 minutes.', 'leave');
  if (delay > 60_000) chime_set(delay - 60_000, 'Just one more minute!', 'leave');
  chime_set(delay, 'Time to leave!', 'leave');
  chime_set(delay + 60_000, "You're going to be late!", 'leave');
  return envelope_ok(`Alarm set for ${at.toTimeString().slice(0, 5)} (in ${span_words(delay)}).\n`, { kind: 'games.chimes', data: { at: at.toISOString() } });
}

/* ----------------------------------------------------------- stopwatch */

interface Stopwatch { startedAt: number | null; accumulated: number; laps: number[] }
const watch: Stopwatch = { startedAt: null, accumulated: 0, laps: [] };

/** The stopwatch's elapsed time now. */
export function stopwatch_elapsed(now: number = Date.now()): number {
  return watch.accumulated + (watch.startedAt === null ? 0 : now - watch.startedAt);
}

/** Resets the stopwatch (a test's seam, and `stopwatch reset`). */
export function stopwatch_reset(): void {
  watch.startedAt = null; watch.accumulated = 0; watch.laps = [];
}

const clock_words = (ms: number): string => {
  const total: number = Math.floor(ms / 1000);
  const h: number = Math.floor(total / 3600); const m: number = Math.floor((total % 3600) / 60); const s: number = total % 60;
  const tenths: number = Math.floor((ms % 1000) / 100);
  return `${h > 0 ? `${h}:` : ''}${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${tenths}`;
};

/** `stopwatch [start|stop|lap|reset]` — bare, it shows the time. */
export async function builtin_stopwatch(args: string[]): Promise<CommandEnvelope> {
  const verb: string = args[0] ?? 'show';
  const now: number = Date.now();
  const running: boolean = watch.startedAt !== null;
  if (verb === 'start') {
    if (running) return envelope_ok(`already running: ${clock_words(stopwatch_elapsed(now))}\n`, { kind: 'games.stopwatch', data: { elapsedMs: stopwatch_elapsed(now), running } });
    watch.startedAt = now;
    return envelope_ok(`stopwatch started${watch.accumulated > 0 ? ` (resuming at ${clock_words(watch.accumulated)})` : ''}\n`, { kind: 'games.stopwatch', data: { elapsedMs: watch.accumulated, running: true } });
  }
  if (verb === 'stop') {
    if (!running) return envelope_ok(`stopped at ${clock_words(watch.accumulated)}\n`, { kind: 'games.stopwatch', data: { elapsedMs: watch.accumulated, running: false } });
    watch.accumulated += now - (watch.startedAt as number);
    watch.startedAt = null;
    return envelope_ok(`stopped at ${clock_words(watch.accumulated)}\n`, { kind: 'games.stopwatch', data: { elapsedMs: watch.accumulated, running: false } });
  }
  if (verb === 'lap') {
    if (!running) return envelope_error('', undefined, 'stopwatch: not running (stopwatch start)\n');
    const elapsed: number = stopwatch_elapsed(now);
    watch.laps.push(elapsed);
    const previous: number = watch.laps.length > 1 ? (watch.laps[watch.laps.length - 2] as number) : 0;
    return envelope_ok(`lap ${watch.laps.length}: ${clock_words(elapsed - previous)}  (${clock_words(elapsed)} total)\n`, { kind: 'games.stopwatch', data: { elapsedMs: elapsed, laps: watch.laps, running } });
  }
  if (verb === 'reset') {
    stopwatch_reset();
    return envelope_ok('stopwatch reset\n', { kind: 'games.stopwatch', data: { elapsedMs: 0, running: false } });
  }
  if (verb !== 'show') return envelope_error('', undefined, `stopwatch: unknown word '${verb}' (start, stop, lap, reset)\n`);
  const elapsed: number = stopwatch_elapsed(now);
  const laps: string = watch.laps.map((l: number, i: number): string => `  lap ${i + 1}  ${clock_words(l - (watch.laps[i - 1] ?? 0))}`).join('\n');
  return envelope_ok(`${clock_words(elapsed)}${running ? ' (running)' : watch.accumulated > 0 ? ' (stopped)' : ''}\n${laps ? `${laps}\n` : ''}`, { kind: 'games.stopwatch', data: { elapsedMs: elapsed, laps: watch.laps, running } });
}
