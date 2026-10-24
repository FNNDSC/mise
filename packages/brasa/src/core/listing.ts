/**
 * @file A numbered listing handed on whole: through a pipe to the next
 * builtin, or as `${listing}`.
 *
 * Text is what a pipe carries to an operating-system tool; between builtins
 * the listing's model travels beside it, so `query … | gather add` hands
 * over rows, not words (#1103). A listing handed on gives its leaf rows (a
 * series, a file, a folder), never the rows that stand for others (a study,
 * a patient), so nothing is taken twice.
 *
 * @module
 */
import { answer_get, answerRows_derive, type AnswerRow } from '../session/answer.js';
import { answerKinds_get } from './answerKinds.js';
import { turnPart_register } from './turn.js';

/** A listing as an envelope's model carries it. */
export interface ListingModel {
  kind: string;
  data: unknown;
}

/** The listing the previous builtin in a pipe produced, for the next to take. */
let piped: ListingModel | null = null;

// A pipe's listing not yet taken belongs to its command, not to one that
// runs while that command waits on a question.
turnPart_register({
  name: 'listingIn',
  save: (): unknown => piped,
  clear: (): void => { piped = null; },
  restore: (saved: unknown): void => { piped = (saved as ListingModel | null) ?? null; },
});

/**
 * Hands a listing to the next builtin in a pipe (null clears it).
 *
 * @param model - The previous segment's model, when it is a listing.
 */
export function listingIn_set(model: ListingModel | null): void {
  piped = model;
}

/**
 * Takes the piped listing, once.
 *
 * @returns It, or null when nothing was piped in.
 */
export function listingIn_take(): ListingModel | null {
  const taken: ListingModel | null = piped;
  piped = null;
  return taken;
}

/**
 * The operands rows hand over: each leaf row's values, in order, once.
 *
 * @param rows - The rows.
 * @returns The operands.
 */
export function rowOperands_extract(rows: ReadonlyArray<AnswerRow>): string[] {
  const groups: Set<string> = new Set(answerKinds_get().filter((kind): boolean => kind.group === true).map((kind): string => kind.code));
  const seen: Set<string> = new Set();
  const operands: string[] = [];
  for (const row of rows) {
    if (groups.has(row.kind)) continue;
    for (const value of row.values) {
      if (seen.has(value)) continue;
      seen.add(value);
      operands.push(value);
    }
  }
  return operands;
}

/**
 * The operands a listing model hands over, or null when it is not a listing.
 *
 * @param model - The model.
 * @returns The operands.
 */
export function listingOperands_extract(model: ListingModel): string[] | null {
  const rows: AnswerRow[] | null = answerRows_derive(model.kind, model.data);
  return rows === null ? null : rowOperands_extract(rows);
}

/**
 * The held listing's operands (`${listing}`), or null before anything listed.
 *
 * @returns The operands.
 */
export function heldListingOperands_get(): string[] | null {
  const held = answer_get();
  return held === null ? null : rowOperands_extract(held.rows);
}
