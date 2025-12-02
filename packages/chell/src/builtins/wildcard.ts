/**
 * @file Wildcard expansion for shell commands.
 *
 * Provides glob pattern matching against the ChRIS filesystem.
 *
 * @module
 */
import { minimatch } from 'minimatch';
import { session } from '../session/index.js';
import { files_list } from '@fnndsc/chili/commands/fs/ls.js';
import { ListingItem } from '@fnndsc/chili/models/listing.js';
import { vfs } from '../lib/vfs/vfs.js';
import { listCache_get, Result, Ok, Err, errorStack } from '@fnndsc/cumin';

/**
 * Checks if a string contains wildcard characters.
 *
 * @param arg - The argument to check.
 * @returns True if the argument contains wildcards.
 */
export function hasWildcard(arg: string): boolean {
  return /[*?[\]]/.test(arg);
}

/**
 * Expands a wildcard pattern against the current directory.
 *
 * @param pattern - The glob pattern (e.g., "*.ts", "test*.json").
 * @returns A Promise resolving to Result<string[]>.
 *          Ok([]) = no matches (not an error).
 *          Err(...) = couldn't expand (API failure, permission denied, etc.).
 */
export async function wildcard_expand(pattern: string): Promise<Result<string[]>> {
  // If no wildcard, return as-is
  if (!hasWildcard(pattern)) {
    return Ok([pattern]);
  }

  try {
    // Get current directory
    const cwd: string = await session.getCWD();

    // Handle patterns with directory components (e.g., "data/*.txt")
    let searchDir: string = cwd;
    let matchPattern: string = pattern;

    // Check if pattern has directory separator
    if (pattern.includes('/')) {
      const parts: string[] = pattern.split('/');
      const lastPart: string = parts.pop() || '*';
      const dirPart: string = parts.join('/');

      // Resolve directory part (could be relative)
      if (dirPart.startsWith('/')) {
        searchDir = dirPart;
      } else if (dirPart === '.') {
        searchDir = cwd;
      } else {
        // Relative path - append to cwd
        searchDir = `${cwd}/${dirPart}`.replace(/\/+/g, '/');
      }

      matchPattern = lastPart;
    }

    // List files in the directory (check cache first)
    let items: ListingItem[] = [];
    const listCache = listCache_get();

    if (searchDir === '/bin') {
      // Check cache for /bin
      const cached: ListingItem[] | null = listCache.cache_get('/bin');
      if (cached) {
        items = cached;
      } else {
        items = await vfs.virtualBinItems_get();
        listCache.cache_set('/bin', items);
      }
    } else {
      // Check cache for native path
      const cached: ListingItem[] | null = listCache.cache_get(searchDir);
      if (cached) {
        items = cached;
      } else {
        items = await files_list({}, searchDir);
        listCache.cache_set(searchDir, items);
      }
    }

    // Filter items by pattern
    const matches: string[] = items
      .filter((item: ListingItem) => minimatch(item.name, matchPattern))
      .map((item: ListingItem) => {
        // Return full path if we searched a different directory
        if (searchDir !== cwd) {
          return `${searchDir}/${item.name}`.replace(/\/+/g, '/');
        }
        return item.name;
      });

    // Ok([]) for no matches (not an error)
    return Ok(matches);

  } catch (error: unknown) {
    const errorMsg: string = error instanceof Error ? error.message : String(error);
    errorStack.stack_push("error", `Failed to expand wildcard '${pattern}': ${errorMsg}`);
    return Err();
  }
}

/**
 * Expands all wildcards in an argument list.
 *
 * @param args - The argument list potentially containing wildcards.
 * @returns A Promise resolving to Result<string[]>.
 *          On error expanding any pattern, returns the error.
 *          Empty matches return the original pattern.
 */
export async function wildcards_expandAll(args: string[]): Promise<Result<string[]>> {
  const expanded: string[] = [];

  for (const arg of args) {
    const result: Result<string[]> = await wildcard_expand(arg);

    if (!result.ok) {
      // Propagate error up
      return result;
    }

    // If no matches, use original pattern (let command handle "not found")
    if (result.value.length === 0) {
      expanded.push(arg);
    } else {
      expanded.push(...result.value);
    }
  }

  return Ok(expanded);
}
