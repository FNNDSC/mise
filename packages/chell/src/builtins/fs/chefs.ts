/**
 * @file Builtin chefs command.
 * Legacy/Experimental filesystem primitives.
 */
import chalk from 'chalk';
import path from 'path';
import { commandArgs_process, path_resolve } from '../utils.js';
import { builtin_ls } from './ls.js';
import { builtin_upload } from './upload.js';
import { session } from '../../session/index.js';
import { files_mkdir as chefs_mkdir_cmd } from '@fnndsc/chili/commands/fs/mkdir.js';
import { files_touch as chefs_touch_cmd, TouchOptions } from '@fnndsc/chili/commands/fs/touch.js';
import { mkdir_render, touch_render } from '@fnndsc/chili/views/fs.js';
import { listCache_get, errorStack } from '@fnndsc/cumin';

/**
 * Handles `chefs` subcommands, providing a legacy wrapper for ChRIS Experimental File System primitives.
 *
 * @param args - An array containing the subcommand and its arguments.
 * @returns A Promise that resolves when the `chefs` command processing is complete.
 */
export async function builtin_chefs(args: string[]): Promise<void> {
  const [subcommand, ...subArgs]: string[] = args;
  const currentChrisFolder: string = await session.getCWD();

  try {
    switch (subcommand) {
      case 'pwd':
        console.log(currentChrisFolder);
        break;
      case 'ls':
        await builtin_ls(subArgs);
        break;
      case 'mkdir':
        if (subArgs[0]) {
          const targetPath: string = subArgs[0].startsWith('/')
            ? subArgs[0]
            : await path_resolve(subArgs[0]);
          const success: boolean = await chefs_mkdir_cmd(targetPath);
          console.log(mkdir_render(targetPath, success));

          // Invalidate cache for parent directory
          if (success) {
            const listCache = listCache_get();
            const parentDir: string = path.posix.dirname(targetPath);
            listCache.cache_invalidate(parentDir);
          }
        } else {
          console.log(chalk.red('Usage: chefs mkdir <path>'));
        }
        break;
      case 'touch': {
        const parsed = commandArgs_process(subArgs);
        const pathArgs = parsed._ as string[];

        if (pathArgs.length === 0) {
          console.log(chalk.red('Usage: chefs touch [--withContents <string>] [--withContentsFromFile <file>] <path>'));
          break;
        }

        const targetPath: string = pathArgs[0].startsWith('/')
          ? pathArgs[0]
          : await path_resolve(pathArgs[0]);

        const options: TouchOptions = {};
        if (parsed['withContents']) {
          options.withContents = String(parsed['withContents']);
        }
        if (parsed['withContentsFromFile']) {
          options.withContentsFromFile = String(parsed['withContentsFromFile']);
        }

        const success: boolean = Object.keys(options).length > 0
          ? await chefs_touch_cmd(targetPath, options)
          : await chefs_touch_cmd(targetPath);

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
        break;
      }
      case 'upload':
        await builtin_upload(subArgs);
        break;
      default:
        console.log(chalk.red(`Unknown chefs subcommand: ${subcommand}`));
        break;
    }
  } catch (error: unknown) {
    const msg: string = error instanceof Error ? error.message : String(error);
    console.error(chalk.red(`Chefs command failed: ${msg}`));
  }
}
