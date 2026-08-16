/**
 * @file Explicit, scoped CUBE elevation for shell commands.
 *
 * The host surface owns credential input; Chili/Salsa/Cumin own the temporary
 * CUBE client. No elevated token is saved or becomes ambient after the nested
 * command completes.
 *
 * @module
 */

import chalk from 'chalk';
import { envelope_error, type CommandEnvelope } from '@fnndsc/cumin';
import { elevation_run } from '@fnndsc/chili/commands/connect/elevation.js';
import { surface_get } from './surface.js';

/** Execution seam used by `sudo` to run its nested command. */
export type ElevatedCommandRunner = (command: string, args: string[]) => Promise<CommandEnvelope>;

/**
 * Detects an authorization failure suitable for an explicit elevation hint.
 *
 * @param message - User-facing failure returned by CUBE.
 * @returns True when the failure denotes missing authorization.
 */
export function authorizationFailure_is(message: string): boolean {
  return /\b(?:401|403)\b|unauthorized|forbidden|permission denied|admin credentials required|administrator privileges/i.test(message);
}

/**
 * Builds the one-line, copyable rerun hint for an elevation-eligible command.
 *
 * @param command - Command name without an existing `sudo` prefix.
 * @param args - Already-tokenized command arguments.
 * @returns A user-facing rerun hint.
 */
export function sudoHint_build(command: string, args: string[]): string {
  return `Try: ${chalk.cyan(`sudo ${[command, ...args].join(' ')}`)}\n`;
}

/**
 * Runs the command nested below `sudo` with a temporary elevated CUBE client.
 *
 * @param args - Nested command name followed by its arguments.
 * @param run - Dispatch seam for the nested command.
 * @returns The nested command result, or an elevation/input error envelope.
 */
export async function sudoCommand_run(
  args: string[],
  run: ElevatedCommandRunner,
): Promise<CommandEnvelope> {
  const [command, ...commandArgs]: string[] = args;
  if (!command) {
    process.exitCode = 1;
    return envelope_error('', undefined, `${chalk.red('Usage: sudo <command> [arguments...]')}\n`);
  }
  if (command === 'sudo') {
    process.exitCode = 1;
    return envelope_error('', undefined, `${chalk.red('sudo: nested elevation is not supported.')}\n`);
  }

  const surface = surface_get();
  if (!surface.capabilities.hiddenInput) {
    process.exitCode = 1;
    return envelope_error('', undefined, `${chalk.red('sudo: this surface cannot securely collect administrator credentials.')}\n`);
  }

  try {
    const username: string = await surface.prompt({ message: 'Administrator username: ' });
    const password: string = await surface.prompt({ message: 'Administrator password: ', hidden: true });
    if (!username || !password) {
      process.exitCode = 1;
      return envelope_error('', undefined, `${chalk.red('sudo: administrator credentials cannot be empty.')}\n`);
    }
    return await elevation_run({ username, password }, async (): Promise<CommandEnvelope> => {
      return await run(command, commandArgs);
    });
  } catch (error: unknown) {
    process.exitCode = 1;
    const message: string = error instanceof Error ? error.message : String(error);
    if (message.includes('cannot securely collect hidden input')) {
      return envelope_error('', undefined, `${chalk.red(`sudo: ${message}`)}\n`);
    }
    return envelope_error('', undefined, `${chalk.red(`sudo: authentication failed: ${message}`)}\n`);
  }
}
