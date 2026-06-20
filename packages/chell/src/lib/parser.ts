/**
 * @file Command line argument tokenizer.
 *
 * Splits a command line into tokens while respecting single/double quotes
 * and backslash escapes. Quotes are stripped from the resulting tokens.
 */

/**
 * Tokenizes a command line preserving quoted segments with spaces.
 *
 * @param line - Raw command line input.
 * @returns Array of tokens with quotes removed.
 */
export function args_tokenize(line: string): string[] {
  const tokens: string[] = [];
  let current: string = '';
  let inSingle: boolean = false;
  let inDouble: boolean = false;
  let escapeNext: boolean = false;

  for (let i = 0; i < line.length; i++) {
    const char: string = line[i];

    if (escapeNext) {
      current += char;
      escapeNext = false;
      continue;
    }

    if (char === '\\') {
      escapeNext = true;
      continue;
    }

    if (char === "'" && !inDouble) {
      inSingle = !inSingle;
      continue;
    }

    if (char === '"' && !inSingle) {
      inDouble = !inDouble;
      continue;
    }

    if (!inSingle && !inDouble && /\s/.test(char)) {
      if (current.length > 0) {
        tokens.push(current);
        current = '';
      }
      continue;
    }

    current += char;
  }

  if (current.length > 0) {
    tokens.push(current);
  }

  return tokens;
}
