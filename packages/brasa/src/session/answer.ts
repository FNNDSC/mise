/**
 * @file The session's last answer, so a row can be named by its number.
 *
 * An operator reads a listing and wants to act on the third row. Until now
 * the only way to say which row was to repeat its address, which for a PACS
 * series is a line of text nobody types by hand — so acting on what you can
 * see was a surface gesture, and a scripted session could not do it at all.
 *
 * A command that answers with rows records them here, and `@3` resolves
 * against the most recent one. The numbering belongs to the MODEL rather
 * than to any rendering of it: a console table and a graphical pane show the
 * same answer differently, and an index that meant different rows on
 * different surfaces would be worse than no index at all.
 *
 * What a row IS differs by listing, and each one says: a path for files and
 * PACS series, a feed id for feeds, an instance id for jobs. A verb then
 * receives the operand it already takes.
 *
 * @module
 */

import { ambient_publish } from '../core/ambient.js';

/**
 * What kind of thing a row is, as a three-letter code.
 *
 * A number alone says nothing about what it counts — in a PACS answer every
 * study read "1", being the only study under its patient — so an index says
 * its kind: `@SER003`, `@STD001`, `@FIL012`, `@DIR004`. One sequence per
 * kind across the whole answer, so the code is a handle rather than a
 * position, and a sorted listing does not renumber it.
 */
export type AnswerKind = 'PAT' | 'STD' | 'SER' | 'FIL' | 'DIR';

/** Every kind an answer may carry, for a refusal that lists them. */
export const ANSWER_KINDS: ReadonlyArray<AnswerKind> = ['PAT', 'STD', 'SER', 'FIL', 'DIR'];

/** One row of an answer, as something a verb can be given. */
export interface AnswerRow {
  /** What kind of thing the row is. */
  kind: AnswerKind;
  /**
   * What names the row: a path, an id — whatever its verb takes. A study
   * carries several, one per series, so `@STD001` hands over what the
   * surface's GATHER on a study hands over. The first is the row's own
   * address, which is what a surface matches on.
   */
  values: string[];
  /**
   * What a surface matches the row on, when it is not the first value: a
   * patient has no path of its own, only its series' paths to hand over,
   * so its address is minted from what names it.
   */
  address?: string;
  /** What to call it in a readout. */
  label: string;
}

/** A row's handle: its kind and its place in that kind's sequence. */
export interface AnswerHandle {
  kind: AnswerKind;
  ordinal: number;
}

/** One numbered row as a surface is told of it. */
export interface NumberedHandle {
  kind: AnswerKind;
  ordinal: number;
  address: string;
}

/** What a surface is told about the numbering. */
export interface Numbering {
  id: number;
  source: string;
  rows: number;
  handles: NumberedHandle[];
}

/** The answer a session most recently gave, with the line that asked. */
export interface SessionAnswer {
  /** The line that produced it, for the readout that says what was numbered. */
  source: string;
  /** The rows, in the order the model holds them. */
  rows: AnswerRow[];
}

/** The answer rows a model carries, or null when it is not a listing. */
export type AnswerAdapter = (data: unknown) => AnswerRow[] | null;

/** Model kind to the rows it holds. */
const adapters: Map<string, AnswerAdapter> = new Map();

/** The session's last answer, or null before anything has listed. */
let held: SessionAnswer | null = null;

/** Whether an index has been resolved against the held answer this line. */
let consulted: boolean = false;

/** Rises with each answer, so a surface can tell newer from older. */
let sequence: number = 0;

/** Past this many rows the addresses stay in the kernel and off the wire. */
const VALUES_ON_THE_WIRE_MAX: number = 500;

/**
 * Registers what a model kind's rows are.
 *
 * @param kind - The envelope model kind.
 * @param adapter - Reads the rows out of that model.
 */
export function answerAdapter_register(kind: string, adapter: AnswerAdapter): void {
  adapters.set(kind, adapter);
}

/**
 * Notes an answer, when the model is one whose rows can be numbered.
 *
 * @param kind - The envelope model kind.
 * @param data - The model's payload.
 * @param source - The line that produced it.
 */
export function answer_note(kind: string, data: unknown, source: string): void {
  const adapter: AnswerAdapter | undefined = adapters.get(kind);
  if (adapter === undefined) return;
  const rows: AnswerRow[] | null = adapter(data);
  // An answer with no rows does not replace one that has them: `ls` on an
  // empty folder should not silently un-number the listing just read.
  if (rows === null || rows.length === 0) return;
  sequence += 1;
  held = { source, rows };
  // A surface cannot light the index pills on the right listing unless it is
  // told which one the numbers now count. Pills that lie are worse than none.
  ambient_publish({
    kind: 'numbered',
    id: sequence,
    source,
    rows: rows.length,
    // A surface matches a row by its address and draws the code, so the
    // handles travel — up to a cap, past which a listing is numbered in the
    // kernel and unnumbered on screen rather than flooding the wire.
    handles: rows.length <= VALUES_ON_THE_WIRE_MAX ? answerHandles_get() : [],
  });
}

/**
 * The row a handle names.
 *
 * @param handle - The kind and 1-based ordinal the operator wrote.
 * @returns The row, or null when nothing is numbered, the kind is absent
 *   from the answer, or the ordinal is past that kind's end.
 */
export function answerRow_get(handle: AnswerHandle): AnswerRow | null {
  if (held === null) return null;
  const ofKind: AnswerRow[] = held.rows.filter((row: AnswerRow): boolean => row.kind === handle.kind);
  const row: AnswerRow | undefined = ofKind[handle.ordinal - 1];
  if (row === undefined) return null;
  consulted = true;
  return row;
}

/**
 * How many rows of a kind the answer holds, for a refusal that says so.
 *
 * @param kind - The kind asked about.
 * @returns The count, zero when nothing is numbered.
 */
export function answerKind_count(kind: AnswerKind): number {
  if (held === null) return 0;
  return held.rows.filter((row: AnswerRow): boolean => row.kind === kind).length;
}

/**
 * Every row's handle beside its address, in answer order.
 *
 * A surface finds each of its rows by address and draws the code the
 * operator would type.
 *
 * @returns The handles.
 */
export function answerHandles_get(): NumberedHandle[] {
  if (held === null) return [];
  const seen: Map<AnswerKind, number> = new Map();
  return held.rows.map((row: AnswerRow): NumberedHandle => {
    const ordinal: number = (seen.get(row.kind) ?? 0) + 1;
    seen.set(row.kind, ordinal);
    return { kind: row.kind, ordinal, address: row.address ?? row.values[0] ?? '' };
  });
}

/**
 * What is currently numbered, for a surface that lights its index pills.
 *
 * @returns The held answer, or null when nothing has listed.
 */
export function answer_get(): SessionAnswer | null {
  return held;
}

/**
 * Takes the note that an index was resolved, for the line's readout.
 *
 * A line that acts on a number says which listing it counted — the standing
 * rule that a readout which acts says so.
 *
 * @returns What was consulted, or null when this line used no index.
 */
export function answerConsulted_take(): SessionAnswer | null {
  if (!consulted || held === null) return null;
  consulted = false;
  return held;
}

/** Forgets the answer, for a test that needs a session that has listed nothing. */
export function answer_forget(): void {
  held = null;
  consulted = false;
  sequence = 0;
}

/**
 * Which answer is numbered, for a surface attaching late.
 *
 * @returns The current numbering, or null when nothing has listed.
 */
export function numbering_get(): Numbering | null {
  if (held === null) return null;
  return {
    id: sequence,
    source: held.source,
    rows: held.rows.length,
    handles: held.rows.length <= VALUES_ON_THE_WIRE_MAX ? answerHandles_get() : [],
  };
}
