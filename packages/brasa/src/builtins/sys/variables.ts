/**
 * @file `set` and `unset`: the session's variables, seen and cleared.
 *
 * Bare `set` lists every variable in scope with what it holds; `set A` shows
 * A's answer whole, as JSON, and answers with A's own model, so it can be
 * captured again. `unset` removes names; a manifest's parameter and the
 * session's built-ins refuse by name. POSIX `set`'s options and positional
 * parameters are not here, and an option is refused by name.
 *
 * @module
 */
import chalk from 'chalk';
import { envelope_error, envelope_ok, type CommandEnvelope } from '@fnndsc/menu';
import { reference_isReserved } from '../../core/expansion.js';
import { answer_read, TEXT_KIND, VARIABLE_NAME, variable_get, variable_unset, variables_list, type FieldReading, type Variable } from '../../core/variables.js';
import { exitCode_set } from '../../core/handlerRun.js';

/** The model kind `set` lists under. */
export const VARIABLES_MODEL_KIND: string = 'variables.list';

/** One variable as `set` lists it. */
export interface VariableListing {
  name: string;
  kind: string;
  source: string;
  readOnly: boolean;
  summary: string;
}

/** How long a summary may run before it is cut, with how much it left out said. */
const SUMMARY_MAX: number = 60;

/**
 * One line saying what a variable holds.
 *
 * @param name - Its name.
 * @param variable - It.
 * @returns The summary.
 */
function variableSummary_render(name: string, variable: Variable): string {
  const reading: FieldReading = answer_read(variable.answer, name, []);
  if ('refused' in reading) return reading.refused.replace(`${name} `, '');
  const shown: string = reading.values.join(' ');
  const count: string = reading.values.length === 1 ? '' : ` (${reading.values.length} operands)`;
  return shown.length > SUMMARY_MAX ? `${shown.slice(0, SUMMARY_MAX)}…${count === '' ? ` (${shown.length} characters)` : count}` : `${shown}${count}`;
}

/**
 * `set [NAME]`: lists the variables in scope, or shows one whole.
 *
 * @param args - The words after `set`.
 * @returns The listing, or the variable's own answer.
 */
export async function builtin_set(args: string[]): Promise<CommandEnvelope> {
  const flag: string | undefined = args.find((word: string): boolean => word.startsWith('-') || word.startsWith('+'));
  if (flag !== undefined) {
    exitCode_set(1);
    return envelope_error('', undefined, `set: ${flag}: unknown option; set lists variables, and set NAME shows one\n`);
  }
  if (args.length > 1) {
    exitCode_set(1);
    return envelope_error('', undefined, 'set: one name at a time; set NAME shows it, NAME=… sets it\n');
  }

  if (args.length === 1) {
    const name: string = args[0] as string;
    const variable: Variable | undefined = variable_get(name);
    if (variable === undefined) {
      exitCode_set(1);
      return envelope_error('', undefined, `set: ${name}: no such variable\n`);
    }
    const body: string = variable.answer.kind === TEXT_KIND
      ? String(variable.answer.data)
      : JSON.stringify(variable.answer.data, null, 2);
    const head: string = chalk.gray(`${name}  ${variable.answer.kind}  from: ${variable.answer.source}${variable.readOnly ? '  (read-only)' : ''}`);
    return envelope_ok(`${head}\n${body}\n`, { kind: variable.answer.kind, data: variable.answer.data });
  }

  const listed: VariableListing[] = variables_list().map((variable: { name: string } & Variable): VariableListing => ({
    name: variable.name,
    kind: variable.answer.kind,
    source: variable.answer.source,
    readOnly: variable.readOnly,
    summary: variableSummary_render(variable.name, variable),
  }));
  if (listed.length === 0) return envelope_ok(`${chalk.gray('no variables set; NAME=$(command) or NAME=word sets one')}\n`, { kind: VARIABLES_MODEL_KIND, data: listed });
  const width: number = Math.max(...listed.map((one: VariableListing): number => one.name.length));
  const kindWidth: number = Math.max(...listed.map((one: VariableListing): number => one.kind.length));
  const lines: string[] = listed.map((one: VariableListing): string =>
    `${chalk.bold(one.name.padEnd(width))}  ${chalk.cyan(one.kind.padEnd(kindWidth))}  ${one.summary}${one.readOnly ? chalk.gray('  (read-only)') : ''}`);
  return envelope_ok(`${lines.join('\n')}\n`, { kind: VARIABLES_MODEL_KIND, data: listed });
}

/**
 * `unset NAME…`: removes variables.
 *
 * @param args - The words after `unset`.
 * @returns Quiet on success, as unset is; a line per name it would not remove.
 */
export async function builtin_unset(args: string[]): Promise<CommandEnvelope> {
  if (args.length === 0) {
    exitCode_set(1);
    return envelope_error('', undefined, 'unset: name a variable to remove\n');
  }
  const complaints: string[] = [];
  for (const name of args) {
    if (name.startsWith('-')) { complaints.push(`unset: ${name}: unknown option`); continue; }
    if (!VARIABLE_NAME.test(name)) { complaints.push(`unset: ${name}: not a variable's name`); continue; }
    if (reference_isReserved(name)) { complaints.push(`unset: \${${name}} is the session's own; it is read-only`); continue; }
    const refused: string | null = variable_unset(name);
    if (refused !== null) complaints.push(`unset: ${refused}`);
  }
  if (complaints.length > 0) {
    exitCode_set(1);
    return envelope_error('', undefined, `${complaints.join('\n')}\n`);
  }
  return envelope_ok('');
}
