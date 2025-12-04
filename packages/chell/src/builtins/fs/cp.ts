/**
 * @file Builtin cp command.
 * Copies files or directories.
 */
import chalk from 'chalk';
import path from 'path';
import { commandArgs_process, path_resolve } from '../utils.js';
import { files_cp as chefs_cp_cmd, CpOptions } from '@fnndsc/chili/commands/fs/cp.js';
import { cp_render } from '@fnndsc/chili/views/fs.js';
import { listCache_get } from '@fnndsc/cumin';

/**
 * Copies a file or directory.
 * Supports multiple sources when destination is a directory.
 *
 * @param args - [flags, src1, src2, ..., dest]
 */
export async function builtin_cp(args: string[]): Promise<void> {
  const parsed = commandArgs_process(args);
  const pathArgs = parsed._ as string[];

  if (pathArgs.length < 2) {
    console.log(chalk.red('Usage: cp [-r] <source...> <dest>'));
    return;
  }

  const recursive: boolean = !!parsed['r'] || !!parsed['recursive'];

  // Last arg is destination, all others are sources
  const dest: string = pathArgs[pathArgs.length - 1];
  const sources: string[] = pathArgs.slice(0, -1);

  const destPath: string = await path_resolve(dest);
  const listCache = listCache_get();
  let successCount: number = 0;
  let failCount: number = 0;

  for (const src of sources) {
    try {
      const srcPath: string = await path_resolve(src);

      // For multiple sources, show which file we're copying
      if (sources.length > 1) {
        console.log(chalk.gray(`Copying ${srcPath}...`));
      } else {
        console.log(`Copying ${srcPath} to ${destPath}...`);
      }

      const success: boolean = await chefs_cp_cmd(srcPath, destPath, { recursive });

      if (sources.length === 1) {
        console.log(cp_render(srcPath, destPath, success));
      }

      if (success) {
        successCount++;
      } else {
        failCount++;
      }
    } catch (e: unknown) {
      const msg: string = e instanceof Error ? e.message : String(e);
      console.error(chalk.red(`cp: ${src}: ${msg}`));
      failCount++;
    }
  }

  // Invalidate destination directory (always, since files copied into it)
  listCache.cache_invalidate(destPath);
  const destParent: string = path.posix.dirname(destPath);
  listCache.cache_invalidate(destParent);

  // Summary for multiple files
  if (sources.length > 1) {
    if (failCount === 0) {
      console.log(chalk.green(`✓ Copied ${successCount} file(s) to ${destPath}`));
    } else {
      console.log(chalk.yellow(`⚠ Copied ${successCount} file(s), ${failCount} failed`));
    }
  }
}
