/**
 * @file Builtin record command: writing a session down as a manifest.
 *
 * Subcommands: start, stop, status.
 *
 * Every verb lowers to a line the operator could have typed, so a session's
 * line history is very nearly a manifest already — a press on a surface and
 * a line at a console arrive at the same place, and the recorder sits there.
 * That is why this costs almost nothing: the lowering was already the law.
 *
 * @module
 */
import chalk from 'chalk';
import { CommandEnvelope, envelope_ok, envelope_error } from '@fnndsc/cumin';
import { files_touch as chefs_touch_cmd } from '@fnndsc/chili/commands/fs/touch.js';
import { files_mkdir as chefs_mkdir_cmd } from '@fnndsc/chili/commands/fs/mkdir.js';
import path from 'path';
import { commandArgs_process, ParsedArgs, path_resolve } from '../utils.js';
import {
  RecorderState,
  recorder_start,
  recorder_state,
  recorder_stop,
} from '../../session/recorder.js';

/** The model kind under which a finished recording travels. */
export const RECORD_MODEL_KIND: string = 'manifest.recorded';

/** What a recording turned into. */
export interface RecordedManifest {
  /** Where it was written. */
  path: string;
  /** How many lines it holds. */
  lines: number;
  /** The parameters it was given, and the literal each replaced. */
  params: Array<{ name: string; was: string }>;
  /** How long the recording ran. */
  elapsedMs: number;
}

/**
 * Literals worth offering as parameters.
 *
 * A recording is personal until its identifiers come out of it: the MRN and
 * the accession are exactly what the next person has to change, and they are
 * the two a PACS line wears on its face. Nothing else is guessed at — a
 * parameter the author did not want is worse than one they have to add.
 */
const IDENTIFIER_PATTERNS: ReadonlyArray<{ criterion: string; param: string }> = [
  { criterion: 'PatientID', param: 'MRN' },
  { criterion: 'AccessionNumber', param: 'ACC' },
  { criterion: 'PatientName', param: 'PATIENT' },
];

/**
 * Offers parameters for the identifiers a recording carries.
 *
 * @param lines - The captured lines.
 * @returns The lines with identifiers replaced, and what was replaced.
 */
export function identifiers_offer(
  lines: string[],
): { lines: string[]; params: Array<{ name: string; was: string }> } {
  const params: Array<{ name: string; was: string }> = [];
  const taken: Map<string, string> = new Map();

  const rewritten: string[] = lines.map((line: string): string => {
    let text: string = line;
    for (const { criterion, param } of IDENTIFIER_PATTERNS) {
      // The value stops at an underscore or a slash: a query's projection
      // folder is `PatientID:1279049_qid:3125_owner`, and a value that ran on
      // to the end of the word would parameterize the query id too, so the
      // same MRN in a path and in a query would read as two patients.
      const pattern: RegExp = new RegExp(`${criterion}:([^\\s'"/_]+)`, 'g');
      text = text.replace(pattern, (match: string, value: string): string => {
        const held: string | undefined = taken.get(match);
        if (held !== undefined) return `${criterion}:\${${held}}`;
        // A second distinct value for the same criterion gets its own name,
        // or a workflow over two patients would collapse into one.
        const name: string = taken.size === 0 || ![...taken.values()].includes(param)
          ? param
          : `${param}_${taken.size + 1}`;
        taken.set(match, name);
        params.push({ name, was: value });
        return `${criterion}:\${${name}}`;
      });
    }
    return text;
  });

  return { lines: rewritten, params };
}

/**
 * Renders the manifest a recording became.
 *
 * @param name - What to call it.
 * @param lines - The captured lines, already parameterized.
 * @param params - The parameters offered.
 * @returns The file's text.
 */
export function manifest_render(
  name: string,
  lines: string[],
  params: Array<{ name: string; was: string }>,
): string {
  const header: string[] = [
    `@name         ${name}`,
    `@description  Recorded from a session on ${new Date().toISOString().slice(0, 10)}.`,
  ];
  for (const param of params) header.push(`@param        ${param.name} = ${param.was}`);
  return `${[...header, '', ...lines].join('\n')}\n`;
}

/**
 * Builtin handler for the `record` command.
 *
 * @param args - Parsed command arguments.
 * @returns An envelope reporting what the recorder is doing, or what it wrote.
 */
export async function builtin_record(args: string[]): Promise<CommandEnvelope> {
  const parsed: ParsedArgs = commandArgs_process(args);
  const subcommand: string | undefined = parsed._[0];

  if (subcommand === 'start') {
    const target: string | undefined = parsed._[1];
    if (target === undefined) {
      process.exitCode = 1;
      return envelope_error('', undefined, `${chalk.red('Usage: record start <manifest>')}\n`);
    }
    const state: RecorderState = recorder_state();
    if (state.target !== null) {
      process.exitCode = 1;
      return envelope_error('', undefined, `${chalk.red(`record: already recording to ${state.target} — stop it first.`)}\n`);
    }
    const resolved: string = await path_resolve(target);
    recorder_start(resolved);
    return envelope_ok(`${chalk.green(`record: recording to ${resolved}. Do the work; \`record stop\` writes it.`)}\n`);
  }

  if (subcommand === 'stop') {
    const held = recorder_stop();
    if (held === null) {
      process.exitCode = 1;
      return envelope_error('', undefined, `${chalk.red('record: nothing is recording.')}\n`);
    }
    if (held.lines.length === 0) {
      return envelope_ok(`${chalk.yellow(`record: nothing to write — the session ran no lines while recording.`)}\n`);
    }

    const { lines, params } = identifiers_offer(held.lines);
    const name: string = path.posix.basename(held.target).replace(/\.[^.]+$/, '');
    await chefs_mkdir_cmd(path.posix.dirname(held.target));
    const written: boolean = await chefs_touch_cmd(held.target, {
      withContents: manifest_render(name, lines, params),
    });
    if (!written) {
      process.exitCode = 1;
      return envelope_error('', undefined, `${chalk.red(`record: could not write ${held.target}.`)}\n`);
    }

    const recorded: RecordedManifest = {
      path: held.target,
      lines: lines.length,
      params,
      elapsedMs: held.elapsedMs,
    };
    const offered: string = params.length === 0
      ? ''
      : `${chalk.gray(`  offered ${params.length} param${params.length === 1 ? '' : 's'}: `)}${
        params.map((param): string => `${param.was} → \${${param.name}}`).join(', ')}\n`;
    return envelope_ok(
      `${chalk.green(`record: wrote ${held.target} · ${lines.length} line${lines.length === 1 ? '' : 's'}`)}\n${offered}`,
      { kind: RECORD_MODEL_KIND, data: recorded },
    );
  }

  if (subcommand === undefined || subcommand === 'status') {
    const state: RecorderState = recorder_state();
    if (state.target === null) return envelope_ok(`${chalk.gray('Nothing is recording.')}\n`);
    return envelope_ok(
      `${chalk.green(`Recording to ${state.target}`)} ${chalk.gray(`· ${state.lines} line${state.lines === 1 ? '' : 's'} · ${Math.round(state.elapsedMs / 1000)}s`)}\n`,
    );
  }

  process.exitCode = 1;
  return envelope_error('', undefined, `${chalk.red(`Unknown subcommand: ${subcommand}. Usage: record <start|stop|status>`)}\n`);
}
