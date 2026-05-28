/**
 * @file Builtin ls command.
 * Lists directory contents.
 */
import chalk from 'chalk';
import { ParsedArgs, commandArgs_process, path_resolve } from '../utils.js';
import { listCache_get } from '@fnndsc/cumin';
import { session } from '../../session/index.js';
import { vfs } from '../../lib/vfs/vfs.js';

/**
 * Lists the contents of the current or specified directory/files in the ChRIS filesystem context.
 * Supports a virtual `/bin` directory for plugins and multiple paths (e.g., from wildcard expansion).
 *
 * @param args - An array containing target paths (optional).
 * @returns A Promise that resolves when the directory contents are listed.
 */
export async function builtin_ls(args: string[]): Promise<void> {
  const parsed: ParsedArgs = commandArgs_process(args);
  const pathArgsRaw: string[] = parsed._ as string[];

  // Parse sort option
  let sortBy: 'name' | 'size' | 'date' | 'owner' = 'name';
  if (parsed['sort']) {
    const sortValue = String(parsed['sort']);
    if (['name', 'size', 'date', 'owner'].includes(sortValue)) {
      sortBy = sortValue as 'name' | 'size' | 'date' | 'owner';
    }
  }

  let pathArgs: string[] = pathArgsRaw;

  // Check for refresh flag to invalidate cache
  const shouldRefresh = !!parsed['refresh'] || !!parsed['f'];

  const options: {
    long: boolean;
    human: boolean;
    oneColumn: boolean;
    sort: 'name' | 'size' | 'date' | 'owner';
    reverse: boolean;
    directory: boolean;
  } = {
    long: !!parsed['l'],
    human: !!parsed['h'],
    oneColumn: !!parsed['1'],
    sort: sortBy,
    reverse: !!parsed['reverse'] || !!parsed['r'],
    directory: !!parsed['d']
  };

  // If refresh flag is set, aggressively invalidate cache for the target path(s)
  if (shouldRefresh) {
    const listCache = listCache_get();
    if (pathArgs.length === 0) {
      const cwd = await session.getCWD();
      console.log(chalk.gray(`[Cache] Invalidating: ${cwd}`));
      listCache.cache_invalidate(cwd);
      // Also clear entire cache to be extra sure
      listCache.cache_invalidate();
    } else {
      for (const pathArg of pathArgs) {
        const resolvedPath = await path_resolve(pathArg);
        console.log(chalk.gray(`[Cache] Invalidating: ${resolvedPath}`));
        listCache.cache_invalidate(resolvedPath);
      }
      // Also clear entire cache when using -f on specific paths
      listCache.cache_invalidate();
    }
  }

  // If no paths specified, list current directory
  if (pathArgs.length === 0) {
    await vfs.list(undefined, options);
    return;
  }

  // If single path, list it directly (could be file or directory)
  if (pathArgs.length === 1) {
    const target: string = await path_resolve(pathArgs[0]);
    await vfs.list(target, options);
    return;
  }

  // Multiple operands are independent paths, as in Unix ls.
  for (const pathArg of pathArgs) {
    const target: string = await path_resolve(pathArg);
    await vfs.list(target, options);
  }
}
