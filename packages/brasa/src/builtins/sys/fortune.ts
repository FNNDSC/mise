/**
 * @file Builtin fortune.
 *
 * Prints a random fortune cookie — the classic `fortune` command, reimagined as
 * a self-contained builtin. Its content is bundled (see {@link FORTUNES}), so it
 * needs no host `fortune` binary and no datfiles on disk, and behaves the same
 * in a local shell, over a CALYPSO daemon, and in the standalone binary.
 *
 * @module
 */
import { CommandEnvelope, envelope_ok } from '@fnndsc/cumin';
import { FORTUNES } from './fortunes.data.js';

/**
 * Reports a random fortune as a command envelope.
 *
 * @param _args - Unused.
 * @returns An envelope carrying the chosen fortune and a typed model of it.
 */
export async function builtin_fortune(_args: string[]): Promise<CommandEnvelope> {
  const fortune: string = FORTUNES[Math.floor(Math.random() * FORTUNES.length)];
  return envelope_ok(`${fortune}\n`, {
    kind: 'sys.fortune',
    data: { fortune },
  });
}
