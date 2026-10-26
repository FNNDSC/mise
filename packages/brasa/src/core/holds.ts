/**
 * @file What a line holds of the session while it runs.
 *
 * Lines from several surfaces share one session, and one line's work must
 * not stop another's: a listing read in a browser should not wait behind a
 * PACS pull typed in a console. So a host runs lines side by side unless
 * they change the same piece of the session, and asks the kernel, before
 * a line runs, what it holds (#1273). A line holds what its commands hold:
 * nothing for a read, the working directory for `cd`, the cohort for
 * `gather`. Whatever cannot be read off the line (a command that has not
 * said, a host shell, a capture inside a word) holds the whole session, as
 * every line did before.
 *
 * @module
 */

import { commandHolds_get, type SessionPiece } from './commandRegistry.js';
import { pipes_parse } from './preprocess.js';
import { semicolons_parse } from '../lib/semicolonParser.js';
import { assignment_parse, type Assignment } from './variables.js';

/** What a line holds: the pieces it changes, or the whole session. */
export type LineHolds = SessionPiece[] | 'all';

/**
 * What a line holds of the session while it runs.
 *
 * @param line - The line, as the operator typed it.
 * @returns The pieces its commands change (none for a read), or 'all'.
 */
export function lineHolds_get(line: string): LineHolds {
  const pieces: Set<SessionPiece> = new Set();
  for (const command of semicolons_parse(line)) {
    const held: LineHolds = commandLine_holds(command.trim());
    if (held === 'all') return 'all';
    for (const piece of held) pieces.add(piece);
  }
  return [...pieces];
}

/**
 * What one command line (no semicolons) holds.
 *
 * @param command - The trimmed command line.
 * @returns Its pieces, or 'all'.
 */
function commandLine_holds(command: string): LineHolds {
  if (command === '') return [];
  // A host shell may do anything, the session's own tools included.
  if (command.startsWith('!')) return 'all';
  const assignment: Assignment | null = assignment_parse(command);
  if (assignment !== null) {
    // A store is one step: the assignment holds what its capture holds.
    if ('capture' in assignment) return lineHolds_get(assignment.capture);
    return 'literal' in assignment && !/\$\(|`/.test(assignment.literal) ? [] : 'all';
  }
  if (/\$\(|`/.test(command)) return 'all';
  const pieces: Set<SessionPiece> = new Set();
  for (const segment of pipes_parse(command)) {
    const name: string = segment.trim().split(/\s+/)[0] ?? '';
    const held: readonly SessionPiece[] | null = commandHolds_get(name);
    if (held === null) return 'all';
    for (const piece of held) pieces.add(piece);
  }
  return [...pieces];
}
