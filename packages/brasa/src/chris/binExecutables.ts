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
 * Finds the plugin and pipeline executables a word names in the virtual `/bin`.
 *
 * The `/bin` name is matched first. A pipeline's `/bin` name carries its
 * CUBE id (`<base>_id<N>`), which differs from one CUBE to the next, so a
 * word nothing in `/bin` is called is then read as a pipeline's own name
 * (`title`, unique per CUBE): a shared manifest can say "FreeSurfer 8.2.0
 * mri_convert per series, DICOM" and run on any CUBE that has it.
 *
 * @param command - Executable name as typed.
 * @returns Matching dynamic executable entries, if the listing is available.
 */
export async function binExecutableMatches_get(command: string): Promise<BinExecutableMatches> {
  const binResult: Result<ListingItem[]> = await vfs.data_get('/bin');
  if (!binResult.ok) {
    return { plugin: undefined, pipeline: undefined };
  }
  const plugin: ListingItem | undefined = binResult.value.find(
    (item: ListingItem): boolean => item.name === command && item.type === 'plugin',
  );
  const pipeline: ListingItem | undefined = binResult.value.find(
    (item: ListingItem): boolean => item.name === command && item.type === 'pipeline',
  );
  if (plugin !== undefined || pipeline !== undefined) return { plugin, pipeline };
  return {
    plugin: undefined,
    pipeline: binResult.value.find(
      (item: ListingItem): boolean => item.type === 'pipeline' && item.title === command,
    ),
  };
}
