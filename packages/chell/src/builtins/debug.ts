/**
 * @file Debug Command
 *
 * Toggles debug mode for the application, reported as a command envelope.
 */
import chalk from 'chalk';
import { CommandEnvelope, envelope_ok, envelope_error } from '@fnndsc/cumin';
import type { ConnectionConfig } from '@fnndsc/cumin';
import { session } from '../session/index.js';

/**
 * Toggles or displays debug mode status.
 *
 * @param args - Command line arguments: 'on', 'off', or empty to display status.
 * @returns An envelope describing the (possibly updated) debug state.
 */
export async function builtin_debug(args: string[]): Promise<CommandEnvelope> {
  const subcommand: string | undefined = args[0];
  const config: ConnectionConfig | undefined = session.connection.config;

  if (!config) {
    return envelope_error(
      '',
      [{ type: 'error', message: 'Error: Connection configuration not initialized.' }],
      `${chalk.red('Error: Connection configuration not initialized.')}\n`,
    );
  }

  if (!subcommand) {
    const enabled: boolean = config.debug;
    const status: string = enabled ? 'enabled' : 'disabled';
    const detail: string = enabled
      ? chalk.gray('  Verbose error logging is enabled.')
      : chalk.gray('  Verbose error logging is disabled.');
    return envelope_ok(
      `Debug mode: ${chalk.yellow(status)}\n${detail}\n${chalk.gray('\nUsage: debug [on|off]')}\n`,
      { kind: 'sys.debug', data: { enabled } },
    );
  }

  if (subcommand === 'on') {
    config.debug = true;
    return envelope_ok(
      `${chalk.yellow('[!] Debug mode enabled')}\n${chalk.gray('    Verbose error logging activated.')}\n`,
      { kind: 'sys.debug', data: { enabled: true } },
    );
  }

  if (subcommand === 'off') {
    config.debug = false;
    return envelope_ok(
      `${chalk.green('[+] Debug mode disabled')}\n${chalk.gray('    Verbose error logging deactivated.')}\n`,
      { kind: 'sys.debug', data: { enabled: false } },
    );
  }

  return envelope_error(
    `${chalk.red(`Unknown argument: ${subcommand}`)}\n${chalk.gray('Usage: debug [on|off]')}\n`,
  );
}
