/**
 * @file Builtin touch command.
 * Creates files.
 */
import chalk from 'chalk';
import path from 'path';
import { ParsedArgs, commandArgs_process, path_resolve } from '../utils.js';
import { files_touch as chefs_touch_cmd, TouchOptions } from '@fnndsc/chili/commands/fs/touch.js';
import { touch_render } from '@fnndsc/chili/views/fs.js';
import { listCache_get, errorStack } from '@fnndsc/cumin';

/**
 * Creates empty files or updates timestamps.
 *
 * @param args - Command line arguments (file paths).
 */
export async function builtin_touch(args: string[]): Promise<void> {
  const parsed: ParsedArgs = commandArgs_process(args);
  const pathArgs: string[] = parsed._ as string[];

  if (pathArgs.length === 0) {
    console.error(chalk.red('Usage: touch [--withContents <string>] [--withContentsFromFile <file>] <file>'));
    return;
  }

  // Build options from parsed flags
  const options: TouchOptions = {};
  if (parsed['withContents']) {
    options.withContents = String(parsed['withContents']);
  }
  if (parsed['withContentsFromFile']) {
    options.withContentsFromFile = String(parsed['withContentsFromFile']);
  }

  // Only process the first file argument when using content options
  const filesToTouch: string[] = (options.withContents || options.withContentsFromFile)
    ? [pathArgs[0]]  // Only one file when injecting content
    : pathArgs;      // Multiple files allowed for empty touch

  for (const pathArg of filesToTouch) {
    try {
      const targetPath: string = await path_resolve(pathArg);
      const success: boolean = await chefs_touch_cmd(targetPath, options);

      if (success) {
        console.log(touch_render(targetPath, success));

        // Invalidate cache for parent directory
        const listCache = listCache_get();
        const parentDir: string = path.posix.dirname(targetPath);
        listCache.cache_invalidate(parentDir);
      } else {
        // Touch failed, display error from errorStack
        const lastError = errorStack.stack_pop();
        if (lastError) {
          console.error(chalk.red(`Failed to create file: ${targetPath}`));
          console.error(chalk.gray(`  ${lastError.message}`));
        } else {
          console.error(chalk.red(`Failed to create file: ${targetPath}`));
        }
      }
    } catch (e: unknown) {
      const msg: string = e instanceof Error ? e.message : String(e);
      console.error(chalk.red(`touch: ${pathArg}: ${msg}`));
    }
  }
}
