/**
 * @file Builtin compute command.
 *
 * Lists compute resources registered with ChRIS CUBE.
 * Subcommands:
 * - `list` — display all available compute resources
 *
 * `compute` and `computes` are both registered in COMMAND_HANDLERS.
 *
 * @module
 */
import chalk from 'chalk';
import { CommandEnvelope, envelope_ok, envelope_error } from '@fnndsc/cumin';
import { commandArgs_process, ParsedArgs } from '../utils.js';
import { computeResources_fetchList, ComputeListResult } from '@fnndsc/chili/commands/compute/list.js';
import { computeFields_fetch } from '@fnndsc/chili/commands/compute/fields.js';
import { computeList_render } from '@fnndsc/chili/views/compute.js';
import { table_render } from '@fnndsc/chili/screen/screen.js';

/**
 * Handles compute commands.
 *
 * @param args - Command arguments.
 * @returns An envelope carrying the compute-resource listing or fields.
 */
export async function builtin_compute(args: string[]): Promise<CommandEnvelope> {
  const parsed: ParsedArgs = commandArgs_process(args);
  const subcommand: string | undefined = parsed._[0];

  if (!subcommand || subcommand === 'list') {
    try {
      const { resources }: ComputeListResult = await computeResources_fetchList();
      return envelope_ok(`${computeList_render(resources, { table: !!parsed.table, csv: !!parsed.csv })}\n`);
    } catch (e: unknown) {
      const msg: string = e instanceof Error ? e.message : String(e);
      process.exitCode = 1;
      return envelope_error('', undefined, `${chalk.red(`compute error: ${msg}`)}\n`);
    }
  }

  if (subcommand === 'inspect') {
    const fields: string[] | null = await computeFields_fetch();
    if (fields && fields.length > 0) {
      return envelope_ok(table_render(fields.map((f: string) => ({ field: f })), ['field'], { title: { title: 'Compute fields', justification: 'center' } }));
    }
    return envelope_ok(`${chalk.gray('No fields found.')}\n`);
  }

  if (subcommand === 'search') {
    return builtin_compute(['list', '--search', parsed._[1] ?? '']);
  }

  process.exitCode = 1;
  return envelope_error(`${chalk.red(`Unknown subcommand: ${subcommand}. Usage: compute <list|search|inspect>`)}\n`);
}
