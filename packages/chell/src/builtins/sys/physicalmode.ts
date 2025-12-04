/**
 * @file Builtin physicalmode command.
 * Toggles physical filesystem mode.
 */
import chalk from 'chalk';
import { session } from '../../session/index.js';

/**
 * Toggles or displays physical filesystem mode.
 *
 * @param args - Command line arguments: 'on', 'off', or empty to display status.
 */
export async function builtin_physicalmode(args: string[]): Promise<void> {
  const subcommand: string | undefined = args[0];

  if (!subcommand) {
    // Display current status
    const status: string = session.physicalMode_get() ? 'enabled' : 'disabled';
    console.log(`Physical filesystem mode: ${chalk.yellow(status)}`);
    if (session.physicalMode_get()) {
      console.log(chalk.gray('  Paths are used directly without logical-to-physical mapping.'));
    } else {
      console.log(chalk.gray('  Paths are resolved through logical-to-physical mapping.'));
    }
    console.log(chalk.gray('\nUsage: physicalmode [on|off]'));
    return;
  }

  if (subcommand === 'on') {
    session.physicalMode_set(true);
    console.log(chalk.yellow('[!] Physical filesystem mode enabled'));
    console.log(chalk.gray('    Paths will be used directly without logical-to-physical mapping.'));
  } else if (subcommand === 'off') {
    session.physicalMode_set(false);
    console.log(chalk.green('[+] Physical filesystem mode disabled'));
    console.log(chalk.gray('    Paths will be resolved through logical-to-physical mapping.'));
  } else {
    console.log(chalk.red(`Unknown argument: ${subcommand}`));
    console.log(chalk.gray('Usage: physicalmode [on|off]'));
  }
}
