/**
 * @file Builtin cat command.
 * Displays file contents.
 */
import chalk from 'chalk';
import { path_resolve } from '../utils.js';
import { files_cat as chefs_cat_cmd } from '@fnndsc/chili/commands/fs/cat.js';
import { cat_render } from '@fnndsc/chili/views/fs.js';
import { help_show } from '../help.js';
import { errorStack, Result, StackMessage } from '@fnndsc/cumin';

/**
 * Displays the content of a file.
 *
 * @param args - Command line arguments (file path).
 */
export async function builtin_cat(args: string[]): Promise<void> {
  const pathArg: string | undefined = args[0];
  if (!pathArg) {
     console.error(chalk.red('Usage: cat <file>'));
     return;
  }

  const target: string = await path_resolve(pathArg);

  if (target.startsWith('/bin/')) {
     console.error(chalk.red('Cannot cat plugins yet.'));
     return;
  }

  // Handle /usr/bin/<command> - show help text
  if (target.startsWith('/usr/bin/')) {
     const commandName: string = target.substring('/usr/bin/'.length);
     help_show(commandName);
     return;
  }

  const result: Result<string> = await chefs_cat_cmd(target);

  if (!result.ok) {
     const error: StackMessage | undefined = errorStack.stack_pop();
     console.error(chalk.red(`cat: ${error?.message || 'Unknown error'}`));
     return;
  }

  console.log(cat_render(result.value, pathArg));
}
