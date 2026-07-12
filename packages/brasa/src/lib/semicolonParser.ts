/**
 * @file Semicolon command parser
 *
 * Parses semicolon-separated commands while respecting quotes.
 *
 * @module
 */

/**
 * Parses a command line for semicolon separators and returns individual commands.
 * Respects quoted strings - semicolons inside quotes are not treated as separators.
 *
 * @param line - The full command line.
 * @returns An array of individual commands.
 *
 * @example
 * ```typescript
 * semicolons_parse("ls; pwd")                    // Returns: ["ls", "pwd"]
 * semicolons_parse("echo 'a;b'; pwd")            // Returns: ["echo 'a;b'", "pwd"]
 * semicolons_parse("cd /tmp; ls; cat file.txt")  // Returns: ["cd /tmp", "ls", "cat file.txt"]
 * ```
 */
export function semicolons_parse(line: string): string[] {
  const commands: string[] = [];
  let currentCommand: string = '';
  let inSingleQuote: boolean = false;
  let inDoubleQuote: boolean = false;

  for (let i: number = 0; i < line.length; i++) {
    const char: string = line[i];

    if (char === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      currentCommand += char;
    } else if (char === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      currentCommand += char;
    } else if (char === ';' && !inSingleQuote && !inDoubleQuote) {
      const trimmed: string = currentCommand.trim();
      if (trimmed) commands.push(trimmed);
      currentCommand = '';
    } else {
      currentCommand += char;
    }
  }

  // Add final command
  const trimmed: string = currentCommand.trim();
  if (trimmed) commands.push(trimmed);

  return commands;
}
