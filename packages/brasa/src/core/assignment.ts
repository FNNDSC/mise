/**
 * @file Running an assignment line: `NAME=$(command)` and `NAME=word`.
 *
 * A capture runs its command as any line runs, printing what it prints, and
 * holds the command's answer: its model when it answers with one, else the
 * text it printed. A command that fails leaves the name as it was and fails
 * the line, so a manifest stops there rather than carrying an empty value
 * forward. A literal is one word, expanded the way any word is, and never
 * split.
 *
 * @module
 */
import chalk from 'chalk';
import type { CommandEnvelope } from '@fnndsc/menu';
import { shellWords_referencesExpand, shellWords_tokenize, type ReferenceExpansion, type ShellWord } from '../lib/parser.js';
import { reference_isReserved, reference_refusal, reference_resolve, unresolvedStands_get } from './expansion.js';
import { exitCode_read } from './handlerRun.js';
import { sink_get, sinkScope_run, TeeSink } from './sink.js';
import { textAnswer_make, variable_set, type Assignment } from './variables.js';
import type { SessionAnswer } from '../session/answer.js';

/** Runs one line, as the engine does, and answers its envelopes. */
export type LineRun = (line: string) => Promise<CommandEnvelope[]>;

/**
 * Refuses an assignment line, saying why on the error channel.
 *
 * @param message - What the operator needs to know.
 * @returns The line's envelopes: one refusal.
 */
function assignment_refuse(message: string): CommandEnvelope[] {
  sink_get().err_write(`${chalk.red(message)}\n`);
  process.exitCode = 1;
  return [{ status: 'error', rendered: '' }];
}

/**
 * Sets a name, or refuses when the scope will not take it.
 *
 * @param name - The name.
 * @param answer - What it holds.
 * @returns A refusal, or null when it was set.
 */
function assignment_store(name: string, answer: SessionAnswer): CommandEnvelope[] | null {
  const refused: string | null = variable_set(name, answer);
  return refused === null ? null : assignment_refuse(`${name}=…: ${refused}`);
}

/**
 * Expands a literal value into the one word it must be.
 *
 * @param name - The name being set.
 * @param value - The value as written.
 * @returns The word, or a refusal.
 */
async function literal_expand(name: string, value: string): Promise<{ word: string } | { refused: string }> {
  const words: ShellWord[] = shellWords_tokenize(value);
  if (words.length === 0) return { word: '' };
  if (words.length > 1) return { refused: `${name}=…: a value is one word; quote it: ${name}='${value}'` };
  const expanded: ReferenceExpansion = await shellWords_referencesExpand(words, reference_resolve, unresolvedStands_get());
  if (!expanded.ok) return { refused: reference_refusal(expanded.missing) };
  if (expanded.words.length !== 1) return { refused: `${name}=…: ${value} expands to ${expanded.words.length} words; a value is one word, so quote it: ${name}="${value}"` };
  return { word: (expanded.words[0] as ShellWord).value };
}

/**
 * Runs an assignment line.
 *
 * @param assignment - The line, taken apart.
 * @param line - The line as written, the answer's source.
 * @param run - Runs a captured command line, as the engine runs any line.
 * @returns The line's envelopes: a capture's are its command's.
 */
export async function assignment_execute(assignment: Assignment, line: string, run: LineRun): Promise<CommandEnvelope[]> {
  const { name } = assignment;
  if ('refused' in assignment) return assignment_refuse(assignment.refused);
  if (reference_isReserved(name)) return assignment_refuse(`${name}=…: \${${name}} is the session's own; it is read-only`);

  if ('literal' in assignment) {
    const value: { word: string } | { refused: string } = await literal_expand(name, assignment.literal);
    if ('refused' in value) return assignment_refuse(value.refused);
    return assignment_store(name, textAnswer_make(value.word, line)) ?? [];
  }

  const tee: TeeSink = new TeeSink(sink_get());
  const exitBefore: number = exitCode_read();
  const envelopes: CommandEnvelope[] = await sinkScope_run(tee, (): Promise<CommandEnvelope[]> => run(assignment.capture));
  const exitAfter: number = exitCode_read();
  const failed: boolean = envelopes.some((envelope: CommandEnvelope): boolean => envelope.status === 'error')
    || (exitAfter !== 0 && exitAfter !== exitBefore);
  if (failed) {
    return [...envelopes, ...assignment_refuse(`${name}=$(…): the command failed; ${name} is unchanged`)];
  }

  // The answer is the last model the line gave: a pipe's is its last
  // segment's, as `NAME=$(query … | grep sag)` means.
  const modelled: CommandEnvelope | undefined = [...envelopes].reverse().find(
    (envelope: CommandEnvelope): boolean => envelope.model !== undefined,
  );
  const answer: SessionAnswer = modelled?.model !== undefined
    ? { source: assignment.capture, kind: modelled.model.kind, rows: [], data: modelled.model.data }
    : textAnswer_make(tee.text_get(), assignment.capture);
  return assignment_store(name, answer) ?? envelopes;
}
