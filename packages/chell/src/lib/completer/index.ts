/**
 * @file REPL Autocompletion.
 *
 * Provides tab-completion logic for the REPL, including built-in commands
 * and future support for path completion.
 *
 * @module
 */

const BUILTINS: string[] = [
  'cd',
  'pwd',
  'ls',
  'connect',
  'logout',
  'chefs',
  'mkdir',
  'touch',
  'help',
  'exit',
  'quit'
];

/**
 * Computes autocomplete suggestions for a given input line.
 *
 * Currently supports:
 * - Built-in commands
 *
 * @param line - The current input line.
 * @returns A tuple containing the array of matching suggestions and the original substring used for matching.
 */
export function completer(line: string): [string[], string] {
  const trimmed = line.trimStart();
  const args = trimmed.split(/\s+/);
  
  // If we are typing the first word (command)
  if (args.length <= 1) {
    if (!trimmed) {
      return [BUILTINS, line];
    }
    const hits = BUILTINS.filter((c) => c.startsWith(trimmed));
    return [hits, trimmed];
  }

  // TODO: Implement path completion for 'cd', 'ls' etc.
  // This would require an async completer or caching the file structure.
  
  return [[], line];
}
