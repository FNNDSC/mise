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
import { commandArgs_process, ParsedArgs } from '../utils.js';
import { computeResources_fetchList, ComputeListResult } from '@fnndsc/chili/commands/compute/list.js';
import { computeList_render } from '@fnndsc/chili/views/compute.js';

/**
 * Handles compute commands.
 *
 * @param args - Command arguments.
 */
export async function builtin_compute(args: string[]): Promise<void> {
  const parsed: ParsedArgs = commandArgs_process(args);
  const subcommand: string | undefined = parsed._[0];

  if (!subcommand || subcommand === 'list') {
    try {
      const { resources }: ComputeListResult = await computeResources_fetchList();
      console.log(computeList_render(resources, { table: !!parsed.table, csv: !!parsed.csv }));
    } catch (e: unknown) {
      const msg: string = e instanceof Error ? e.message : String(e);
      process.exitCode = 1;
      console.error(chalk.red(`compute error: ${msg}`));
    }
    return;
  }

  process.exitCode = 1;
  console.log(chalk.red(`Unknown subcommand: ${subcommand}. Usage: compute list`));
}
