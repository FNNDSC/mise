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
