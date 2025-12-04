/**
 * @file Builtin mv command.
 * Moves or renames files/directories.
 */
import chalk from 'chalk';
import path from 'path';
import { commandArgs_process, path_resolve } from '../utils.js';
import { files_mv as chefs_mv_cmd } from '@fnndsc/chili/commands/fs/mv.js';
import { mv_render } from '@fnndsc/chili/views/fs.js';
import { listCache_get } from '@fnndsc/cumin';

/**
 * Moves or renames a file or directory.
 * Supports multiple sources when destination is a directory.
 *
 * @param args - [src1, src2, ..., dest] or [src, dest]
 */
export async function builtin_mv(args: string[]): Promise<void> {
  const parsed = commandArgs_process(args);
  const pathArgs = parsed._ as string[];

  if (pathArgs.length < 2) {
    console.log(chalk.red('Usage: mv <source...> <dest>'));
    return;
  }

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

      // For multiple sources, show which file we're moving
      if (sources.length > 1) {
        console.log(chalk.gray(`Moving ${srcPath}...`));
      } else {
        console.log(`Moving ${srcPath} to ${destPath}...`);
      }

      const success: boolean = await chefs_mv_cmd(srcPath, destPath);

      if (sources.length === 1) {
        console.log(mv_render(srcPath, destPath, success));
      }

      if (success) {
        successCount++;
        // Invalidate source directory
        const srcDir: string = path.posix.dirname(srcPath);
        listCache.cache_invalidate(srcDir);
      } else {
        failCount++;
      }
    } catch (e: unknown) {
      const msg: string = e instanceof Error ? e.message : String(e);
      console.error(chalk.red(`mv: ${src}: ${msg}`));
      failCount++;
    }
  }

  // Invalidate destination directory (always, since files moved into it)
  listCache.cache_invalidate(destPath);
  const destParent: string = path.posix.dirname(destPath);
  listCache.cache_invalidate(destParent);

  // Summary for multiple files
  if (sources.length > 1) {
    if (failCount === 0) {
      console.log(chalk.green(`✓ Moved ${successCount} file(s) to ${destPath}`));
    } else {
      console.log(chalk.yellow(`⚠ Moved ${successCount} file(s), ${failCount} failed`));
    }
  }
}
