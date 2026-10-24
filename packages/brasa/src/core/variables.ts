/**
 * @file The session's variables: a name a line gives to what a command
 * answered, so a later line can say which thing it means.
 *
 * `A=$(pl-dcm2niix …)` holds the run's whole answer, its model, rather than
 * the text it printed; `${A.instanceId}` reads one field of it. A command
 * that answers no model is held as its text, one row per line. A literal,
 * `LABEL='sag cohort'`, is one word and stays one.
 *
 * Variables belong to the session, so every surface attached to it sees the
 * same ones. A manifest's play gets a scope of its own: it sees its
 * parameters (read-only) and nothing of the caller's, and what it sets ends
 * with it. A nested play gets its own again. The scope follows the async
 * path, so a play running in the daemon never leaks into a line typed at
 * another surface at the same moment.
 *
 * Reading follows one rule everywhere: a dot is a field of the model, as the
 * model names it. A field holding a list reaches through it, one operand per
 * element; a bare name is its rows when the answer has rows, and refuses by
 * name when it is one thing with several fields. There is no indexing:
 * naming one row is what the `@` handles are for.
 *
 * @module
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { answerRows_derive, type AnswerRow, type SessionAnswer } from '../session/answer.js';
import { rowOperands_extract } from './listing.js';

/** The kind a variable holding text has: a literal, a parameter, or a command with no model. */
export const TEXT_KIND: string = 'text';

/** What a name may be: a letter or underscore, then letters, digits, underscores. */
export const VARIABLE_NAME: RegExp = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** One variable. */
export interface Variable {
  /** What it holds. */
  answer: SessionAnswer;
  /** Whether a line may set or unset it: a manifest's parameters may not. */
  readOnly: boolean;
}

/** A set of variables: the session's, or one play's. */
type VariableScope = Map<string, Variable>;

/** The session's own variables. */
const sessionScope: VariableScope = new Map();

/** The scope of the play running on this async path, when one is. */
const playScope: AsyncLocalStorage<VariableScope> = new AsyncLocalStorage<VariableScope>();

/**
 * The scope a line on this async path reads and writes.
 *
 * @returns The play's scope inside a play, else the session's.
 */
function scope_current(): VariableScope {
  return playScope.getStore() ?? sessionScope;
}

/**
 * Whether the work on this async path is a play's.
 *
 * @returns True inside a play's scope.
 */
export function variableScope_isPlay(): boolean {
  return playScope.getStore() !== undefined;
}

/**
 * A text answer: a literal, a parameter's value, or what a command printed.
 *
 * @param text - The text.
 * @param source - The line that gave it.
 * @returns The answer.
 */
export function textAnswer_make(text: string, source: string): SessionAnswer {
  return { source, kind: TEXT_KIND, rows: [], data: text };
}

/**
 * Runs work in a fresh scope holding only the given parameters, read-only:
 * a manifest's play.
 *
 * @param params - The parameters, already checked for completeness.
 * @param operation - The work to run.
 * @returns The operation's result.
 */
export async function variableScope_run<T>(params: Map<string, string>, operation: () => Promise<T>): Promise<T> {
  const scope: VariableScope = new Map();
  for (const [name, value] of params) {
    scope.set(name, { answer: textAnswer_make(value, `@param ${name}`), readOnly: true });
  }
  return await playScope.run(scope, operation);
}

/**
 * The variable a name holds in the current scope.
 *
 * @param name - The variable's name.
 * @returns It, or undefined when the scope has none of that name.
 */
export function variable_get(name: string): Variable | undefined {
  return scope_current().get(name);
}

/**
 * Sets a variable in the current scope.
 *
 * @param name - Its name, already checked.
 * @param answer - What it holds.
 * @returns A refusal, or null when it was set.
 */
export function variable_set(name: string, answer: SessionAnswer): string | null {
  const scope: VariableScope = scope_current();
  if (scope.get(name)?.readOnly === true) return `${name} is a parameter of this manifest; it is read-only`;
  scope.set(name, { answer, readOnly: false });
  return null;
}

/**
 * Removes a variable from the current scope.
 *
 * @param name - Its name.
 * @returns A refusal, or null when it was removed (or was never set).
 */
export function variable_unset(name: string): string | null {
  const scope: VariableScope = scope_current();
  if (scope.get(name)?.readOnly === true) return `${name} is a parameter of this manifest; it is read-only`;
  scope.delete(name);
  return null;
}

/**
 * Every variable in the current scope, by name.
 *
 * @returns The variables, sorted by name.
 */
export function variables_list(): Array<{ name: string } & Variable> {
  return Array.from(scope_current().entries())
    .map(([name, variable]: [string, Variable]): { name: string } & Variable => ({ name, ...variable }))
    .sort((left: { name: string }, right: { name: string }): number => left.name.localeCompare(right.name));
}

/** What a bare name of one kind is, when the kind is a record that still has one obvious operand list. */
export type AnswerOperands = (data: unknown) => string[] | null;

/** Kind to its bare operands, for records that are not listings. */
const operandReaders: Map<string, AnswerOperands> = new Map();

/**
 * Says what a bare `${NAME}` holding a record of this kind expands to. A
 * listing's rows need no reader (its answer adapter numbers them); this is
 * for a record that is not a listing and must not become the held one, as a
 * scheduled pipeline's nodes are not rows to number.
 *
 * @param kind - The model kind.
 * @param reader - Reads the operands out of that model.
 */
export function answerOperands_register(kind: string, reader: AnswerOperands): void {
  operandReaders.set(kind, reader);
}

/** What reading a variable gave: operands, or a refusal an operator can act on. */
export type FieldReading = { values: string[] } | { refused: string };

/**
 * A value's own field names, for a refusal that says what can be named.
 *
 * @param value - An object.
 * @returns Its keys.
 */
function fields_format(value: object): string {
  return Object.keys(value).join(', ');
}

/**
 * Whether a value is a scalar an operand can be made of.
 *
 * @param value - Anything.
 * @returns True for a string, number or boolean.
 */
function scalar_is(value: unknown): value is string | number | boolean {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}

/**
 * The operands a value is, at the end of a dotted name.
 *
 * @param value - The value reached.
 * @param trail - The name as far as it went, for a refusal.
 * @param kind - The answer's kind, named when the whole model is an object.
 * @returns Its operands, or why it has none.
 */
function leaf_read(value: unknown, trail: string, kind: string | null): FieldReading {
  if (value === null || value === undefined) return { refused: `${trail} is empty` };
  if (scalar_is(value)) return { values: [String(value)] };
  if (Array.isArray(value)) {
    if (value.length === 0) return { refused: `${trail} is empty` };
    if (value.every(scalar_is)) return { values: value.map((element: string | number | boolean): string => String(element)) };
    const first: unknown = value.find((element: unknown): boolean => element !== null && typeof element === 'object');
    return { refused: `${trail} holds records; name a field: ${first === undefined ? '' : fields_format(first as object)}` };
  }
  return { refused: `${trail} is ${kind === null ? 'a record' : `a ${kind}`}; name a field: ${fields_format(value)}` };
}

/**
 * Walks a dotted name into a value. A field that is a list is reached
 * through: every element gives its operands.
 *
 * @param value - Where the walk stands.
 * @param fields - The fields still to walk.
 * @param trail - The name as far as it went.
 * @param kind - The answer's kind, for the bare refusal.
 * @returns The operands, or why there are none.
 */
function fields_walk(value: unknown, fields: ReadonlyArray<string>, trail: string, kind: string | null): FieldReading {
  if (fields.length === 0) return leaf_read(value, trail, kind);
  const [field, ...rest] = fields as [string, ...string[]];
  if (Array.isArray(value)) {
    const values: string[] = [];
    for (const element of value) {
      const reading: FieldReading = fields_walk(element, fields, trail, null);
      if ('refused' in reading) return reading;
      values.push(...reading.values);
    }
    if (values.length === 0) return { refused: `${trail} is empty` };
    return { values };
  }
  if (value === null || typeof value !== 'object') return { refused: `${trail} is a value; it has no field ${field}` };
  if (!(field in value)) return { refused: `${trail} has no field ${field}; it has ${fields_format(value)}` };
  return fields_walk((value as Record<string, unknown>)[field], rest, `${trail}.${field}`, null);
}

/**
 * The lines of a text answer, the trailing newline not making an empty one.
 *
 * @param text - The text.
 * @returns One string per line.
 */
function lines_split(text: string): string[] {
  const lines: string[] = text.split('\n');
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/**
 * Reads an answer by a dotted name: bare, the operands its rows hand on
 * (or its lines, or its one value); with fields, the fields as the model
 * names them.
 *
 * @param answer - What the variable holds.
 * @param name - The variable's name, for a refusal.
 * @param fields - The fields after it, in order.
 * @returns The operands, or why there are none.
 */
export function answer_read(answer: SessionAnswer, name: string, fields: ReadonlyArray<string>): FieldReading {
  if (answer.kind === TEXT_KIND) {
    if (fields.length > 0) return { refused: `${name} is text; it has no field ${fields[0]}` };
    const lines: string[] = lines_split(typeof answer.data === 'string' ? answer.data : '');
    return lines.length === 0 ? { refused: `${name} is empty` } : { values: lines };
  }
  if (fields.length > 0) return fields_walk(answer.data, fields, name, answer.kind);
  const rows: AnswerRow[] | null = answerRows_derive(answer.kind, answer.data);
  if (rows !== null) {
    // The operands a pipe would hand on: a group's row (a patient, a study)
    // is context a filter kept, not a pick, and each value counts once.
    const values: string[] = rowOperands_extract(rows);
    return values.length === 0 ? { refused: `${name} is empty` } : { values };
  }
  const operands: string[] | null = operandReaders.get(answer.kind)?.(answer.data) ?? null;
  if (operands !== null) return operands.length === 0 ? { refused: `${name} is empty` } : { values: operands };
  return leaf_read(answer.data, name, answer.kind);
}

/**
 * Finds the end of a `$(…)` that opens at a position: the parenthesis that
 * closes it, skipping any inside quotes or nested parentheses.
 *
 * @param text - The text.
 * @param open - Where `$(` begins.
 * @returns The index of the closing parenthesis, or -1 when it never closes.
 */
export function substitution_end(text: string, open: number): number {
  let depth: number = 0;
  let quote: '"' | "'" | null = null;
  for (let at: number = open + 1; at < text.length; at++) {
    const char: string = text[at] as string;
    if (quote !== null) {
      if (char === '\\' && quote === '"') { at++; continue; }
      if (char === quote) quote = null;
      continue;
    }
    if (char === '\\') { at++; continue; }
    if (char === '"' || char === "'") { quote = char; continue; }
    if (char === '(') depth++;
    else if (char === ')') {
      depth--;
      if (depth === 0) return at;
    }
  }
  return -1;
}

/** An assignment line, taken apart. */
export type Assignment =
  | { name: string; capture: string }
  | { name: string; literal: string }
  | { name: string; refused: string };

/**
 * Reads a line as an assignment, when it is one: `NAME=$(command)` or
 * `NAME=word`.
 *
 * @param line - The trimmed line.
 * @returns The assignment, or null when the line is not one.
 */
export function assignment_parse(line: string): Assignment | null {
  const match: RegExpMatchArray | null = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/s);
  if (match === null) return null;
  const name: string = match[1] as string;
  const value: string = match[2] as string;
  if (!value.startsWith('$(')) return { name, literal: value };
  const end: number = substitution_end(value, 0);
  if (end === -1) return { name, refused: `${name}=$(…): the $( never closes` };
  if (value.slice(end + 1).trim() !== '') return { name, refused: `${name}=$(…): a capture is the whole value; nothing may follow its )` };
  const capture: string = value.slice(2, end).trim();
  if (capture === '') return { name, refused: `${name}=$(): there is no command to capture` };
  if (capture.startsWith('$(') || /(^|[^\\])\$\(/.test(capture)) return { name, refused: `${name}=$(…): a capture holds one command line, not another capture` };
  return { name, capture };
}
