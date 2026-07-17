/**
 * @file Persistent checkpoints for the daemon process index.
 *
 * Serializes persistence-safe {@link ProcCacheSnapshot} values to an
 * identity-keyed, mode-0600 file and validates the complete snapshot before
 * replacing live cache state. Saves use same-directory atomic renames.
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
  type ProcCacheSnapshot,
  type ProcFeed,
  type ProcInstance,
} from './procCache';

const PROC_CHECKPOINT_SCHEMA: number = 1;

interface ProcCheckpointFile {
  schemaVersion: number;
  identity: string;
  writtenAt: string;
  snapshot: ProcCacheSnapshot;
}

/**
 * Outcome of attempting to restore a local process-cache checkpoint.
 *
 * @property restored - Whether validated snapshot data replaced the cache.
 * @property count - Number of restored plugin instances.
 * @property writtenAt - Checkpoint creation time when restoration succeeded.
 * @property reason - Human-readable reason when restoration was skipped.
 */
export interface ProcCheckpointRestoreResult {
  restored: boolean;
  count: number;
  writtenAt?: string;
  reason?: string;
}

/** Returns the default directory for persistent process-cache files. */
function procCheckpointRoot_get(): string {
  const cacheHome: string = process.env.XDG_CACHE_HOME ?? join(homedir(), '.cache');
  return join(cacheHome, 'chell', 'proc');
}

/**
 * Builds the identity-keyed checkpoint path without exposing the identity.
 *
 * @param identity - Canonical ChRIS identity string.
 * @param root - Checkpoint directory override.
 * @returns Versioned checkpoint path.
 */
export function procCheckpointPath_get(identity: string, root: string = procCheckpointRoot_get()): string {
  const key: string = createHash('sha256').update(identity).digest('hex').slice(0, 16);
  return join(root, `proc-${key}-v${PROC_CHECKPOINT_SCHEMA}.json`);
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
  return integer_check(instance.id) &&
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

/** Reports whether parsed JSON is a compatible checkpoint for an identity. */
function procCheckpointFile_check(value: unknown, identity: string): value is ProcCheckpointFile {
  if (!value || typeof value !== 'object') return false;
  const file: Partial<ProcCheckpointFile> = value as Partial<ProcCheckpointFile>;
  return file.schemaVersion === PROC_CHECKPOINT_SCHEMA &&
    file.identity === identity &&
    typeof file.writtenAt === 'string' &&
    !Number.isNaN(Date.parse(file.writtenAt)) &&
    procCacheSnapshot_check(file.snapshot);
}

/**
 * Restores a matching, fully validated checkpoint into the process cache.
 *
 * @param identity - Canonical ChRIS identity string.
 * @param root - Checkpoint directory override.
 * @returns Restoration outcome without throwing for absent or invalid files.
 */
export async function procCheckpoint_restore(
  identity: string,
  root: string = procCheckpointRoot_get(),
): Promise<ProcCheckpointRestoreResult> {
  try {
    const raw: string = await fs.readFile(procCheckpointPath_get(identity, root), 'utf8');
    const parsed: unknown = JSON.parse(raw);
    if (!procCheckpointFile_check(parsed, identity)) {
      return { restored: false, count: 0, reason: 'incompatible checkpoint' };
    }
    procCache_get().snapshot_restore(parsed.snapshot, parsed.writtenAt);
    return { restored: true, count: parsed.snapshot.instances.length, writtenAt: parsed.writtenAt };
  } catch (error: unknown) {
    const code: string | undefined = (error as NodeJS.ErrnoException).code;
    return {
      restored: false,
      count: 0,
      reason: code === 'ENOENT' ? 'no checkpoint' : (error instanceof Error ? error.message : String(error)),
    };
  }
}

/**
 * Atomically saves the current persistence-safe process-cache snapshot.
 *
 * @param identity - Canonical ChRIS identity string.
 * @param root - Checkpoint directory override.
 * @returns Promise resolved after the mode-0600 file is durable in place.
 */
export async function procCheckpoint_save(
  identity: string,
  root: string = procCheckpointRoot_get(),
): Promise<void> {
  const path: string = procCheckpointPath_get(identity, root);
  const temporaryPath: string = `${path}.${process.pid}-${randomUUID()}.tmp`;
  const file: ProcCheckpointFile = {
    schemaVersion: PROC_CHECKPOINT_SCHEMA,
    identity,
    writtenAt: new Date().toISOString(),
    snapshot: procCache_get().snapshot_create(),
  };
  await fs.mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await fs.chmod(dirname(path), 0o700);
  await fs.writeFile(temporaryPath, `${JSON.stringify(file)}\n`, { encoding: 'utf8', mode: 0o600 });
  await fs.rename(temporaryPath, path);
  await fs.chmod(path, 0o600);
  procCache_get().checkpoint_mark(file.writtenAt);
}

/**
 * Starts a debounced checkpoint writer for mutations to a current cache.
 *
 * @param identity - Canonical ChRIS identity string.
 * @param root - Checkpoint directory override.
 * @param delayMs - Debounce interval in milliseconds.
 * @returns Function that stops watching and cancels a pending save.
 */
export function procCheckpoint_watch(
  identity: string,
  root: string = procCheckpointRoot_get(),
  delayMs: number = 1000,
): () => void {
  let timer: NodeJS.Timeout | null = null;
  const listener_remove: () => void = procCache_get().changeListener_add((): void => {
    if (procCache_get().lifecycle_get().state !== 'current') return;
    if (timer) clearTimeout(timer);
    timer = setTimeout((): void => {
      timer = null;
      void procCheckpoint_save(identity, root).catch((): void => { /* next mutation retries */ });
    }, delayMs);
    timer.unref();
  });
  return (): void => {
    listener_remove();
    if (timer) clearTimeout(timer);
    timer = null;
  };
}
