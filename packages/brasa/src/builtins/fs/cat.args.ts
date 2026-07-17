/**
 * @file Shared `cat` command-line grammar.
 *
 * Defines the typed result used by the builtin, the usage text shown in help
 * and errors, and the option predicate used by redirect filename inference.
 * This module is intentionally dependency-free so preprocessing can consume
 * the grammar without loading the file reader or syntax highlighter.
 *
 * @module
 */

/** Whether syntax highlighting follows TTY detection, is forced, or is disabled. */
export type CatHighlightMode = 'auto' | 'always' | 'never';

/** Parsed `cat` command-line arguments. */
export interface CatArguments {
  binaryMode: boolean;
  highlightMode: CatHighlightMode;
  highlightLanguage?: string;
  filePaths: string[];
}

/** Canonical usage shared by builtin errors and interactive help. */
export const CAT_USAGE: string =
  'cat [--binary] [--highlight[=language] | --no-highlight] <file> [file...]';

const BINARY_OPTION: string = '--binary';
const HIGHLIGHT_OPTION: string = '--highlight';
const HIGHLIGHT_LANGUAGE_PREFIX: string = '--highlight=';
const NO_HIGHLIGHT_OPTION: string = '--no-highlight';

/**
 * Returns whether an argument belongs to the `cat` option grammar.
 *
 * @param argument - One token from the command line.
 * @returns True for a recognized binary or highlight option.
 */
export function catArgument_isOption(argument: string): boolean {
  return argument === BINARY_OPTION
    || argument === HIGHLIGHT_OPTION
    || argument === NO_HIGHLIGHT_OPTION
    || argument.startsWith(HIGHLIGHT_LANGUAGE_PREFIX);
}

/**
 * Parses file paths and presentation options for the `cat` builtin.
 * Later highlight flags take precedence over earlier highlight flags.
 *
 * @param args - Tokens following the `cat` command name.
 * @returns Typed binary, highlighting, language, and file-path selections.
 */
export function catArguments_parse(args: string[]): CatArguments {
  let binaryMode: boolean = false;
  let highlightMode: CatHighlightMode = 'auto';
  let highlightLanguage: string | undefined;
  const filePaths: string[] = [];

  for (const argument of args) {
    if (argument === BINARY_OPTION) {
      binaryMode = true;
    } else if (argument === HIGHLIGHT_OPTION) {
      highlightMode = 'always';
      highlightLanguage = undefined;
    } else if (argument.startsWith(HIGHLIGHT_LANGUAGE_PREFIX)) {
      highlightMode = 'always';
      highlightLanguage = argument.slice(HIGHLIGHT_LANGUAGE_PREFIX.length);
    } else if (argument === NO_HIGHLIGHT_OPTION) {
      highlightMode = 'never';
      highlightLanguage = undefined;
    } else {
      filePaths.push(argument);
    }
  }

  return { binaryMode, highlightMode, highlightLanguage, filePaths };
}
