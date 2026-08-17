/**
 * @file Wildcard expansion for shell commands.
 *
 * Provides glob pattern matching against the ChRIS filesystem.
 *
 * @module
 */
import { minimatch } from 'minimatch';
import { session } from '../session/index.js';
import { ListingItem } from '@fnndsc/chili/models/listing.js';
import { vfsDispatcher } from '@fnndsc/salsa';
import { listCache_get, Result, Ok, Err, errorStack } from '@fnndsc/cumin';

/**
 * Checks if a string contains wildcard characters.
 *
 * @param arg - The argument to check.
 * @returns True if the argument contains wildcards.
 */
export function string_checkHasWildcard(arg: string): boolean {
  return /[*?[\]]/.test(arg);
}

/** A VFS item selected by wildcard expansion. */
export interface WildcardMatch {
  path: string;
  type: ListingItem['type'];
}

/**
 * Expands a wildcard pattern against the current directory with item type.
 *
 * @param pattern - The glob pattern (e.g., "*.ts", "test*.json").
 * @returns A Promise resolving to Result<WildcardMatch[]>.
 *          Ok([]) = no matches (not an error).
 *          Err(...) = couldn't expand (API failure, permission denied, etc.).
 */
export async function wildcard_expandMatches(pattern: string): Promise<Result<WildcardMatch[]>> {
  // If no wildcard, return as-is
  if (!string_checkHasWildcard(pattern)) {
    return Ok([{ path: pattern, type: 'file' }]);
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
    const cached = listCache.cache_get<ListingItem[]>(searchDir);

    if (cached) {
      items = cached.data;
    } else {
      const vfsResult = await vfsDispatcher.list(searchDir);
      if (vfsResult.ok) {
        items = vfsResult.value as unknown as ListingItem[];
        listCache.cache_set(searchDir, items);
      } else {
        return Err();
      }
    }

    // Filter items by pattern
    const matches: WildcardMatch[] = items
      .filter((item: ListingItem) => minimatch(item.name, matchPattern))
      .map((item: ListingItem) => {
        // Return a full path if we searched a different directory.
        const itemPath: string = searchDir !== cwd
          ? `${searchDir}/${item.name}`.replace(/\/+/g, '/')
          : item.name;
        return {
          path: itemPath,
          type: item.type,
        };
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
 * Expands a wildcard pattern against the current directory.
 *
 * @param pattern - The glob pattern (e.g., "*.ts", "test*.json").
 * @returns A Promise resolving to Result<string[]>.
 *          Ok([]) = no matches (not an error).
 *          Err(...) = couldn't expand (API failure, permission denied, etc.).
 */
export async function wildcard_expand(pattern: string): Promise<Result<string[]>> {
  const result: Result<WildcardMatch[]> = await wildcard_expandMatches(pattern);
  if (!result.ok) return result;
  return Ok(result.value.map((match: WildcardMatch) => match.path));
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
