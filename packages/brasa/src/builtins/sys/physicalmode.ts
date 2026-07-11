/**
 * @file Builtin physicalmode command.
 * Toggles physical filesystem mode, reported as a command envelope.
 */
import chalk from 'chalk';
import { CommandEnvelope, envelope_ok, envelope_error } from '@fnndsc/cumin';
import { session } from '../../session/index.js';

/**
 * Toggles or displays physical filesystem mode.
 *
 * @param args - Command line arguments: 'on', 'off', or empty to display status.
 * @returns An envelope describing the (possibly updated) physical mode state.
 */
export async function builtin_physicalmode(args: string[]): Promise<CommandEnvelope> {
  const subcommand: string | undefined = args[0];

  if (!subcommand) {
    const enabled: boolean = session.physicalMode_get();
    const status: string = enabled ? 'enabled' : 'disabled';
    const detail: string = enabled
      ? chalk.gray('  Paths are used directly without logical-to-physical mapping.')
      : chalk.gray('  Paths are resolved through logical-to-physical mapping.');
    return envelope_ok(
      `Physical filesystem mode: ${chalk.yellow(status)}\n${detail}\n${chalk.gray('\nUsage: physicalmode [on|off]')}\n`,
      { kind: 'sys.physicalMode', data: { enabled } },
    );
  }

  if (subcommand === 'on') {
    session.physicalMode_set(true);
    return envelope_ok(
      `${chalk.yellow('[!] Physical filesystem mode enabled')}\n${chalk.gray('    Paths will be used directly without logical-to-physical mapping.')}\n`,
      { kind: 'sys.physicalMode', data: { enabled: true } },
    );
  }

  if (subcommand === 'off') {
    session.physicalMode_set(false);
    return envelope_ok(
      `${chalk.green('[+] Physical filesystem mode disabled')}\n${chalk.gray('    Paths will be resolved through logical-to-physical mapping.')}\n`,
      { kind: 'sys.physicalMode', data: { enabled: false } },
    );
  }

  return envelope_error(
    `${chalk.red(`Unknown argument: ${subcommand}`)}\n${chalk.gray('Usage: physicalmode [on|off]')}\n`,
  );
}
