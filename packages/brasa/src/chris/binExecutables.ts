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

/** A bare plugin name resolved to the highest version `/bin` lists for it. */
export interface BinPluginHighest {
  /** The `/bin` entry that runs: `<name>-v<version>`. */
  executable: string;
  /** The highest version. */
  version: string;
  /** Every version `/bin` lists for the name, lowest first. */
  versions: string[];
}

/**
 * Orders two plugin versions: dotted numeric segments as numbers, a missing
 * segment as 0, so `1.10.0` is above `1.9.9`; a segment that is not a number
 * sorts below any number at its place and against its kind as text, so
 * `1.0.4` is above `1.0.4-rc1`.
 *
 * @param a - One version.
 * @param b - Another.
 * @returns Negative when `a` is lower, positive when higher, 0 when equal.
 */
export function pluginVersions_compare(a: string, b: string): number {
  const segments = (version: string): string[] => version.split(/[.\-]/);
  const left: string[] = segments(a);
  const right: string[] = segments(b);
  const length: number = Math.max(left.length, right.length);
  for (let index: number = 0; index < length; index++) {
    const one: string = left[index] ?? '0';
    const other: string = right[index] ?? '0';
    const oneNumber: number = /^\d+$/.test(one) ? Number(one) : NaN;
    const otherNumber: number = /^\d+$/.test(other) ? Number(other) : NaN;
    if (!Number.isNaN(oneNumber) && !Number.isNaN(otherNumber)) {
      if (oneNumber !== otherNumber) return oneNumber - otherNumber;
      continue;
    }
    // A pre-release word where the other side has a number, or has ended
    // (`1.0.4` against `1.0.4-rc1`: the bare one is higher).
    if (Number.isNaN(oneNumber) !== Number.isNaN(otherNumber)) return Number.isNaN(oneNumber) ? -1 : 1;
    if (one !== other) return one < other ? -1 : 1;
  }
  return 0;
}

/**
 * Resolves a bare plugin name to the highest version `/bin` lists for it.
 *
 * `/bin` lists a plugin per version as `<name>-v<version>`, so a bare name
 * matches nothing there by itself. Reading it as "the highest registered
 * version" is derived from CUBE's own state, the same answer for everyone
 * on that CUBE at that moment, and the run's record names the exact version
 * regardless; a pin, when wanted, is the full name (#1303).
 *
 * @param command - The bare name as typed, e.g. `pl-freesurfer`.
 * @returns The executable to run and the versions seen, or null when `/bin`
 *   lists no version of that name.
 */
export async function binPluginHighest_find(command: string): Promise<BinPluginHighest | null> {
  const binResult: Result<ListingItem[]> = await vfs.data_get('/bin');
  if (!binResult.ok) return null;
  const versions: string[] = binResult.value
    .filter((item: ListingItem): boolean => item.type === 'plugin' && item.name.startsWith(`${command}-v`))
    .map((item: ListingItem): string => item.name.slice(command.length + 2))
    .filter((version: string): boolean => version.length > 0)
    .sort(pluginVersions_compare);
  const version: string | undefined = versions[versions.length - 1];
  if (version === undefined) return null;
  return { executable: `${command}-v${version}`, version, versions };
}
