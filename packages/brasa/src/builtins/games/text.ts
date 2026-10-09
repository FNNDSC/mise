/**
 * @file Text toys from the shelf: `rev`, `tac`, `yes`, `seq`, `shuf`, `rot13`.
 *
 * Each reads what was piped in, else its arguments, and answers in kind:
 * `fortune | rev`, `rot13 hello`, `seq 1 2 9`. `yes` is bounded — a shell
 * that never ends is not a toy — and says how many it printed.
 *
 * @module
 */
import chalk from 'chalk';
import { text_input } from './stdin.js';
import { CommandEnvelope, envelope_ok, envelope_error } from '@fnndsc/menu';

/** Lines `yes` prints when not told how many. */
export const YES_DEFAULT: number = 10;
/** The most lines `yes` prints however it is asked. */
export const YES_MAX: number = 10_000;
/** The most numbers `seq` prints. */
export const SEQ_MAX: number = 100_000;

/** Reverses each line's characters, keeping the lines. */
export function text_rev(text: string): string {
  return text.split('\n').map((line: string): string => [...line].reverse().join('')).join('\n');
}

/** Reverses the order of the lines. */
export function text_tac(text: string): string {
  const trailing: boolean = text.endsWith('\n');
  const lines: string[] = (trailing ? text.slice(0, -1) : text).split('\n');
  return lines.reverse().join('\n') + (trailing ? '\n' : '');
}

/** The ROT13 of a text; letters only, case kept. */
export function text_rot13(text: string): string {
  return text.replace(/[a-zA-Z]/g, (c: string): string => {
    const base: number = c <= 'Z' ? 65 : 97;
    return String.fromCharCode(((c.charCodeAt(0) - base + 13) % 26) + base);
  });
}

/**
 * The numbers `seq` prints: `seq LAST`, `seq FIRST LAST`, `seq FIRST STEP LAST`.
 *
 * @returns The numbers, or a refusal.
 */
export function seq_numbers(args: ReadonlyArray<string>): { numbers: number[] } | { refusal: string } {
  const nums: number[] = args.map(Number);
  if (nums.length === 0 || nums.length > 3 || nums.some((n: number): boolean => !Number.isFinite(n))) {
    return { refusal: 'seq: usage: seq [FIRST [STEP]] LAST' };
  }
  const [first, step, last]: [number, number, number] = nums.length === 1 ? [1, 1, nums[0] as number]
    : nums.length === 2 ? [nums[0] as number, 1, nums[1] as number]
    : [nums[0] as number, nums[1] as number, nums[2] as number];
  if (step === 0) return { refusal: 'seq: STEP must not be zero' };
  const numbers: number[] = [];
  for (let n: number = first; step > 0 ? n <= last : n >= last; n += step) {
    numbers.push(Number(n.toFixed(10)));
    if (numbers.length >= SEQ_MAX) break;
  }
  return { numbers };
}

/** Shuffles lines (Fisher–Yates), with an optional source of chance for tests. */
export function lines_shuffle(lines: string[], random: () => number = Math.random): string[] {
  const out: string[] = [...lines];
  for (let i: number = out.length - 1; i > 0; i--) {
    const j: number = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j] as string, out[i] as string];
  }
  return out;
}

/** `rev [text]` */
export async function builtin_rev(args: string[]): Promise<CommandEnvelope> {
  const text: string | null = text_input(args);
  if (text === null) return envelope_error('', undefined, 'rev: nothing to reverse (pipe text in, or give it)\n');
  const out: string = text_rev(text.replace(/\n$/, ''));
  return envelope_ok(`${out}\n`, { kind: 'games.rev', data: { text: out } });
}

/** `tac [text]` */
export async function builtin_tac(args: string[]): Promise<CommandEnvelope> {
  const text: string | null = text_input(args);
  if (text === null) return envelope_error('', undefined, 'tac: nothing to turn over (pipe lines in)\n');
  const out: string = text_tac(text.endsWith('\n') ? text : `${text}\n`);
  return envelope_ok(out, { kind: 'games.tac', data: { text: out } });
}

/** `yes [word] [-n N]` */
export async function builtin_yes(args: string[]): Promise<CommandEnvelope> {
  let count: number = YES_DEFAULT;
  const words: string[] = [];
  for (let i: number = 0; i < args.length; i++) {
    if (args[i] === '-n') {
      const n: number = Number(args[i + 1]);
      if (!Number.isInteger(n) || n < 1) return envelope_error('', undefined, 'yes: -n wants a positive whole number\n');
      count = Math.min(n, YES_MAX);
      i++;
    } else {
      words.push(args[i] as string);
    }
  }
  const word: string = words.length > 0 ? words.join(' ') : 'y';
  const lines: string = `${word}\n`.repeat(count);
  // Bounded on purpose, and it says so: the real yes runs until killed.
  const note: string = chalk.gray(`yes: ${count} of forever (-n N for more, up to ${YES_MAX})\n`);
  return envelope_ok(lines + note, { kind: 'games.yes', data: { word, count } });
}

/** `seq [FIRST [STEP]] LAST` */
export async function builtin_seq(args: string[]): Promise<CommandEnvelope> {
  const answer = seq_numbers(args);
  if ('refusal' in answer) return envelope_error('', undefined, `${answer.refusal}\n`);
  const note: string = answer.numbers.length >= SEQ_MAX ? chalk.gray(`seq: stopped at ${SEQ_MAX} numbers\n`) : '';
  return envelope_ok(`${answer.numbers.join('\n')}\n${note}`, { kind: 'games.seq', data: { numbers: answer.numbers } });
}

/** `shuf [words...]`: lines piped in, or the words given, in a random order. */
export async function builtin_shuf(args: string[]): Promise<CommandEnvelope> {
  const piped: string | null = text_input([]);
  const lines: string[] = piped !== null
    ? piped.replace(/\n$/, '').split('\n')
    : args;
  if (lines.length === 0) return envelope_error('', undefined, 'shuf: nothing to shuffle (pipe lines in, or give words)\n');
  const out: string[] = lines_shuffle(lines);
  return envelope_ok(`${out.join('\n')}\n`, { kind: 'games.shuf', data: { lines: out } });
}

/** `rot13 [text]` */
export async function builtin_rot13(args: string[]): Promise<CommandEnvelope> {
  const text: string | null = text_input(args);
  if (text === null) return envelope_error('', undefined, 'rot13: nothing to turn (pipe text in, or give it)\n');
  const out: string = text_rot13(text.replace(/\n$/, ''));
  return envelope_ok(`${out}\n`, { kind: 'games.rot13', data: { text: out } });
}
