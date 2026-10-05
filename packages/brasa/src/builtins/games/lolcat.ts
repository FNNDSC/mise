/**
 * @file `lolcat`: text in a rainbow.
 *
 * Each character takes the next hue along a sine rainbow, the hue drifting
 * down the lines, as the original does. The colour is 24-bit ANSI, which
 * every surface here renders; `-p N` sets the spread (characters per cycle),
 * `-S N` the starting phase.
 *
 * @module
 */
import { CommandEnvelope, envelope_ok, envelope_error } from '@fnndsc/cumin';
import chalk from 'chalk';
import { text_input } from './stdin.js';

/** 24-bit colour whatever the host thinks of its terminal: every surface here renders it. */
const paint: chalk.Chalk = new chalk.Instance({ level: 3 });

/** Characters per rainbow cycle when none is asked. */
export const LOLCAT_SPREAD: number = 24;

/** The colour at a point along the rainbow. */
export function rainbow_rgb(position: number, spread: number): [number, number, number] {
  const t: number = (position / spread) * 2 * Math.PI;
  const channel = (phase: number): number => Math.round(Math.sin(t + phase) * 100 + 155);
  return [channel(0), channel(2 * Math.PI / 3), channel(4 * Math.PI / 3)];
}

/**
 * Paints a text.
 *
 * @param text - The lines.
 * @param spread - Characters per cycle.
 * @param phase - Where the first character starts.
 * @returns The text with a colour per character; plain spaces stay plain.
 */
export function lolcat_paint(text: string, spread: number = LOLCAT_SPREAD, phase: number = 0): string {
  const clean: string = text.replace(/\x1b\[[0-9;]*m/g, '');
  return clean.split('\n').map((line: string, row: number): string =>
    [...line].map((c: string, col: number): string => {
      if (c === ' ') return c;
      const [r, g, b]: [number, number, number] = rainbow_rgb(phase + col + row * 3, spread);
      return paint.rgb(r, g, b)(c);
    }).join(''),
  ).join('\n');
}

/** `lolcat [-p SPREAD] [-S PHASE] [text]` */
export async function builtin_lolcat(args: string[]): Promise<CommandEnvelope> {
  let spread: number = LOLCAT_SPREAD;
  let phase: number = Math.floor(Math.random() * 256);
  const words: string[] = [];
  for (let i: number = 0; i < args.length; i++) {
    const flag: string = args[i] as string;
    if (flag === '-p' || flag === '-S') {
      const n: number = Number(args[i + 1]);
      if (!Number.isFinite(n) || (flag === '-p' && n < 1)) return envelope_error('', undefined, `lolcat: ${flag} wants a number${flag === '-p' ? ' of 1 or more' : ''}\n`);
      if (flag === '-p') spread = n; else phase = n;
      i++;
    } else if (flag.startsWith('-') && flag.length > 1) {
      return envelope_error('', undefined, `lolcat: unknown flag '${flag}' (only -p SPREAD and -S PHASE)\n`);
    } else {
      words.push(flag);
    }
  }
  const text: string | null = text_input(words);
  if (text === null) return envelope_error('', undefined, 'lolcat: nothing to paint (pipe text in: fortune | lolcat)\n');
  const said: string = text.replace(/\n$/, '');
  return envelope_ok(`${lolcat_paint(said, spread, phase)}\n`, { kind: 'games.lolcat', data: { text: said, spread, phase } });
}
