/**
 * @file Playing trek on a terminal: the game, wired to whatever asks and
 * shows. The game is a line-for-line port of BSD trek(6) (see main.ts and
 * its neighbours) that prints through a TrekIO; this module puts a terminal
 * under it and, when asked, styles the scans with glyphs and colour.
 *
 * @module
 */
import type { Trek, TrekDump } from './context.js';
import { TrekIO, type TrekTerminal } from './io.js';
import { main, type TrekOptions } from './main.js';
import { TrekRandom } from './rand.js';
import { state_create } from './state.js';
import { trekLine_style } from './style.js';

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
 * @param dump - The saved game slot (a fresh one when not given).
 * @returns The exit status.
 */
export async function trek_play(terminal: TrekTerminal, play: TrekPlay, dump: TrekDump = { saved: null }): Promise<number> {
  const shown: TrekTerminal = play.styled ? terminal_style(terminal) : terminal;
  const t: Trek = { s: state_create(), io: new TrekIO(shown), rnd: new TrekRandom(play.seed), dump };
  return main(t, { fast: play.fast, trace: play.trace });
}

/**
 * A terminal whose complete lines are styled before they are written.
 *
 * @param terminal - The terminal underneath.
 * @returns The styling terminal.
 */
function terminal_style(terminal: TrekTerminal): TrekTerminal {
  /**
   * Styles each line of a piece of text.
   *
   * @param text - What the game wrote: complete lines joined by newlines.
   * @returns The text with every line styled.
   */
  const lines_style: (text: string) => string = (text: string): string => text.split('\n').map(trekLine_style).join('\n');
  return {
    text_write: (text: string): void => terminal.text_write(lines_style(text)),
    question_ask: (prompt: string): Promise<string | null> => terminal.question_ask(prompt),
    seconds_sleep: (seconds: number): Promise<void> => terminal.seconds_sleep(seconds),
  };
}

/** The flags trek takes, as its usage line. */
export const TREK_USAGE: string = 'usage: trek [--classic] [-f | -s] [--seed N]';

/** What trek's flags ask. */
export interface TrekArgs {
  /** The original look: no glyphs, no colour. */
  classic: boolean;
  /** How fast the game is told: 0 slow (-s), 1 as the original, more for each -f. */
  fast: number;
  /** The random seed; a fixed one replays the same galaxy. */
  seed: number;
}

/** Why trek's flags were refused. */
export interface TrekRefusal {
  /** The words to show: the bad flag and the usage line. */
  refusal: string;
}

/**
 * Reads trek's flags: `--classic`, `-f` (faster, repeatable), `-s` (slow)
 * and `--seed N`. An unknown flag or a stray word is refused by name.
 *
 * @param args - The words after the command.
 * @param now - The seed when none is given (seconds since the epoch).
 * @returns What they ask, or why not.
 */
export function trekArgs_parse(args: ReadonlyArray<string>, now: number = Math.floor(Date.now() / 1000)): TrekArgs | TrekRefusal {
  const asked: TrekArgs = { classic: false, fast: 1, seed: now };
  for (let at: number = 0; at < args.length; at++) {
    const word: string = args[at] as string;
    if (word === '--classic') asked.classic = true;
    else if (word === '-f') asked.fast++;
    else if (word === '-s') asked.fast = 0;
    else if (word === '--seed' && at + 1 < args.length && /^-?\d+$/.test(args[at + 1] as string)) asked.seed = Number(args[++at]);
    else return { refusal: word.startsWith('-') ? `trek: unknown option '${word}'\ntrek: ${TREK_USAGE}` : `trek: ${TREK_USAGE}` };
  }
  return asked;
}
