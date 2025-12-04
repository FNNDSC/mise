/**
 * @file Builtin timing command.
 * Toggles execution timing.
 */
import chalk from 'chalk';
import { session } from '../../session/index.js';

/**
 * Toggles or displays command timing mode.
 *
 * @param args - Command line arguments: 'on', 'off', or empty to display status.
 */
export async function builtin_timing(args: string[]): Promise<void> {
  const subcommand: string | undefined = args[0];

  if (!subcommand) {
    // Display current status
    const status: string = session.timingEnabled_get() ? 'enabled' : 'disabled';
    console.log(`Command timing: ${chalk.yellow(status)}`);
    if (session.timingEnabled_get()) {
      console.log(chalk.gray('  Execution times will be displayed after each command.'));
    } else {
      console.log(chalk.gray('  Execution times are hidden.'));
    }
    console.log(chalk.gray('\nUsage: timing [on|off]'));
    return;
  }

  if (subcommand === 'on') {
    session.timingEnabled_set(true);
    console.log(chalk.green('[+] Command timing enabled'));
    console.log(chalk.gray('    Execution times will be displayed after each command.'));
  } else if (subcommand === 'off') {
    session.timingEnabled_set(false);
    console.log(chalk.gray('[-] Command timing disabled'));
    console.log(chalk.gray('    Execution times will no longer be displayed.'));
  } else {
    console.log(chalk.red(`Unknown argument: ${subcommand}`));
    console.log(chalk.gray('Usage: timing [on|off]'));
  }
}
