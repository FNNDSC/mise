/**
 * @file What a word names in the virtual `/bin`: a plugin, a pipeline, or
 * both. A bare line and `gather process` resolve a name the same way.
 *
 * @module
 */
import type { ListingItem } from '@fnndsc/menu';
import type { Result } from '@fnndsc/fond';
import { vfs } from '../lib/vfs/vfs.js';

/** The `/bin` entries a word names exactly. */
export interface BinExecutableMatches {
  plugin: ListingItem | undefined;
  pipeline: ListingItem | undefined;
}

/**
 * Finds exact plugin and pipeline executable matches in the virtual `/bin`.
 *
 * @param command - Executable name as typed.
 * @returns Matching dynamic executable entries, if the listing is available.
 */
export async function binExecutableMatches_get(command: string): Promise<BinExecutableMatches> {
  const binResult: Result<ListingItem[]> = await vfs.data_get('/bin');
  if (!binResult.ok) {
    return { plugin: undefined, pipeline: undefined };
  }
  return {
    plugin: binResult.value.find(
      (item: ListingItem): boolean => item.name === command && item.type === 'plugin',
    ),
    pipeline: binResult.value.find(
      (item: ListingItem): boolean => item.name === command && item.type === 'pipeline',
    ),
  };
}
