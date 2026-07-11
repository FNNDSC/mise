/**
 * @file Delegation to the chili command layer.
 *
 * Unknown commands and several resource builtins hand off to chili. This lives
 * in its own leaf module so both the dispatcher and those builtins can call it
 * without importing each other — dispatch imports the builtins, so routing the
 * delegation through dispatch would close a cycle.
 *
 * @module
 */

import chalk from 'chalk';
import { run as chiliRun } from '@fnndsc/chili/run.js';

/**
 * Runs a chili command in-process.
 *
 * chili shares this process's cumin connection and context, so there is no node
 * subprocess to spawn and no per-command startup cost.
 *
 * @param command - The command to run (e.g., "feeds").
 * @param args - The arguments to pass to the command.
 * @returns A promise resolving when the command completes.
 */
export async function chiliCommand_run(command: string, args: string[]): Promise<void> {
  try {
    await chiliRun([command, ...args]);
  } catch (err) {
    const message: string = err instanceof Error ? err.message : String(err);
    console.error(chalk.red(`chili command '${command}' failed: ${message}`));
  }
}
