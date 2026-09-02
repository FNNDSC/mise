/**
 * @file Persistent checkpoints for the daemon process index.
 *
 * The checkpoint is a directory of shards under an identity-keyed,
 * mode-0700 folder: `roster.json` (the feed index) and one `feed-<id>.json`
 * per feed that holds topology. A mutation to one feed rewrites one shard,
 * so a growing 80k-node feed never drags the whole index back to disk, and
 * a torn write can damage at most one feed. Every file is mode 0600 and
 * written with a same-directory atomic rename.
 *
 * Restore reads the roster and every shard, assembles one snapshot, and
 * validates it whole before replacing live cache state — a shard whose feed
 * is not in the roster is an orphan and is ignored. A legacy single-file v2
 * checkpoint is read once and migrated into shards.
 *
 * The watcher persists what changed, throttled per shard: a shard is
 * written no more than once per {@link PROC_CHECKPOINT_FLOOR_MS}, and never
 * later than that after its first pending mutation.
 *
 * @module
 */
import { createHash, randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import { homedir } from 'os';
import { dirname, join } from 'path';
import {
  procCache_get,
  status_isTerminal,
  type ProcCacheChange,
  type ProcCacheSnapshot,
  type ProcFeed,
  type ProcFeedSnapshot,
  type ProcInstance,
} from './procCache';
import { errorStack } from '../error/errorStack';

// v3: per-feed shards. v2 (one file, instances with metrics) is still read
// for migration; v1 never carried metrics and is not read.
const PROC_CHECKPOINT_SCHEMA: number = 3;
const LEGACY_CHECKPOINT_SCHEMA: number = 2;
const ROSTER_FILE: string = 'roster.json';
const SHARD_PATTERN: RegExp = /^feed-(\d+)\.json$/;

/** Minimum spacing between two writes of the same shard. */
export const PROC_CHECKPOINT_FLOOR_MS: number = 30 * 1000;

interface LegacyCheckpointFile {
  schemaVersion: number;
  identity: string;
  writtenAt: string;
  snapshot: ProcCacheSnapshot;
}

interface RosterFile {
  schemaVersion: number;
  identity: string;
  writtenAt: string;
  feeds: ProcFeed[];
}

interface ShardFile {
  schemaVersion: number;
  identity: string;
  writtenAt: string;
  feedID: number;
  loaded: boolean;
  instances: ProcInstance[];
}

/**
 * Outcome of attempting to restore a local process-cache checkpoint.
 *
 * @property restored - Whether validated snapshot data replaced the cache.
 * @property count - Number of restored plugin instances.
 * @property writtenAt - Checkpoint creation time when restoration succeeded.
 * @property reason - Human-readable reason when restoration was skipped.
 * @property migrated - True when a legacy single-file checkpoint was
 *   converted into shards during this restore.
 */
export interface ProcCheckpointRestoreResult {
  restored: boolean;
  count: number;
  writtenAt?: string;
  reason?: string;
  migrated?: boolean;
}

/** Returns the default directory for persistent process-cache files. */
function procCheckpointRoot_get(): string {
  const cacheHome: string = process.env.XDG_CACHE_HOME ?? join(homedir(), '.cache');
  return join(cacheHome, 'chell', 'proc');
}

/** Hashes an identity into a short, non-revealing directory key. */
function identityKey_get(identity: string): string {
  return createHash('sha256').update(identity).digest('hex').slice(0, 16);
}

/**
 * Builds the legacy (v2, single-file) checkpoint path for an identity.
 *
 * @param identity - Canonical ChRIS identity string.
 * @param root - Checkpoint directory override.
 * @returns The v2 file path, read only for migration.
 */
export function procCheckpointPath_get(identity: string, root: string = procCheckpointRoot_get()): string {
  return join(root, `proc-${identityKey_get(identity)}-v${LEGACY_CHECKPOINT_SCHEMA}.json`);
}

/**
 * Builds the identity-keyed checkpoint directory without exposing the identity.
 *
 * @param identity - Canonical ChRIS identity string.
 * @param root - Checkpoint directory override.
 * @returns The directory holding `roster.json` and the feed shards.
 */
export function procCheckpointDir_get(identity: string, root: string = procCheckpointRoot_get()): string {
  return join(root, identityKey_get(identity));
}

/** Path of one feed's shard inside a checkpoint directory. */
function shardPath_get(dir: string, feedID: number): string {
  return join(dir, `feed-${feedID}.json`);
}

/** Reports whether a value is a finite integer. */
function integer_check(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value);
}

/** Reports whether a value is a structurally valid persisted feed. */
function procFeed_check(value: unknown): value is ProcFeed {
  if (!value || typeof value !== 'object') return false;
  const feed: Partial<ProcFeed> = value as Partial<ProcFeed>;
  return integer_check(feed.id) &&
    typeof feed.title === 'string' &&
    typeof feed.ownerUsername === 'string' &&
    typeof feed.public === 'boolean' &&
    typeof feed.creationDate === 'string' &&
    integer_check(feed.finishedJobs) &&
    integer_check(feed.erroredJobs) &&
    integer_check(feed.startedJobs) &&
    integer_check(feed.scheduledJobs) &&
    integer_check(feed.cancelledJobs) &&
    integer_check(feed.createdJobs);
}

/** Reports whether a value is a structurally valid persisted instance. */
function procInstance_check(value: unknown): value is ProcInstance {
  if (!value || typeof value !== 'object') return false;
  const instance: Partial<ProcInstance> = value as Partial<ProcInstance>;
  const parentValid: boolean = instance.parentID === null || integer_check(instance.parentID);
  const pluginTypeValid: boolean = instance.pluginType === undefined || typeof instance.pluginType === 'string';
  const statusValid: boolean = instance.status === null ||
    (typeof instance.status === 'string' && status_isTerminal(instance.status));
  const joinsValid: boolean = instance.joinParentIDs === undefined ||
    (Array.isArray(instance.joinParentIDs) && instance.joinParentIDs.every(integer_check));
  const metricsValid: boolean =
    (instance.startedAt === undefined || typeof instance.startedAt === 'string') &&
    (instance.finishedAt === undefined || typeof instance.finishedAt === 'string') &&
    (instance.outputBytes === undefined || typeof instance.outputBytes === 'number');
  return metricsValid &&
    integer_check(instance.id) &&
    integer_check(instance.feedID) &&
    parentValid &&
    typeof instance.pluginName === 'string' &&
    pluginTypeValid &&
    instance.params === null &&
    statusValid &&
    joinsValid;
}

/**
 * Validates all snapshot fields and graph relationships before restoration.
 *
 * @param value - Parsed checkpoint snapshot candidate.
 * @returns True when feeds, instances, loaded markers, and parent graphs are safe.
 */
function procCacheSnapshot_check(value: unknown): value is ProcCacheSnapshot {
  if (!value || typeof value !== 'object') return false;
  const snapshot: Partial<ProcCacheSnapshot> = value as Partial<ProcCacheSnapshot>;
  if (!Array.isArray(snapshot.feeds) ||
      !Array.isArray(snapshot.instances) ||
      !Array.isArray(snapshot.topologyLoaded) ||
      !snapshot.feeds.every(procFeed_check) ||
      !snapshot.instances.every(procInstance_check) ||
      !snapshot.topologyLoaded.every(integer_check)) {
    return false;
  }

  const feedIDs: Set<number> = new Set(snapshot.feeds.map((feed: ProcFeed): number => feed.id));
  const instanceByID: Map<number, ProcInstance> = new Map(
    snapshot.instances.map((instance: ProcInstance): [number, ProcInstance] => [instance.id, instance]),
  );
  if (feedIDs.size !== snapshot.feeds.length ||
      instanceByID.size !== snapshot.instances.length ||
      new Set(snapshot.topologyLoaded).size !== snapshot.topologyLoaded.length ||
      snapshot.topologyLoaded.some((feedID: number): boolean => !feedIDs.has(feedID))) {
    return false;
  }

  for (const instance of snapshot.instances) {
    if (!feedIDs.has(instance.feedID)) return false;
    const parent: ProcInstance | undefined = instance.parentID === null
      ? undefined
      : instanceByID.get(instance.parentID);
    if (instance.parentID !== null && (!parent || parent.feedID !== instance.feedID)) return false;
    if (instance.joinParentIDs?.some((id: number): boolean => {
      const joinParent: ProcInstance | undefined = instanceByID.get(id);
      return !joinParent || joinParent.feedID !== instance.feedID || id === instance.id;
    })) return false;

    const ancestors: Set<number> = new Set([instance.id]);
    let ancestor: ProcInstance | undefined = parent;
    while (ancestor) {
      if (ancestors.has(ancestor.id)) return false;
      ancestors.add(ancestor.id);
      ancestor = ancestor.parentID === null ? undefined : instanceByID.get(ancestor.parentID);
    }
  }
  return true;
}

/** Shared header checks for any checkpoint file of the current schema. */
function header_check(value: unknown, identity: string): value is { identity: string; writtenAt: string } {
  if (!value || typeof value !== 'object') return false;
  const file: Partial<RosterFile> = value as Partial<RosterFile>;
  return file.schemaVersion === PROC_CHECKPOINT_SCHEMA &&
    file.identity === identity &&
    typeof file.writtenAt === 'string' &&
    !Number.isNaN(Date.parse(file.writtenAt));
}

/** Reports whether parsed JSON is a compatible roster file for an identity. */
function rosterFile_check(value: unknown, identity: string): value is RosterFile {
  return header_check(value, identity) && Array.isArray((value as Partial<RosterFile>).feeds);
}

/** Reports whether parsed JSON is a compatible shard file for an identity. */
function shardFile_check(value: unknown, identity: string): value is ShardFile {
  if (!header_check(value, identity)) return false;
  const file: Partial<ShardFile> = value as Partial<ShardFile>;
  return integer_check(file.feedID) && typeof file.loaded === 'boolean' && Array.isArray(file.instances);
}

/** Reports whether parsed JSON is a compatible legacy (v2) checkpoint for an identity. */
function legacyFile_check(value: unknown, identity: string): value is LegacyCheckpointFile {
  if (!value || typeof value !== 'object') return false;
  const file: Partial<LegacyCheckpointFile> = value as Partial<LegacyCheckpointFile>;
  return file.schemaVersion === LEGACY_CHECKPOINT_SCHEMA &&
    file.identity === identity &&
    typeof file.writtenAt === 'string' &&
    !Number.isNaN(Date.parse(file.writtenAt)) &&
    procCacheSnapshot_check(file.snapshot);
}

/** Reads and parses one JSON file; null when it does not exist. */
async function json_read(path: string): Promise<unknown> {
  try {
    return JSON.parse(await fs.readFile(path, 'utf8'));
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

/** Writes one mode-0600 JSON file through a same-directory atomic rename. */
async function json_write(path: string, value: unknown): Promise<void> {
  const temporaryPath: string = `${path}.${process.pid}-${randomUUID()}.tmp`;
  await fs.writeFile(temporaryPath, `${JSON.stringify(value)}\n`, { encoding: 'utf8', mode: 0o600 });
  await fs.rename(temporaryPath, path);
  await fs.chmod(path, 0o600);
}

/** Ensures the checkpoint directory exists, private to the user. */
async function dir_ensure(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  await fs.chmod(dirname(dir), 0o700);
  await fs.chmod(dir, 0o700);
}

/**
 * Assembles the sharded checkpoint into one snapshot. Shards whose feed is
 * absent from the roster are orphans (a feed removed after its shard was
 * written) and are skipped; a shard that fails its own header check is
 * skipped too, so one bad file costs one feed, not the checkpoint.
 *
 * @param dir - The checkpoint directory.
 * @param identity - Canonical ChRIS identity string.
 * @returns The assembled snapshot with its roster's write time, or null
 *   when there is no roster.
 */
async function shards_assemble(
  dir: string,
  identity: string,
): Promise<{ snapshot: ProcCacheSnapshot; writtenAt: string } | null> {
  const roster: unknown = await json_read(join(dir, ROSTER_FILE));
  if (roster === null) return null;
  if (!rosterFile_check(roster, identity)) throw new Error('incompatible checkpoint');
  if (!roster.feeds.every(procFeed_check)) throw new Error('incompatible checkpoint');
  const feedIDs: Set<number> = new Set(roster.feeds.map((feed: ProcFeed): number => feed.id));

  const snapshot: ProcCacheSnapshot = { feeds: roster.feeds, instances: [], topologyLoaded: [] };
  let skipped: number = 0;
  for (const name of await fs.readdir(dir)) {
    const match: RegExpMatchArray | null = SHARD_PATTERN.exec(name);
    if (!match) continue;
    const feedID: number = Number(match[1]);
    if (!feedIDs.has(feedID)) { skipped++; continue; }
    const shard: unknown = await json_read(join(dir, name));
    if (!shardFile_check(shard, identity) || shard.feedID !== feedID) { skipped++; continue; }
    snapshot.instances.push(...shard.instances);
    if (shard.loaded) snapshot.topologyLoaded.push(feedID);
  }
  if (skipped > 0) {
    errorStack.stack_push('warning', `proc checkpoint: ${skipped} feed shard(s) skipped (orphaned or unreadable)`);
  }
  return { snapshot, writtenAt: roster.writtenAt };
}

/**
 * Restores a matching, fully validated checkpoint into the process cache.
 * A sharded (v3) checkpoint is preferred; failing that, a legacy single-file
 * v2 checkpoint is restored and migrated into shards.
 *
 * @param identity - Canonical ChRIS identity string.
 * @param root - Checkpoint directory override.
 * @returns Restoration outcome without throwing for absent or invalid files.
 */
export async function procCheckpoint_restore(
  identity: string,
  root: string = procCheckpointRoot_get(),
): Promise<ProcCheckpointRestoreResult> {
  const dir: string = procCheckpointDir_get(identity, root);
  try {
    const assembled: { snapshot: ProcCacheSnapshot; writtenAt: string } | null = await shards_assemble(dir, identity);
    if (assembled) {
      if (!procCacheSnapshot_check(assembled.snapshot)) {
        return { restored: false, count: 0, reason: 'incompatible checkpoint' };
      }
      procCache_get().snapshot_restore(assembled.snapshot, assembled.writtenAt);
      return { restored: true, count: assembled.snapshot.instances.length, writtenAt: assembled.writtenAt };
    }

    const legacy: unknown = await json_read(procCheckpointPath_get(identity, root));
    if (legacy === null) return { restored: false, count: 0, reason: 'no checkpoint' };
    if (!legacyFile_check(legacy, identity)) {
      return { restored: false, count: 0, reason: 'incompatible checkpoint' };
    }
    procCache_get().snapshot_restore(legacy.snapshot, legacy.writtenAt);
    await procCheckpoint_save(identity, root);
    return { restored: true, count: legacy.snapshot.instances.length, writtenAt: legacy.writtenAt, migrated: true };
  } catch (error: unknown) {
    return {
      restored: false,
      count: 0,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Whether the in-memory roster is internally consistent: every feed whose
 * topology is loaded must exist in it. A cache violating that has been
 * amputated in memory (observed: a transiently-empty public-feeds walk
 * removed 641 feeds, and the watcher persisted the amputation over a good
 * checkpoint). Never durably replace good data with it.
 *
 * @returns True when the roster may be written.
 */
function roster_isConsistent(): boolean {
  const cache = procCache_get();
  const rosterIDs: Set<number> = new Set(cache.feedIDs_get());
  const orphaned: number = cache.shardedFeedIDs_get()
    .filter((id: number): boolean => cache.topologyLoaded_has(id) && !rosterIDs.has(id)).length;
  if (orphaned > 0) {
    errorStack.stack_push(
      'warning',
      `proc checkpoint skipped: ${orphaned} topology-loaded feeds missing from the roster (inconsistent snapshot)`,
    );
    return false;
  }
  return true;
}

/**
 * Atomically writes the roster shard (the feed index) for an identity.
 *
 * @param identity - Canonical ChRIS identity string.
 * @param root - Checkpoint directory override.
 * @returns Promise resolved after the file is durable in place; resolves
 *   without writing when the roster is inconsistent.
 */
export async function procCheckpointRoster_save(
  identity: string,
  root: string = procCheckpointRoot_get(),
): Promise<void> {
  if (!roster_isConsistent()) return;
  const dir: string = procCheckpointDir_get(identity, root);
  await dir_ensure(dir);
  const cache = procCache_get();
  const file: RosterFile = {
    schemaVersion: PROC_CHECKPOINT_SCHEMA,
    identity,
    writtenAt: new Date().toISOString(),
    feeds: cache.feedIDs_get().map((id: number): ProcFeed => ({ ...cache.feed_get(id)! })),
  };
  await json_write(join(dir, ROSTER_FILE), file);
  cache.checkpoint_mark(file.writtenAt);
}

/**
 * Atomically writes one feed's shard, or removes it when the feed no longer
 * holds topology (removed from the roster, or emptied).
 *
 * @param identity - Canonical ChRIS identity string.
 * @param feedID - The feed whose shard to write.
 * @param root - Checkpoint directory override.
 * @returns Promise resolved after the shard is durable in place.
 */
export async function procCheckpointFeed_save(
  identity: string,
  feedID: number,
  root: string = procCheckpointRoot_get(),
): Promise<void> {
  const dir: string = procCheckpointDir_get(identity, root);
  const cache = procCache_get();
  const snapshot: ProcFeedSnapshot = cache.feedSnapshot_create(feedID);
  const path: string = shardPath_get(dir, feedID);
  if (!cache.feed_get(feedID) || (snapshot.instances.length === 0 && !snapshot.loaded)) {
    await fs.rm(path, { force: true });
    return;
  }
  await dir_ensure(dir);
  const file: ShardFile = {
    schemaVersion: PROC_CHECKPOINT_SCHEMA,
    identity,
    writtenAt: new Date().toISOString(),
    feedID,
    loaded: snapshot.loaded,
    instances: snapshot.instances,
  };
  await json_write(path, file);
}

/**
 * Saves the whole process cache: the roster and every feed shard, removing
 * shards for feeds no longer in the roster.
 *
 * @param identity - Canonical ChRIS identity string.
 * @param root - Checkpoint directory override.
 * @returns Promise resolved after every file is durable in place; resolves
 *   without writing when the roster is inconsistent.
 */
export async function procCheckpoint_save(
  identity: string,
  root: string = procCheckpointRoot_get(),
): Promise<void> {
  if (!roster_isConsistent()) return;
  const dir: string = procCheckpointDir_get(identity, root);
  const cache = procCache_get();
  await procCheckpointRoster_save(identity, root);
  const wanted: Set<number> = new Set(cache.shardedFeedIDs_get());
  for (const feedID of wanted) await procCheckpointFeed_save(identity, feedID, root);
  for (const name of await fs.readdir(dir)) {
    const match: RegExpMatchArray | null = SHARD_PATTERN.exec(name);
    if (match && !wanted.has(Number(match[1]))) await fs.rm(join(dir, name), { force: true });
  }
}

/** The shard a change maps to: the roster, one feed, or everything. */
type ShardKey = 'roster' | 'all' | number;

/**
 * Starts a throttled, per-shard checkpoint writer for mutations to a
 * current cache. Each touched shard is written at least `delayMs` after
 * its first pending mutation and no more often than once per `floorMs`;
 * a burst of mutations to one feed coalesces into one write, and a quiet
 * feed's shard is never rewritten at all.
 *
 * @param identity - Canonical ChRIS identity string.
 * @param root - Checkpoint directory override.
 * @param delayMs - Debounce interval in milliseconds.
 * @param floorMs - Minimum spacing between two writes of the same shard.
 * @returns Function that stops watching and cancels pending saves.
 */
export function procCheckpoint_watch(
  identity: string,
  root: string = procCheckpointRoot_get(),
  delayMs: number = 1000,
  floorMs: number = PROC_CHECKPOINT_FLOOR_MS,
): () => void {
  const timers: Map<ShardKey, NodeJS.Timeout> = new Map();
  const lastWrite: Map<ShardKey, number> = new Map();

  const shard_write = async (key: ShardKey): Promise<void> => {
    if (key === 'roster') await procCheckpointRoster_save(identity, root);
    else if (key === 'all') await procCheckpoint_save(identity, root);
    else await procCheckpointFeed_save(identity, key, root);
  };

  const shard_schedule = (key: ShardKey): void => {
    if (timers.has(key)) return;
    const earliest: number = (lastWrite.get(key) ?? 0) + floorMs;
    const wait: number = Math.max(delayMs, earliest - Date.now());
    const timer: NodeJS.Timeout = setTimeout((): void => {
      timers.delete(key);
      lastWrite.set(key, Date.now());
      void shard_write(key).catch((): void => { /* next mutation retries */ });
    }, wait);
    timer.unref();
    timers.set(key, timer);
  };

  const listener_remove: () => void = procCache_get().changeListener_add((change: ProcCacheChange): void => {
    if (procCache_get().lifecycle_get().state !== 'current') return;
    if (change.scope === 'lifecycle') return;
    if (change.scope === 'all') {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
      shard_schedule('all');
      return;
    }
    if (timers.has('all')) return;
    shard_schedule(change.scope === 'roster' ? 'roster' : change.feedID);
  });

  return (): void => {
    listener_remove();
    for (const timer of timers.values()) clearTimeout(timer);
    timers.clear();
  };
}
