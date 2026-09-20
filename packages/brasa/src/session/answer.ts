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

/** One row of an answer, as something a verb can be given. */
export interface AnswerRow {
  /** What names the row: a path, an id — whatever its verb takes. */
  value: string;
  /** What to call it in a readout. */
  label: string;
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
  held = { source, rows };
}

/**
 * The row an index names.
 *
 * @param index - The 1-based index the operator wrote.
 * @returns The row, or null when nothing is numbered or the index is past the end.
 */
export function answerRow_get(index: number): AnswerRow | null {
  if (held === null) return null;
  const row: AnswerRow | undefined = held.rows[index - 1];
  if (row === undefined) return null;
  consulted = true;
  return row;
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
}
