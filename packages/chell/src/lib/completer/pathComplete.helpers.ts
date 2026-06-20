/**
 * @file Pure helpers for filesystem path tab-completion.
 *
 * Splits a partial path into the directory to list and the prefix to match, and
 * reconstructs completion strings from matching listing items. Dependency-free
 * (path module only) for easy unit testing.
 *
 * @module
 */
import path from 'path';
import type { ListingItem } from '@fnndsc/chili/models/listing.js';

/**
 * Splits an (already tilde-expanded) partial path into the directory to list
 * and the basename prefix to match against.
 *
 * @param effectivePartial - The tilde-expanded partial path.
 * @returns The directory to list (empty = cwd) and the prefix.
 */
export function partialPath_split(effectivePartial: string): { dirToList: string; prefix: string } {
  if (effectivePartial.endsWith('/')) {
    return { dirToList: effectivePartial, prefix: '' };
  }
  let dirToList: string = path.posix.dirname(effectivePartial);
  const prefix: string = path.posix.basename(effectivePartial);
  if (dirToList === '.') dirToList = ''; // Relative current dir
  return { dirToList, prefix };
}

/**
 * Builds completion strings from listing items, preserving the original
 * partial's style (tilde/relative) and appending `/` to directory-like entries.
 *
 * @param items - The listing items in the target directory.
 * @param prefix - The basename prefix being completed.
 * @param partial - The original (unexpanded) partial the user typed.
 * @returns The completion strings for matching items.
 */
export function completions_build(items: ListingItem[], prefix: string, partial: string): string[] {
  return items
    .filter((i: ListingItem) => i.name.startsWith(prefix))
    .map((hit: ListingItem) => {
      const remainingSegment: string = hit.name.substring(prefix.length);
      let completion: string = partial + remainingSegment;
      if (hit.type === 'dir' || hit.type === 'vfs' || hit.type === 'link') {
        completion += '/';
      }
      return completion;
    });
}
