/**
 * @file `trek`: the 1976 Berkeley space war game (BSD trek(6)), played by
 * question in the console or a terminal.
 *
 * The game is the `bsd-trek` package; this module wires it to the session:
 * lines to the data channel, each pending partial line as the question asked,
 * sleeps as real pauses, and one saved-game slot that lasts as long as the
 * session. Scans wear glyphs and colours unless `--classic` asks for the
 * original look or the output has no colour.
 *
 * @module
 */
import chalk from 'chalk';
import { CommandEnvelope, envelope_error, envelope_ok } from '@fnndsc/menu';
import { trek_play, trekArgs_parse, type TrekDump, type TrekTerminal } from 'bsd-trek';
import { repl_question } from '../../core/question.js';
import { sink_get } from '../../core/sink.js';

/** The session's saved game: `dump` writes it, a `restart` length reads it back. */
const TREK_DUMP: TrekDump = { saved: null };

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

/**
 * `trek [--classic] [-f | -s] [--seed N]`.
 *
 * @param args - The words after the command.
 * @returns The game's end.
 */
export async function builtin_trek(args: string[]): Promise<CommandEnvelope> {
  const asked = trekArgs_parse(args);
  if ('refusal' in asked) return envelope_error('', undefined, `${asked.refusal}\n`);
  try {
    const code: number = await trek_play(SESSION_TERMINAL, { seed: asked.seed, fast: asked.fast, trace: 0, styled: !asked.classic && chalk.level > 0 }, TREK_DUMP);
    return envelope_ok('', { kind: 'games.trek', data: { seed: asked.seed, exit: code } });
  } catch (error: unknown) {
    return envelope_error('', undefined, `trek: cannot ask here (${error instanceof Error ? error.message : String(error)})\n`);
  }
}
