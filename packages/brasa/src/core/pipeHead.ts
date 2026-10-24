/**
 * @file A variable at the head of a pipe: `${T1} | grep -i sag | gather add`.
 *
 * Written as an argument, a variable must become words, and words are all a
 * verb then sees. A pipe between builtins carries the model itself, so a
 * variable standing alone as a pipe's first segment hands on what it holds:
 * its model to a builtin that reads one (`grep`, `gather add`), its operands
 * one per line to anything else. `$` means "this variable" in both places;
 * only what can receive it differs.
 *
 * Only a bare name heads a pipe this way. A field (`${T1.studies}`) is a
 * reading of the model, not the model, and stays an argument.
 *
 * @module
 */
import type { CommandEnvelope } from '@fnndsc/menu';
import { reference_refusal } from './expansion.js';
import { TEXT_KIND, answer_read, variable_get, type FieldReading, type Variable } from './variables.js';

/** A lone reference: `$NAME` or `${NAME}`, nothing else in the segment. */
const LONE_REFERENCE: RegExp = /^\$(?:\{([A-Za-z_][A-Za-z0-9_]*)\}|([A-Za-z_][A-Za-z0-9_]*))$/;

/** What a variable heading a pipe hands on. */
export interface PipeHeadOutput {
  text: string;
  buffer: Buffer;
  model?: CommandEnvelope['model'];
}

/** How a pipe's first segment reads as a variable. */
export type PipeHeadReading =
  | { output: PipeHeadOutput }
  | { refused: string }
  | null;

/**
 * Reads a pipe's first segment as a variable, when it is one.
 *
 * @param segment - The pipe's first segment, as written.
 * @returns What the variable hands on, a refusal when it names nothing, or
 *   null when the segment is not a lone variable.
 */
export function pipeHeadVariable_read(segment: string): PipeHeadReading {
  const match: RegExpMatchArray | null = segment.trim().match(LONE_REFERENCE);
  if (match === null) return null;
  const name: string = match[1] ?? match[2];
  const variable: Variable | undefined = variable_get(name);
  if (variable === undefined) return { refused: reference_refusal(name) };

  const reading: FieldReading = answer_read(variable.answer, name, []);
  const operands: string[] = 'values' in reading ? reading.values : [];
  const text: string = operands.length === 0 ? '' : `${operands.join('\n')}\n`;
  const model: CommandEnvelope['model'] = variable.answer.kind === TEXT_KIND
    ? undefined
    : { kind: variable.answer.kind, data: variable.answer.data };
  return { output: { text, buffer: Buffer.from(text, 'utf-8'), ...(model !== undefined ? { model } : {}) } };
}
