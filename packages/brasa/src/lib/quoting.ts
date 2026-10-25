/**
 * @file Quoting: when a backslash escapes the character after it.
 *
 * POSIX's rule, read by every parser that splits a line (words, `;`, `|`,
 * `>`, `$( … )`, completion), so no split disagrees with another:
 *
 * - inside single quotes every character is literal, a backslash included;
 * - inside double quotes a backslash escapes only `$`, `` ` ``, `"`, `\` and
 *   newline, and before anything else it stays as written;
 * - outside quotes a backslash escapes the next character, whatever it is.
 *
 * So `printf '%s\n' a` hands printf its `\n`, `grep '\.mgz$'` its `\.`, and
 * `"a\"b"` is still one word holding a quote (#1258).
 *
 * @module
 */

/** What a backslash escapes inside double quotes; before anything else it stays. */
const DOUBLE_QUOTE_ESCAPES: ReadonlySet<string> = new Set(['$', '`', '"', '\\', '\n']);

/**
 * Whether a backslash, where it stands, escapes the character after it.
 *
 * @param inSingle - Whether it stands inside single quotes.
 * @param inDouble - Whether it stands inside double quotes.
 * @param next - The character after it, or undefined at the line's end.
 * @returns True when the two are one escaped character; false when the
 *   backslash is a character of its own.
 */
export function backslash_escapesNext(inSingle: boolean, inDouble: boolean, next: string | undefined): boolean {
  if (inSingle) return false;
  if (!inDouble) return true;
  return next !== undefined && DOUBLE_QUOTE_ESCAPES.has(next);
}

/** A quote a line leaves open: which, and the column (from 1) it opened at. */
export interface OpenQuote {
  quote: "'" | '"';
  column: number;
}

/**
 * Finds a quote a line opens and never closes, reading quotes by the rule
 * above, so a refusal names exactly what the word parser would have run
 * past (#1260).
 *
 * @param line - The line.
 * @returns The open quote, or null when every quote closes.
 */
export function quoteOpen_find(line: string): OpenQuote | null {
  let inSingle: boolean = false;
  let inDouble: boolean = false;
  let openedAt: number = 0;
  for (let at: number = 0; at < line.length; at++) {
    const char: string = line[at] as string;
    if (char === '\\' && backslash_escapesNext(inSingle, inDouble, line[at + 1])) { at++; continue; }
    if (char === "'" && !inDouble) {
      inSingle = !inSingle;
      if (inSingle) openedAt = at + 1;
    } else if (char === '"' && !inSingle) {
      inDouble = !inDouble;
      if (inDouble) openedAt = at + 1;
    }
  }
  if (inSingle) return { quote: "'", column: openedAt };
  if (inDouble) return { quote: '"', column: openedAt };
  return null;
}
