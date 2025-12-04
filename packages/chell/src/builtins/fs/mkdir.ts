/**
 * @file Builtin mkdir command.
 * Creates directories.
 */
import chalk from 'chalk';
import path from 'path';
import { path_resolve } from '../utils.js';
import { files_mkdir as chefs_mkdir_cmd } from '@fnndsc/chili/commands/fs/mkdir.js';
import { mkdir_render } from '@fnndsc/chili/views/fs.js';
import { listCache_get, errorStack } from '@fnndsc/cumin';

/**
 * Creates directories.
 *
 * @param args - Command line arguments (directory paths).
 */
export async function builtin_mkdir(args: string[]): Promise<void> {
  if (args.length === 0) {
    console.error(chalk.red('Usage: mkdir <directory> [directory...]'));
    return;
  }

  for (const pathArg of args) {
    try {
      const targetPath: string = await path_resolve(pathArg);
      const success: boolean = await chefs_mkdir_cmd(targetPath);
      console.log(mkdir_render(targetPath, success));

      // Invalidate cache for parent directory
      if (success) {
        const parentDir: string = targetPath.substring(0, targetPath.lastIndexOf('/')) || '/';
        const listCache = listCache_get();
        listCache.cache_invalidate(parentDir);
      }
    } catch (e: unknown) {
      const msg: string = e instanceof Error ? e.message : String(e);
      console.error(chalk.red(`mkdir: ${pathArg}: ${msg}`));
    }
  }
}
