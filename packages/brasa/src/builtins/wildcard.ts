/**
 * @file Wildcard expansion for shell commands.
 *
 * Provides glob pattern matching against the ChRIS filesystem.
 *
 * @module
 */
import { minimatch } from 'minimatch';
import { listingItemsFromVfs_make } from '../lib/vfs/listing.js';
import { session } from '../session/index.js';
import type { ListingItem } from '@fnndsc/chili/models/listing.js';
import { path_resolveChrisFs } from '@fnndsc/chili/utils/cli.js';
import { vfsDispatcher } from '@fnndsc/salsa';
import { listCache_get, Result, Ok, Err, errorStack } from '@fnndsc/cumin';
import { ShellWord, shellWord_literal, shellWord_unquoted } from '../lib/parser.js';
import { path_resolve } from './utils.js';

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
 * Expands a rendered pattern and its quote-aware minimatch pattern.
 *
 * @param value - Rendered shell-word value.
 * @param globPattern - Quote-aware minimatch pattern.
 * @returns A Promise resolving to Result<WildcardMatch[]>.
 *          Ok([]) = no matches (not an error).
 *          Err(...) = couldn't expand (API failure, permission denied, etc.).
 */
async function wildcardMatches_expand(
  value: string,
  globPattern: string,
): Promise<Result<WildcardMatch[]>> {
  try {
    // Get current directory
    const cwd: string = await session.getCWD();
    const resolvedValue: string = await path_resolve(value);
    const resolvedPattern: string = await path_resolve(globPattern);

    // Handle patterns with directory components (e.g., "data/*.txt")
    let searchDir: string = cwd;
    let physicalSearchDir: string = cwd;
    let matchPattern: string = resolvedPattern;

    // Resolve the non-wildcard parent directory before listing. This gives
    // `~/...` its normal meaning and follows a CFS `.chrislink` parent while
    // retaining the caller's logical spelling in the expanded result.
    if (resolvedValue.includes('/')) {
      const valueParts: string[] = resolvedValue.split('/');
      const patternParts: string[] = resolvedPattern.split('/');
      const lastPart: string = patternParts.pop() || '*';
      valueParts.pop();
      const dirPart: string = valueParts.join('/');

      searchDir = dirPart || '/';
      physicalSearchDir = await path_resolveChrisFs(searchDir, {});

      matchPattern = lastPart;
    }

    // List files in the directory (check cache first)
    let items: ListingItem[] = [];
    const listCache = listCache_get();
    const cached = listCache.cache_get<ListingItem[]>(physicalSearchDir);

    if (cached) {
      items = cached.data;
    } else {
      const vfsResult = await vfsDispatcher.list(physicalSearchDir);
      if (vfsResult.ok) {
        items = listingItemsFromVfs_make(vfsResult.value);
        listCache.cache_set(physicalSearchDir, items);
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
    errorStack.stack_push("error", `Failed to expand wildcard '${value}': ${errorMsg}`);
    return Err();
  }
}

/**
 * Expands one quote-aware shell word against the ChRIS filesystem.
 *
 * @param word - Parsed shell word.
 * @returns Expanded words, or the original word when it has no match.
 */
export async function shellWord_expand(word: ShellWord): Promise<Result<ShellWord[]>> {
  if (!word.pathnameExpansion) return Ok([word]);

  const result: Result<WildcardMatch[]> = await wildcardMatches_expand(word.value, word.globPattern);
  if (!result.ok) return result;
  if (result.value.length === 0) return Ok([word]);
  return Ok(result.value.map((match: WildcardMatch): ShellWord => ({
    ...shellWord_literal(match.path),
    pathnameExpanded: true,
  })));
}

/**
 * Expands selected quote-aware shell words in argument order.
 *
 * @param words - Parsed shell words.
 * @param eligible - Predicate that preserves explicit cross-realm operands.
 * @returns Expanded words, retaining literal words when no path matches.
 */
export async function shellWords_expand(
  words: readonly ShellWord[],
  eligible: (word: ShellWord, index: number) => boolean,
): Promise<Result<ShellWord[]>> {
  const expanded: ShellWord[] = [];
  for (const [index, word] of words.entries()) {
    if (!eligible(word, index)) {
      expanded.push(word);
      continue;
    }
    const result: Result<ShellWord[]> = await shellWord_expand(word);
    if (!result.ok) return result;
    expanded.push(...result.value);
  }
  return Ok(expanded);
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
  if (!string_checkHasWildcard(pattern)) return Ok([{ path: pattern, type: 'file' }]);
  return wildcardMatches_expand(pattern, pattern);
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
  if (!string_checkHasWildcard(pattern)) return Ok([pattern]);
  const word: ShellWord = shellWord_unquoted(pattern);
  const result: Result<ShellWord[]> = await shellWord_expand(word);
  if (!result.ok) return result;
  if (result.value.length === 1 && result.value[0] === word) return Ok([]);
  return Ok(result.value.map((match: ShellWord) => match.value));
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
  const words: ShellWord[] = args.map((arg: string): ShellWord => shellWord_unquoted(arg));
  const result: Result<ShellWord[]> = await shellWords_expand(words, (): boolean => true);
  if (!result.ok) return result;
  return Ok(result.value.map((word: ShellWord): string => word.value));
}
