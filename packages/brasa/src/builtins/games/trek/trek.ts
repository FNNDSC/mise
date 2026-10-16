/**
 * @file `trek`: the 1976 Berkeley space war game (BSD trek(6)), played by
 * question in the console or a terminal.
 *
 * The game is a line-for-line port (see main.ts and its neighbours) that
 * prints through a TrekIO; this module wires that to the session: lines to
 * the data channel, each pending partial line as the question asked, sleeps
 * as real pauses. Scans wear glyphs and colours unless `--classic` asks for
 * the original look or the output has no colour.
 *
 * @module
 */
import chalk from 'chalk';
import { CommandEnvelope, envelope_error, envelope_ok } from '@fnndsc/menu';
import { repl_question } from '../../../core/question.js';
import { sink_get } from '../../../core/sink.js';
import type { Trek, TrekDump } from './context.js';
import { TrekIO, type TrekTerminal } from './io.js';
import { trek_main, type TrekOptions } from './main.js';
import { TrekRandom } from './rand.js';
import { state_new } from './state.js';
import { trekLine_style } from './style.js';

/** The session's saved game: `dump` writes it, a `restart` length reads it back. */
const TREK_DUMP: TrekDump = { saved: null };

/** How a game is played: the game's own options, the look, and where it runs. */
export interface TrekPlay extends TrekOptions {
  /** The random seed. */
  seed: number;
  /** True to style the scans. */
  styled: boolean;
}

/**
 * Plays a game of trek on a terminal.
 *
 * @param terminal - Where it is played.
 * @param play - How.
 * @param dump - The saved game slot.
 * @returns The exit status.
 */
export async function trek_play(terminal: TrekTerminal, play: TrekPlay, dump: TrekDump = TREK_DUMP): Promise<number> {
  const shown: TrekTerminal = play.styled ? terminal_styled(terminal) : terminal;
  const t: Trek = { s: state_new(), io: new TrekIO(shown), rnd: new TrekRandom(play.seed), dump };
  return trek_main(t, { fast: play.fast, trace: play.trace });
}

/**
 * A terminal whose complete lines are styled before they are written.
 *
 * @param terminal - The terminal underneath.
 * @returns The styling terminal.
 */
function terminal_styled(terminal: TrekTerminal): TrekTerminal {
  const lines_style = (text: string): string => text.split('\n').map(trekLine_style).join('\n');
  return {
    write: (text: string): void => terminal.write(lines_style(text)),
    ask: (prompt: string): Promise<string | null> => terminal.ask(prompt),
    sleep: (seconds: number): Promise<void> => terminal.sleep(seconds),
  };
}

/** The session's terminal: the data channel, the question, a real pause. */
const SESSION_TERMINAL: TrekTerminal = {
  write: (text: string): void => sink_get().data_write(text),
  ask: async (prompt: string): Promise<string | null> => {
    // What is printed before the last newline is output; the rest is the question.
    const cut: number = prompt.lastIndexOf('\n');
    if (cut >= 0) sink_get().data_write(prompt.slice(0, cut + 1));
    return repl_question(prompt.slice(cut + 1));
  },
  sleep: (seconds: number): Promise<void> => new Promise((resolve: () => void): void => { setTimeout(resolve, seconds * 1000); }),
};

/** The flags trek takes. */
const USAGE: string = 'trek: usage: trek [--classic] [-f | -s] [--seed N]\n';

/**
 * `trek [--classic] [-f | -s] [--seed N]`.
 *
 * @param args - The words after the command.
 * @returns The game's end.
 */
export async function builtin_trek(args: string[]): Promise<CommandEnvelope> {
  let classic: boolean = false;
  let fast: number = 1;
  let seed: number = Math.floor(Date.now() / 1000);
  for (let at: number = 0; at < args.length; at++) {
    const word: string = args[at] as string;
    if (word === '--classic') classic = true;
    else if (word === '-f') fast++;
    else if (word === '-s') fast = 0;
    else if (word === '--seed' && at + 1 < args.length && /^-?\d+$/.test(args[at + 1] as string)) seed = Number(args[++at]);
    else return envelope_error('', undefined, word.startsWith('-') ? `trek: unknown option '${word}'\n${USAGE}` : USAGE);
  }
  try {
    const code: number = await trek_play(SESSION_TERMINAL, { seed, fast, trace: 0, styled: !classic && chalk.level > 0 });
    return envelope_ok('', { kind: 'games.trek', data: { seed, exit: code } });
  } catch (error: unknown) {
    return envelope_error('', undefined, `trek: cannot ask here (${error instanceof Error ? error.message : String(error)})\n`);
  }
}
