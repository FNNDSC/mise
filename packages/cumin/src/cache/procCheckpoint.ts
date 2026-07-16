/** Persistent, identity-scoped checkpointing for the daemon's /proc index. */
import { createHash, randomUUID } from 'crypto';
import { homedir } from 'os';
import { dirname, join } from 'path';
import { promises as fs } from 'fs';
import { procCache_get, ProcCacheSnapshot } from './procCache';

const PROC_CHECKPOINT_SCHEMA: number = 1;

interface ProcCheckpointFile {
  schemaVersion: number;
  identity: string;
  writtenAt: string;
  snapshot: ProcCacheSnapshot;
}

export interface ProcCheckpointRestoreResult {
  restored: boolean;
  count: number;
  writtenAt?: string;
  reason?: string;
}

function procCheckpointRoot_get(): string {
  const cacheHome: string = process.env.XDG_CACHE_HOME ?? join(homedir(), '.cache');
  return join(cacheHome, 'chell', 'proc');
}

export function procCheckpointPath_get(identity: string, root: string = procCheckpointRoot_get()): string {
  const key: string = createHash('sha256').update(identity).digest('hex').slice(0, 16);
  return join(root, `proc-${key}-v${PROC_CHECKPOINT_SCHEMA}.json`);
}

function procCheckpointFile_check(value: unknown, identity: string): value is ProcCheckpointFile {
  if (!value || typeof value !== 'object') return false;
  const file: Partial<ProcCheckpointFile> = value as Partial<ProcCheckpointFile>;
  return file.schemaVersion === PROC_CHECKPOINT_SCHEMA &&
    file.identity === identity &&
    typeof file.writtenAt === 'string' &&
    !!file.snapshot &&
    Array.isArray(file.snapshot.feeds) &&
    Array.isArray(file.snapshot.instances) &&
    Array.isArray(file.snapshot.topologyLoaded);
}

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

export function procCheckpoint_watch(
  identity: string,
  root: string = procCheckpointRoot_get(),
  delayMs: number = 1000,
): () => void {
  let timer: NodeJS.Timeout | null = null;
  const listener_remove: () => void = procCache_get().changeListener_add((): void => {
    if (procCache_get().lifecycle_get().phase !== 'current') return;
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
