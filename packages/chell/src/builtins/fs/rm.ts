/**
 * @file Builtin rm command.
 * Removes files or directories.
 */
import chalk from 'chalk';
import path from 'path';
import * as readline from 'readline';
import { path_resolve } from '../utils.js';
import { files_rm as chefs_rm_cmd, RmResult, RmOptions } from '@fnndsc/chili/commands/fs/rm.js';
import { rm_render } from '@fnndsc/chili/views/fs.js';
import { listCache_get } from '@fnndsc/cumin';

/**
 * Prompts the user for confirmation.
 *
 * @param message - The prompt message.
 * @returns A Promise resolving to true if user confirms (y/Y), false otherwise.
 */
async function prompt_confirm(message: string): Promise<boolean> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    rl.question(message, (answer: string) => {
      rl.close();
      const confirmed: boolean = answer.trim().toLowerCase() === 'y';
      resolve(confirmed);
    });
  });
}

/**
 * Removes one or more files or directories.
 *
 * @param args - Command line arguments (flags and paths).
 */
export async function builtin_rm(args: string[]): Promise<void> {
  // Parse flags and paths
  let recursive: boolean = false;
  let force: boolean = false;
  let interactive: boolean = false;
  const pathArgs: string[] = [];
  let endOfOptions: boolean = false;

  for (const arg of args) {
    // Handle -- (end of options)
    if (arg === '--') {
      endOfOptions = true;
      continue;
    }

    // After --, everything is a path
    if (endOfOptions) {
      pathArgs.push(arg);
      continue;
    }

    // Parse flags
    if (arg === '-r' || arg === '-R') {
      recursive = true;
    } else if (arg === '-f') {
      force = true;
    } else if (arg === '-i') {
      interactive = true;
    } else if (arg === '-rf' || arg === '-fr' || arg === '-Rf' || arg === '-fR') {
      recursive = true;
      force = true;
    } else if (arg === '-ri' || arg === '-ir' || arg === '-Ri' || arg === '-iR') {
      recursive = true;
      interactive = true;
    } else if (arg === '-fi' || arg === '-if') {
      force = true;
      interactive = true;
    } else if (arg === '-rfi' || arg === '-rif' || arg === '-fri' || arg === '-fir' || arg === '-irf' || arg === '-ifr') {
      recursive = true;
      force = true;
      interactive = true;
    } else if (!arg.startsWith('-')) {
      pathArgs.push(arg);
    }
  }

  if (pathArgs.length === 0) {
    console.error(chalk.red('Usage: rm [-rf] <path> [path...]'));
    return;
  }

  const options: RmOptions = { recursive, force };
  let successCount: number = 0;
  let failCount: number = 0;

  // Process each path
  for (const pathArg of pathArgs) {
    try {
      const target: string = await path_resolve(pathArg);

      if (target.startsWith('/bin/')) {
        console.error(chalk.red(`rm: cannot remove '${pathArg}': virtual /bin directory`));
        failCount++;
        continue;
      }

      // Interactive prompt
      if (interactive) {
        const confirmed: boolean = await prompt_confirm(`rm: remove '${pathArg}'? (y/n): `);
        if (!confirmed) {
          console.log(chalk.gray(`skipped '${pathArg}'`));
          continue; // Skip this file
        }
      }

      const result: RmResult = await chefs_rm_cmd(target, options);

      if (result.success) {
        // Show success for each file when multiple files
        if (pathArgs.length > 1) {
          console.log(chalk.gray(`removed '${pathArg}'`));
        } else {
          console.log(rm_render(result));
        }
        successCount++;

        // Invalidate cache for parent directory
        const listCache = listCache_get();
        const parentDir: string = path.posix.dirname(target);
        listCache.cache_invalidate(parentDir);
      } else {
        // Always show errors
        console.error(chalk.red(`rm: cannot remove '${pathArg}': ${result.error || 'unknown error'}`));
        failCount++;
      }
    } catch (e: unknown) {
      const msg: string = e instanceof Error ? e.message : String(e);
      console.error(chalk.red(`rm: cannot remove '${pathArg}': ${msg}`));
      failCount++;
    }
  }

  // Print summary only if multiple files
  if (pathArgs.length > 1 && (successCount > 0 || failCount > 0)) {
    console.log('');
    if (successCount > 0 && failCount === 0) {
      console.log(chalk.green(`Successfully removed ${successCount} item${successCount !== 1 ? 's' : ''}`));
    } else if (successCount > 0 && failCount > 0) {
      console.log(chalk.yellow(`Removed ${successCount} item${successCount !== 1 ? 's' : ''}, failed ${failCount}`));
    } else if (failCount > 0) {
      console.log(chalk.red(`Failed to remove ${failCount} item${failCount !== 1 ? 's' : ''}`));
    }
  }
}
