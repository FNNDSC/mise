/**
 * @file Debug Command
 *
 * Toggles debug mode for the application, enabling verbose error logging.
 */
import chalk from 'chalk';
import { session } from '../session/index.js';

/**
 * Toggles or displays debug mode status.
 *
 * @param args - Command line arguments: 'on', 'off', or empty to display status.
 */
export async function builtin_debug(args: string[]): Promise<void> {
  const subcommand: string | undefined = args[0];
  const config = session.connection.config;

  if (!config) {
    console.error(chalk.red('Error: Connection configuration not initialized.'));
    return;
  }

  if (!subcommand) {
    // Display current status
    const status: string = config.debug ? 'enabled' : 'disabled';
    console.log(`Debug mode: ${chalk.yellow(status)}`);
    if (config.debug) {
      console.log(chalk.gray('  Verbose error logging is enabled.'));
    } else {
      console.log(chalk.gray('  Verbose error logging is disabled.'));
    }
    console.log(chalk.gray('\nUsage: debug [on|off]'));
    return;
  }

  if (subcommand === 'on') {
    config.debug = true;
    console.log(chalk.yellow('[!] Debug mode enabled'));
    console.log(chalk.gray('    Verbose error logging activated.'));
  } else if (subcommand === 'off') {
    config.debug = false;
    console.log(chalk.green('[+] Debug mode disabled'));
    console.log(chalk.gray('    Verbose error logging deactivated.'));
  } else {
    console.log(chalk.red(`Unknown argument: ${subcommand}`));
    console.log(chalk.gray('Usage: debug [on|off]'));
  }
}
