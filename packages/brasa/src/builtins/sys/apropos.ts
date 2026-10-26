/**
 * @file apropos and man: find a command by a word, and read its page, in the
 * words every Unix hand already knows (builtins/helpSections.ts).
 *
 * @module
 */
import { CommandEnvelope, envelope_ok, envelope_error } from '@fnndsc/menu';
import { apropos_search } from '../helpSections.js';
import { builtin_help, helpLookup_make } from '../help.js';
import { exitCode_set } from '../../core/handlerRun.js';

/**
 * `apropos <word>`: every command, section and Shell topic whose name,
 * summary or description holds the word.
 *
 * @param args - The word (several words are one phrase).
 * @returns The matches, or nothing appropriate (exit 1, as apropos does).
 */
export async function builtin_apropos(args: string[]): Promise<CommandEnvelope> {
  const word: string = args.join(' ').trim();
  if (word === '') return envelope_error('', undefined, 'apropos: a word to look for: apropos <word>\n');
  const hits: string[] = apropos_search(word, helpLookup_make());
  if (hits.length === 0) {
    exitCode_set(1);
    return envelope_ok(`${word}: nothing appropriate.\n`);
  }
  return envelope_ok(`${hits.join('\n')}\n`);
}

/**
 * `man <command|Section|topic>` is `help` for it; `man -k <word>` is apropos.
 *
 * @param args - The words after `man`.
 * @returns The page, or the matches.
 */
export async function builtin_man(args: string[]): Promise<CommandEnvelope> {
  if (args[0] === '-k') return builtin_apropos(args.slice(1));
  if (args.length === 0) return envelope_error('', undefined, 'man: what manual page do you want? man <command>, man <Section>, man -k <word>\n');
  return builtin_help(args);
}
