/**
 * @file The session's cohort, as the kernel holds it.
 *
 * A cohort is the set of things a session is working on — a PACS series
 * still at the modality, a directory of uploads, one file — gathered so
 * that one act can be taken over all of them. It belongs to the SESSION,
 * not to a surface: it outlives a page refresh, a second surface attached
 * to the same session sees the same one, and a command line reaches it
 * without a browser in the room.
 *
 * Membership is keyed by PATH. A series, a directory and a file are all
 * addressable, so one identity rule covers every kind, gathering the same
 * thing twice merges rather than doubles, and `gather remove` takes the
 * same operand whatever it is removing.
 *
 * The cohort lives as a working file in the ChRIS filesystem, in the shape
 * the surface already wrote, so the two read each other's cohorts without
 * a migration. Fields this layer does not understand are preserved across
 * a rewrite: the surface knows things about a series that the kernel has
 * no name for, and a kernel write must not quietly forget them.
 *
 * @module
 */
import path from 'path';
import { listCache_get } from '@fnndsc/cumin';
import type { ListCache, Result } from '@fnndsc/cumin';
import { fileContent_get, files_path_isDirectory } from '@fnndsc/salsa';
import { files_touch as chefs_touch_cmd } from '@fnndsc/chili/commands/fs/touch.js';
import { files_mkdir as chefs_mkdir_cmd } from '@fnndsc/chili/commands/fs/mkdir.js';
import { path_resolve } from '../utils.js';

/** Where the session keeps the cohort it is working on. */
export const COHORT_FILE: string = '~/gather/current.json';

/** The directory that holds it, created on first write. */
export const COHORT_DIR: string = '~/gather';

/** What a member IS, which decides which verbs can act on it. */
export type GatherKind = 'series' | 'dir' | 'file';

/**
 * One gathered thing.
 *
 * `vfsPath` is the identity and the only field the kernel requires; the
 * rest is what a sighting happened to know. The index signature is not
 * laxity — it is the promise that a surface's richer record survives a
 * kernel rewrite untouched.
 */
export interface GatherMember {
  /** The member's address, and its identity within the cohort. */
  vfsPath: string;
  /** Series, directory or file. */
  kind: GatherKind;
  /** The series UID, when the member is one. */
  seriesUID?: string;
  /** What the member is called where it came from. */
  description?: string;
  /** The modality, for a series. */
  modality?: string;
  /** The patient it came from, for a series. */
  patient?: string;
  /** The study it came from, for a series. */
  study?: string;
  /** Whether the member is imagery: a series always is, a place sometimes. */
  imagery?: boolean;
  /** Its ChRIS folder once CUBE has said where it landed. */
  folderPath?: string;
  /** How many files it holds, when the source said. */
  files?: number;
  /** Anything a surface knows and the kernel does not, kept across a write. */
  [extra: string]: unknown;
}

/** The feed a cohort was rooted in: its id, and the root a run appends to. */
export interface GatherFeed {
  feedId: number;
  rootInstanceId: number;
  path: string;
}

/**
 * The whole cohort as it is kept on disk.
 *
 * The member array is named `series` because that is what the surface
 * wrote before members had kinds, and a rename would strand every cohort
 * a session is currently holding for no gain.
 */
export interface GatherState {
  version: number;
  name: string | null;
  feed: GatherFeed | null;
  series: GatherMember[];
}

/** An empty cohort: what a session that has gathered nothing holds. */
export function cohortState_empty(): GatherState {
  return { version: 1, name: null, feed: null, series: [] };
}

/**
 * The identity of one member.
 *
 * Path first, falling back to the series UID for a record written before
 * membership was path-keyed, so an older cohort still de-duplicates.
 *
 * @param member - The member to key.
 * @returns Its identity within the cohort.
 */
export function member_key(member: GatherMember): string {
  const address: unknown = member.vfsPath;
  if (typeof address === 'string' && address.length > 0) return address;
  const uid: unknown = member.seriesUID;
  return typeof uid === 'string' ? uid : '';
}

/**
 * Fills in what an older or partial record left out.
 *
 * A record written before kinds existed is a series, which is what every
 * member was then; a record written before paths were identity carries its
 * address in `seriesUID`.
 *
 * @param raw - One entry as the file held it.
 * @returns The same entry, normalized.
 */
function member_normalize(raw: GatherMember): GatherMember {
  const normalized: GatherMember = { ...raw };
  if (typeof normalized.vfsPath !== 'string' || normalized.vfsPath.length === 0) {
    normalized.vfsPath = typeof raw.seriesUID === 'string' ? raw.seriesUID : '';
  }
  if (normalized.kind !== 'dir' && normalized.kind !== 'file' && normalized.kind !== 'series') {
    normalized.kind = 'series';
  }
  return normalized;
}

/**
 * Reads the cohort the session is working on.
 *
 * An unreadable or unparseable file answers an EMPTY cohort rather than an
 * error: this is a working file the operator may have edited, and a cohort
 * that cannot be read is not a reason to refuse the command.
 *
 * @returns The cohort, normalized.
 */
export async function cohort_read(): Promise<GatherState> {
  try {
    const resolved: string = await path_resolve(COHORT_FILE);
    const content: Result<string> = await fileContent_get(resolved);
    if (!content.ok) return cohortState_empty();
    const held: Partial<GatherState> = JSON.parse(content.value) as Partial<GatherState>;
    const members: GatherMember[] = Array.isArray(held.series)
      ? held.series.map(member_normalize).filter((m: GatherMember): boolean => m.vfsPath.length > 0)
      : [];
    return {
      version: typeof held.version === 'number' ? held.version : 1,
      name: typeof held.name === 'string' ? held.name : null,
      feed: (held.feed ?? null) as GatherFeed | null,
      series: members,
    };
  } catch {
    return cohortState_empty();
  }
}

/**
 * Writes the cohort back, and tells the listing cache the folder changed.
 *
 * Without the invalidation an `ls ~/gather` right after a gather serves the
 * listing from before the write and the operator is told their cohort does
 * not exist — the same staleness a CSV export once showed.
 *
 * @param state - The cohort to keep.
 */
export async function cohort_write(state: GatherState): Promise<void> {
  const directory: string = await path_resolve(COHORT_DIR);
  await chefs_mkdir_cmd(directory);
  const target: string = await path_resolve(COHORT_FILE);
  await chefs_touch_cmd(target, { withContents: JSON.stringify(state) });
  const cache: ListCache = listCache_get();
  cache.cache_invalidate(path.posix.dirname(target));
}

/**
 * Says what a path IS, by asking rather than by guessing at its spelling.
 *
 * A PACS projection is a series: the query answer's own addresses are the
 * only things in the tree that name one. Everything else is asked of the
 * filesystem, and what is not a directory is a file.
 *
 * @param address - A resolved VFS path.
 * @returns The member kind to record, or null when nothing is at the path.
 */
export async function pathKind_determine(address: string): Promise<GatherKind | null> {
  if (address.startsWith('/net/pacs/')) return 'series';
  try {
    if (await files_path_isDirectory(address)) return 'dir';
    // Not a directory is not the same as a file: a path that names nothing
    // must not be gathered as one, or a typo becomes a member a run would
    // be handed and refused on. Its parent is asked whether it is there.
    const parent: string = path.posix.dirname(address);
    const leaf: string = path.posix.basename(address);
    const listed: Result<string[]> = await folderEntries_list(parent);
    if (!listed.ok || !listed.value.includes(leaf)) return null;
    return 'file';
  } catch {
    return null;
  }
}

/**
 * The names a folder holds, files and folders alike.
 *
 * @param folder - The folder to list.
 * @returns Its entries' names, or a refusal when it cannot be listed.
 */
async function folderEntries_list(folder: string): Promise<Result<string[]>> {
  const { vfsDispatcher } = await import('@fnndsc/salsa');
  const listed = await vfsDispatcher.list(folder);
  if (!listed.ok) return { ok: false };
  return { ok: true, value: listed.value.map((item: { name: string }): string => item.name) };
}

/**
 * The series UID a PACS projection path names, when it names one.
 *
 * @param address - A resolved VFS path.
 * @returns The UID, or undefined when the path is not a series projection.
 */
export function seriesUID_ofPath(address: string): string | undefined {
  const leaf: string = path.posix.basename(address);
  return /^[0-9]+(\.[0-9]+)+$/.test(leaf) ? leaf : undefined;
}

/**
 * Takes members into a cohort, merging what a later sighting knows.
 *
 * @param held - The members already in the cohort, in gather order.
 * @param incoming - The members being taken.
 * @returns The new membership, and how many were new rather than merged.
 */
export function members_merge(
  held: GatherMember[],
  incoming: GatherMember[],
): { members: GatherMember[]; added: number; merged: number } {
  const byKey: Map<string, GatherMember> = new Map(
    held.map((member: GatherMember): [string, GatherMember] => [member_key(member), member]),
  );
  let added: number = 0;
  let merged: number = 0;
  for (const member of incoming) {
    const key: string = member_key(member);
    if (key.length === 0) continue;
    const existing: GatherMember | undefined = byKey.get(key);
    if (existing === undefined) {
      byKey.set(key, member);
      added += 1;
      continue;
    }
    byKey.set(key, { ...existing, ...member });
    merged += 1;
  }
  return { members: [...byKey.values()], added, merged };
}

/**
 * Drops members by identity.
 *
 * @param held - The current membership.
 * @param keys - Identities to drop.
 * @returns The remaining members, and the identities that matched nothing.
 */
export function members_drop(
  held: GatherMember[],
  keys: string[],
): { members: GatherMember[]; dropped: number; missing: string[] } {
  const wanted: Set<string> = new Set(keys);
  const kept: GatherMember[] = [];
  const hit: Set<string> = new Set();
  for (const member of held) {
    const key: string = member_key(member);
    if (wanted.has(key)) { hit.add(key); continue; }
    kept.push(member);
  }
  return {
    members: kept,
    dropped: held.length - kept.length,
    missing: keys.filter((key: string): boolean => !hit.has(key)),
  };
}
