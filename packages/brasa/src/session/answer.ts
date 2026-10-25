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
 * different renderings would be worse than no index at all.
 *
 * Each surface keeps its own last answer: a listing read on one surface
 * does not renumber the rows another is about to act on (#1273). A line
 * counts against the answer of the surface it came from.
 *
 * What a row IS differs by listing, and each one says: a path for files and
 * PACS series, a feed id for feeds, an instance id for jobs. A verb then
 * receives the operand it already takes.
 *
 * @module
 */

import { ambient_publish } from '../core/ambient.js';
import { lineOrigin_get } from '../core/lineOrigin.js';

/**
 * What kind of thing a row is, as a three-letter code.
 *
 * A number alone says nothing about what it counts — in a PACS answer every
 * study read "1", being the only study under its patient — so an index says
 * its kind: `@SER003`, `@STD001`, `@FIL012`, `@DIR004`. One sequence per
 * kind across the whole answer, so the code is a handle rather than a
 * position, and a sorted listing does not renumber it. The core numbers
 * files and folders (`FIL`, `DIR`); a backend adds its own kinds
 * (`core/answerKinds.ts`).
 */
export type AnswerKind = string;

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
  /** What a filter matches it on (its line as the listing shows it); the label when absent. */
  text?: string;
  /** Its parent row (`STD:<path>` for a series), for a filter that keeps a row with its context. */
  parent?: string;
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

/** The answer a session most recently gave, with the line that asked. */
export interface SessionAnswer {
  /** The line that produced it, for the readout that says what was numbered. */
  source: string;
  /** The rows, in the order the model holds them. */
  rows: AnswerRow[];
  /** The model kind the rows came from, for a filter of the held listing. */
  kind: string;
  /** The model itself. */
  data: unknown;
}

/** The answer rows a model carries, or null when it is not a listing. */
export type AnswerAdapter = (data: unknown) => AnswerRow[] | null;

/** Model kind to the rows it holds. */
const adapters: Map<string, AnswerAdapter> = new Map();

/** What one surface holds: its last answer, and whether a line consulted it. */
interface OriginAnswer {
  held: SessionAnswer;
  /** Whether an index has been resolved against it since the last take. */
  consulted: boolean;
}

/** Each surface's last answer, by the origin its lines carry. */
const answers: Map<string, OriginAnswer> = new Map();

/** The running line's surface's answer, or undefined before it has listed. */
function origin_answer(): OriginAnswer | undefined {
  return answers.get(lineOrigin_get());
}

/** The running line's surface's last answer, or null before it has listed. */
function held_get(): SessionAnswer | null {
  return origin_answer()?.held ?? null;
}

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
  const origin: string = lineOrigin_get();
  answers.set(origin, { held: { source, rows, kind, data }, consulted: false });
  // A surface cannot light the index pills on the right listing unless it is
  // told which one the numbers now count. Pills that lie are worse than none.
  // Only the surface whose line listed is told: the others' numbers stand.
  ambient_publish({
    kind: 'numbered',
    origin,
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
  const mine: OriginAnswer | undefined = origin_answer();
  if (mine === undefined) return null;
  const held: SessionAnswer = mine.held;
  // By the number the row wears, which a filtered listing keeps (#1100).
  const numbered: NumberedHandle[] = rows_number(held.rows, held.data);
  const at: number = numbered.findIndex((one: NumberedHandle): boolean => one.kind === handle.kind && one.ordinal === handle.ordinal);
  const row: AnswerRow | undefined = at < 0 ? undefined : held.rows[at];
  if (row === undefined) return null;
  mine.consulted = true;
  return row;
}

/**
 * How many rows of a kind the answer holds, for a refusal that says so.
 *
 * @param kind - The kind asked about.
 * @returns The count, zero when nothing is numbered.
 */
export function answerKind_count(kind: AnswerKind): number {
  const held: SessionAnswer | null = held_get();
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
  const held: SessionAnswer | null = held_get();
  return held === null ? [] : rows_number(held.rows, held.data);
}

/** Numbers a listing's rows already wore, kept with the listing's data (a filtered listing). */
const givenOrdinals: WeakMap<object, Map<string, number>> = new WeakMap();

/**
 * Keeps the numbers a listing's rows already wore with its data, so a
 * filtered listing's rows keep them: `@SER41` stays `@SER41` (#1100).
 *
 * @param data - The listing's model data.
 * @param ordinals - `KIND:address` to the number it wore.
 */
export function answerOrdinals_attach(data: object, ordinals: ReadonlyMap<string, number>): void {
  givenOrdinals.set(data, new Map(ordinals));
}

/** What filters a kind's model down to the rows kept. */
export type AnswerFilter = (data: unknown, keep: ReadonlySet<string>) => unknown;

/** Model kind to its filter. */
const filters: Map<string, AnswerFilter> = new Map();

/**
 * Registers how a model kind is filtered to a set of its rows.
 *
 * @param kind - The envelope model kind.
 * @param filter - Builds the model holding only the kept rows (`KIND:address`).
 */
export function answerFilter_register(kind: string, filter: AnswerFilter): void {
  filters.set(kind, filter);
}

/**
 * A model filtered to the rows kept, or null when its kind has no filter.
 *
 * @param kind - The envelope model kind.
 * @param data - The model.
 * @param keep - The rows kept, as `KIND:address`.
 * @returns The filtered model.
 */
export function answerFilter_apply(kind: string, data: unknown, keep: ReadonlySet<string>): unknown {
  const filter: AnswerFilter | undefined = filters.get(kind);
  return filter === undefined ? null : filter(data, keep);
}

/** A row's key: its kind and address, as numbers and filters name it. */
export function answerRow_key(row: AnswerRow): string {
  return `${row.kind}:${row.address ?? row.values[0] ?? ''}`;
}

/**
 * Numbers rows: one sequence per kind, in the order the rows stand. The one
 * place a number is made, so what a listing prints is what an index expands
 * to (#1099).
 *
 * @param rows - The rows.
 * @returns Each row's handle and address.
 */
function rows_number(rows: ReadonlyArray<AnswerRow>, data?: unknown): NumberedHandle[] {
  // A filtered listing's rows keep the numbers they wore; any other row is
  // counted in its kind's sequence.
  const given: Map<string, number> | undefined = data !== null && typeof data === 'object' ? givenOrdinals.get(data) : undefined;
  const seen: Map<AnswerKind, number> = new Map();
  return rows.map((row: AnswerRow): NumberedHandle => {
    const counted: number = (seen.get(row.kind) ?? 0) + 1;
    seen.set(row.kind, counted);
    const address: string = row.address ?? row.values[0] ?? '';
    return { kind: row.kind, ordinal: given?.get(`${row.kind}:${address}`) ?? counted, address };
  });
}

/**
 * A model's rows, as its adapter reads them, without holding them.
 *
 * @param kind - The envelope model kind.
 * @param data - The model.
 * @returns The rows, or null when the model is not a listing.
 */
export function answerRows_derive(kind: string, data: unknown): AnswerRow[] | null {
  return adapters.get(kind)?.(data) ?? null;
}

/**
 * The handles a model's rows will wear once it is the held listing.
 *
 * @param kind - The envelope model kind.
 * @param data - The model.
 * @returns The handles, in row order, or null when the model is not a listing.
 */
export function answerNumbering_derive(kind: string, data: unknown): NumberedHandle[] | null {
  const rows: AnswerRow[] | null = adapters.get(kind)?.(data) ?? null;
  return rows === null ? null : rows_number(rows, data);
}

/**
 * A handle as it is printed and typed: short, `@SER3`.
 *
 * @param handle - The handle.
 * @returns The word.
 */
export function handle_word(handle: { kind: AnswerKind; ordinal: number }): string {
  return `@${handle.kind}${handle.ordinal}`;
}

/**
 * Each row's printed handle, by its kind and address, for a renderer that
 * walks its own model: `handles.get('SER:' + path)`.
 *
 * @param handles - The numbered rows.
 * @returns Kind-and-address to word.
 */
export function handleWords_map(handles: ReadonlyArray<NumberedHandle>): Map<string, string> {
  return new Map(handles.map((handle: NumberedHandle): [string, string] => [`${handle.kind}:${handle.address}`, handle_word(handle)]));
}

/**
 * The footer that says what is numbered, in the form an index is typed:
 * `numbered: @PAT1, @STD1-9, @SER1-235` (runs of numbers as ranges, gaps
 * with commas: `@SER1,3,41`). It is also the cue for what `@SER3` means now.
 *
 * @param handles - The numbered rows.
 * @returns The footer, or '' when nothing is numbered.
 */
export function numberedFooter_render(handles: ReadonlyArray<{ kind: AnswerKind; ordinal: number }>): string {
  const byKind: Map<AnswerKind, number[]> = new Map();
  for (const handle of handles) byKind.set(handle.kind, [...(byKind.get(handle.kind) ?? []), handle.ordinal]);
  const parts: string[] = [...byKind].map(([kind, ordinals]: [AnswerKind, number[]]): string => {
    const sorted: number[] = [...new Set(ordinals)].sort((a: number, b: number): number => a - b);
    const runs: string[] = [];
    for (let at: number = 0; at < sorted.length;) {
      let end: number = at;
      while (end + 1 < sorted.length && (sorted[end + 1] ?? 0) === (sorted[end] ?? 0) + 1) end += 1;
      runs.push(end > at ? `${sorted[at]}-${sorted[end]}` : `${sorted[at]}`);
      at = end + 1;
    }
    return `@${kind}${runs.join(',')}`;
  });
  return parts.length === 0 ? '' : `numbered: ${parts.join(', ')}`;
}

/**
 * What is currently numbered, for a surface that lights its index pills.
 *
 * @returns The held answer, or null when nothing has listed.
 */
export function answer_get(): SessionAnswer | null {
  return held_get();
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
  const mine: OriginAnswer | undefined = origin_answer();
  if (mine === undefined || !mine.consulted) return null;
  mine.consulted = false;
  return mine.held;
}

/** Forgets the answer, for a test that needs a session that has listed nothing. */
export function answer_forget(): void {
  answers.clear();
  sequence = 0;
}

/**
 * Forgets one surface's answer, when the surface has gone.
 *
 * @param origin - The surface's origin.
 */
export function answerOrigin_forget(origin: string): void {
  answers.delete(origin);
}
