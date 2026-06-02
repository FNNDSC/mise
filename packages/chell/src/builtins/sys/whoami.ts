/**
 * @file Builtins whoami and whereami.
 * Quick single-line identity queries.
 */
import chalk from 'chalk';
import { context_getSingle } from '@fnndsc/salsa';
import { SingleContext } from '@fnndsc/cumin';

/**
 * Prints the current authenticated ChRIS username.
 *
 * @param _args - Unused.
 */
export async function builtin_whoami(_args: string[]): Promise<void> {
  const context: SingleContext = await context_getSingle();
  if (context.user) {
    console.log(chalk.cyan(context.user));
  } else {
    console.log(chalk.gray('(not connected)'));
    process.exitCode = 1;
  }
}

/**
 * Prints the current CUBE URI.
 *
 * @param _args - Unused.
 */
export async function builtin_whereami(_args: string[]): Promise<void> {
  const context: SingleContext = await context_getSingle();
  if (context.URL) {
    console.log(chalk.blue(context.URL));
  } else {
    console.log(chalk.gray('(not connected)'));
    process.exitCode = 1;
  }
}
