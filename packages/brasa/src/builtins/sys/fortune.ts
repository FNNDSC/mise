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
 * Picks a random fortune from the bundled collection.
 *
 * @param maxLines - Optional upper bound on the fortune's line count, so a
 *   boot banner can favour short cookies. When the bound filters everything
 *   out, the full collection is used rather than returning nothing.
 * @returns The chosen fortune text (no trailing newline).
 */
export function fortune_random(maxLines?: number): string {
  const bounded: readonly string[] =
    maxLines !== undefined
      ? FORTUNES.filter((f: string): boolean => f.split('\n').length <= maxLines)
      : FORTUNES;
  const pool: readonly string[] = bounded.length > 0 ? bounded : FORTUNES;
  return pool[Math.floor(Math.random() * pool.length)];
}

/**
 * Reports a random fortune as a command envelope.
 *
 * @param _args - Unused.
 * @returns An envelope carrying the chosen fortune and a typed model of it.
 */
export async function builtin_fortune(_args: string[]): Promise<CommandEnvelope> {
  const fortune: string = fortune_random();
  return envelope_ok(`${fortune}\n`, {
    kind: 'sys.fortune',
    data: { fortune },
  });
}
