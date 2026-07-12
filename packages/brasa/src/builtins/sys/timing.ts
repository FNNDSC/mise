/**
 * @file Builtin timing command.
 * Toggles execution timing, reported as a command envelope.
 */
import chalk from 'chalk';
import { CommandEnvelope, envelope_ok, envelope_error } from '@fnndsc/cumin';
import { session } from '../../session/index.js';

/**
 * Toggles or displays command timing mode.
 *
 * @param args - Command line arguments: 'on', 'off', or empty to display status.
 * @returns An envelope describing the (possibly updated) timing state.
 */
export async function builtin_timing(args: string[]): Promise<CommandEnvelope> {
  const subcommand: string | undefined = args[0];

  if (!subcommand) {
    const enabled: boolean = session.timingEnabled_get();
    const status: string = enabled ? 'enabled' : 'disabled';
    const detail: string = enabled
      ? chalk.gray('  Execution times will be displayed after each command.')
      : chalk.gray('  Execution times are hidden.');
    return envelope_ok(
      `Command timing: ${chalk.yellow(status)}\n${detail}\n${chalk.gray('\nUsage: timing [on|off]')}\n`,
      { kind: 'sys.timing', data: { enabled } },
    );
  }

  if (subcommand === 'on') {
    session.timingEnabled_set(true);
    return envelope_ok(
      `${chalk.green('[+] Command timing enabled')}\n${chalk.gray('    Execution times will be displayed after each command.')}\n`,
      { kind: 'sys.timing', data: { enabled: true } },
    );
  }

  if (subcommand === 'off') {
    session.timingEnabled_set(false);
    return envelope_ok(
      `${chalk.gray('[-] Command timing disabled')}\n${chalk.gray('    Execution times will no longer be displayed.')}\n`,
      { kind: 'sys.timing', data: { enabled: false } },
    );
  }

  return envelope_error(
    `${chalk.red(`Unknown argument: ${subcommand}`)}\n${chalk.gray('Usage: timing [on|off]')}\n`,
  );
}
