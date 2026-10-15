/**
 * @file command: run the system's program of a name, not chell's builtin of
 * the same name (#1104).
 *
 * POSIX's own `command` skips functions and aliases; chell's skips its
 * builtins. The line goes to the surface's host shell whole, as
 * `command <name> <args>`, so the host runs its real program (and answers
 * `command -v` as it always does), reading whatever was piped in:
 * `query … | command grep -i t1` is plain text grep, no listing logic.
 *
 * @module
 */
import { CommandEnvelope, envelope_ok, envelope_error } from '@fnndsc/menu';
import { stdin_take } from '../games/stdin.js';
import { listingIn_take } from '../../core/listing.js';
import { surface_get } from '../../core/surface.js';

/** A word as a POSIX shell reads it back. */
function word_quote(word: string): string {
  return /^[\w@%+=:,./-]+$/.test(word) ? word : `'${word.replace(/'/g, `'\\''`)}'`;
}

/**
 * `command <name> [args...]`
 *
 * @param args - The program and its words.
 * @returns What the program wrote, or why it could not run.
 */
export async function builtin_command(args: string[]): Promise<CommandEnvelope> {
  // What was piped in is the program's input; a listing has no meaning there.
  listingIn_take();
  const input: string = stdin_take() ?? '';
  if (args.length === 0) return envelope_error('', undefined, 'command: a program to run: command <name> [args...] (the system program, not the builtin)\n');
  const surface = surface_get();
  if (!surface.capabilities.pipeSegments) {
    return envelope_error('', undefined, `command ${args[0]}: this surface cannot run system programs\n`);
  }
  const out: Buffer = await surface.pipeSegment(`command ${args.map(word_quote).join(' ')}`, Buffer.from(input, 'utf-8'));
  return envelope_ok(out.toString('utf-8'));
}
