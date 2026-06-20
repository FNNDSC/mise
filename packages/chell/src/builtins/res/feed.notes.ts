/**
 * @file Pure helpers for editing feed notes via an external editor.
 *
 * Formats a note into an editable buffer and parses the edited buffer back into
 * title/content. Kept dependency-free so it is trivially unit-testable.
 *
 * @module
 */
import type { FeedNote } from '@fnndsc/chili/commands/feed/note.js';

/**
 * Formats a feed note into the editable buffer presented in `$EDITOR`.
 *
 * @param note - The note to format.
 * @returns The buffer text (a `# Title:` header followed by the content).
 */
export function noteEditBody_format(note: FeedNote): string {
  return `# Title: ${note.title}\n\n${note.content}`;
}

/**
 * Parses an edited note buffer back into title and content, falling back to the
 * original title if the header was removed.
 *
 * @param edited - The buffer text after editing.
 * @param fallbackTitle - Title to use when no `# Title:` header is present.
 * @returns The parsed title and content.
 */
export function noteEditBody_parse(edited: string, fallbackTitle: string): { title: string; content: string } {
  const titleMatch: RegExpMatchArray | null = edited.match(/^#\s*Title:\s*(.+)/m);
  const title: string = titleMatch ? titleMatch[1].trim() : fallbackTitle;
  const content: string = edited.replace(/^#\s*Title:.*\n?/m, '').replace(/^\n+/, '');
  return { title, content };
}
