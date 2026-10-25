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
import { AsyncLocalStorage } from 'node:async_hooks';

/** A listing as an envelope's model carries it. */
export interface ListingModel {
  kind: string;
  data: unknown;
}

/** A slot holding the listing the previous builtin in a pipe produced, or null when nothing was piped. */
interface PipedListing {
  value: ListingModel | null;
}

/** The slot outside any pipe segment's scope (a test, a direct call). */
const unscoped: PipedListing = { value: null };

/**
 * The slot of the pipe segment running on this async path: two lines that
 * run at once each read their own pipe's input, never the other's (#1273).
 */
const pipedScope: AsyncLocalStorage<PipedListing> = new AsyncLocalStorage<PipedListing>();

/** The slot for the work running now. */
function piped_slot(): PipedListing {
  return pipedScope.getStore() ?? unscoped;
}

/**
 * Runs a pipe segment with the listing piped into it, in a slot of its own.
 *
 * @param model - The previous segment's listing, or null.
 * @param operation - The segment.
 * @returns What the segment returned.
 */
export async function listingInScope_run<T>(model: ListingModel | null, operation: () => Promise<T>): Promise<T> {
  return await pipedScope.run({ value: model }, operation);
}

// A pipe's listing not yet taken belongs to its command, not to one that
// runs while that command waits on a question.
turnPart_register({
  name: 'listingIn',
  save: (): unknown => piped_slot().value,
  clear: (): void => { piped_slot().value = null; },
  restore: (saved: unknown): void => { piped_slot().value = (saved as ListingModel | null) ?? null; },
});

/**
 * Hands a listing to the next builtin in a pipe (null clears it).
 *
 * @param model - The previous segment's model, when it is a listing.
 */
export function listingIn_set(model: ListingModel | null): void {
  piped_slot().value = model;
}

/**
 * Takes the piped listing, once.
 *
 * @returns It, or null when nothing was piped in.
 */
export function listingIn_take(): ListingModel | null {
  const slot: PipedListing = piped_slot();
  const taken: ListingModel | null = slot.value;
  slot.value = null;
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
