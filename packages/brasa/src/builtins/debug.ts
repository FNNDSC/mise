/**
 * @file Debug Command
 *
 * Toggles the backend's debug mode, reported as a command envelope.
 */
import chalk from 'chalk';
import { backendInstalled_get, type Backend } from '../core/backend.js';
import { CommandEnvelope, envelope_ok, envelope_error } from '@fnndsc/menu';

/**
 * Toggles or displays debug mode status.
 *
 * @param args - Command line arguments: 'on', 'off', or empty to display status.
 * @returns An envelope describing the (possibly updated) debug state.
 */
export async function builtin_debug(args: string[]): Promise<CommandEnvelope> {
  const subcommand: string | undefined = args[0];
  const backend: Backend | null = backendInstalled_get();
  if (backend?.debug_get === undefined || backend.debug_set === undefined) {
    return envelope_error('', undefined, `${chalk.red('debug: this session has no debug mode.')}\n`);
  }
  const enabledNow: boolean | null = backend.debug_get();

  if (enabledNow === null) {
    return envelope_error(
      '',
      [{ type: 'error', message: 'Error: Connection configuration not initialized.' }],
      `${chalk.red('Error: Connection configuration not initialized.')}\n`,
    );
  }

  if (!subcommand) {
    const enabled: boolean = enabledNow;
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
    backend.debug_set(true);
    return envelope_ok(
      `${chalk.yellow('[!] Debug mode enabled')}\n${chalk.gray('    Verbose error logging activated.')}\n`,
      { kind: 'sys.debug', data: { enabled: true } },
    );
  }

  if (subcommand === 'off') {
    backend.debug_set(false);
    return envelope_ok(
      `${chalk.green('[+] Debug mode disabled')}\n${chalk.gray('    Verbose error logging deactivated.')}\n`,
      { kind: 'sys.debug', data: { enabled: false } },
    );
  }

  return envelope_error(
    `${chalk.red(`Unknown argument: ${subcommand}`)}\n${chalk.gray('Usage: debug [on|off]')}\n`,
  );
}
