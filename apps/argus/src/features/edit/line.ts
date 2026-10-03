/**
 * @file The lines an EDIT pane runs, as the operator could have typed them.
 *
 * A save is `touch --withContents='<text>' '<path>'`: the kernel's own write,
 * so a store file is replaced and a projected one (a feed's note) is written
 * through its projection, and the transcript shows exactly what was written
 * (aegis.adoc: an-editors-save-is-a-line).
 *
 * @module
 */

/**
 * Quotes a word for the kernel's line: single quotes keep every character,
 * newlines included, and `$` or `@` stay text; a backslash escapes in any
 * quote there, so a backslash and a single quote are escaped.
 *
 * @param word - Any text.
 * @returns The word, quoted for the line.
 */
export function word_quote(word: string): string {
  return `'${word.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

/**
 * The line that writes a pane's text to its file.
 *
 * @param path - The file.
 * @param text - The whole text to write.
 * @returns The `touch --withContents` line.
 */
export function saveLine_compose(path: string, text: string): string {
  // The `=` form: a text beginning with `-` (a YAML list, a Markdown bullet)
  // is the flag's value, never read as another flag.
  return `touch --withContents=${word_quote(text)} ${word_quote(path)}`;
}

/**
 * The line that opens a file in the editor.
 *
 * @param path - The file.
 * @returns The `edit` line.
 */
export function editLine_compose(path: string): string {
  return `edit ${word_quote(path)}`;
}

/**
 * The question EDIT asks before opening a large file, or none: the field
 * holds a file whole, so a megabyte or more is asked about first.
 *
 * @param name - The file's name, as the row shows it.
 * @param bytes - Its size.
 * @param threshold - The size that earns the question (EDIT_CONFIRM_BYTES).
 * @returns The question's words, or null to open at once.
 */
export function editAsk_of(name: string, bytes: number, threshold: number): string | null {
  if (bytes < threshold) return null;
  return `edit: ${name} is ${(bytes / (1024 * 1024)).toFixed(1)} MB; open it in the editor? `;
}
