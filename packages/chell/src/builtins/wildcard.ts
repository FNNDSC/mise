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
import { listCache_get } from '@fnndsc/cumin';

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
 * @returns A Promise resolving to an array of matching paths.
 */
export async function wildcard_expand(pattern: string): Promise<string[]> {
  // If no wildcard, return as-is
  if (!hasWildcard(pattern)) {
    return [pattern];
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
      const cached = listCache.cache_get('/bin');
      if (cached) {
        items = cached;
      } else {
        items = await vfs.getVirtualBinItems();
        listCache.cache_set('/bin', items);
      }
    } else {
      // Check cache for native path
      const cached = listCache.cache_get(searchDir);
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

    // If no matches, return original pattern (let the command handle the error)
    return matches.length > 0 ? matches : [pattern];

  } catch (error: unknown) {
    // On error, return original pattern
    return [pattern];
  }
}

/**
 * Expands all wildcards in an argument list.
 *
 * @param args - The argument list potentially containing wildcards.
 * @returns A Promise resolving to an array with wildcards expanded.
 */
export async function wildcards_expandAll(args: string[]): Promise<string[]> {
  const expanded: string[] = [];

  for (const arg of args) {
    const matches: string[] = await wildcard_expand(arg);
    expanded.push(...matches);
  }

  return expanded;
}
