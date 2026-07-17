/**
 * @file Persistence and validation tests for process-cache checkpoints.
 *
 * Uses isolated temporary directories to verify permissions, atomic restore
 * behavior, identity/schema rejection, graph validation, and debounced saves.
 */
import { mkdtemp, readFile, stat, writeFile, mkdir, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { procCache_get, ProcFeed } from '../src/cache/procCache';
import { procCheckpointPath_get, procCheckpoint_restore, procCheckpoint_save, procCheckpoint_watch } from '../src/cache/procCheckpoint';

const identity: string = 'user@https://cube.example.org/api/v1/';
let root: string;

function feed_create(id: number): ProcFeed {
  return {
    id, title: `feed ${id}`, ownerUsername: 'rudolph', public: false,
    creationDate: '2026-07-16T00:00:00Z', finishedJobs: 1, erroredJobs: 0,
    startedJobs: 0, scheduledJobs: 0, cancelledJobs: 0, createdJobs: 0,
  };
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'chell-proc-checkpoint-'));
  procCache_get().cache_clear();
});

afterEach(async () => { await rm(root, { recursive: true, force: true }); });

it('atomically saves mode-0600 data and restores the matching identity', async () => {
  procCache_get().feed_add(feed_create(5));
  procCache_get().instance_add({
    id: 10, feedID: 5, parentID: null, pluginName: 'pl-root', params: null,
    status: 'finishedSuccessfully',
  });
  await procCheckpoint_save(identity, root);

  const path: string = procCheckpointPath_get(identity, root);
  expect((await stat(path)).mode & 0o777).toBe(0o600);
  expect((await stat(root)).mode & 0o777).toBe(0o700);
  expect((await readFile(path, 'utf8'))).toContain('pl-root');

  procCache_get().cache_clear();
  expect(await procCheckpoint_restore(identity, root)).toMatchObject({ restored: true, count: 1 });
  expect(procCache_get().path_build(10)).toBe('/proc/jobs/feed_5/pl-root_10');
});

it('ignores corrupt and wrong-identity checkpoints without changing the cache', async () => {
  const path: string = procCheckpointPath_get(identity, root);
  await mkdir(root, { recursive: true });
  await writeFile(path, '{bad json');
  expect((await procCheckpoint_restore(identity, root)).restored).toBe(false);
  expect(procCache_get().instances_count()).toBe(0);

  await writeFile(path, JSON.stringify({
    schemaVersion: 1, identity: 'other', writtenAt: new Date().toISOString(),
    snapshot: { feeds: [], instances: [], topologyLoaded: [] },
  }));
  expect((await procCheckpoint_restore(identity, root)).reason).toBe('incompatible checkpoint');
});

it('rejects malformed topology atomically without replacing live cache data', async () => {
  const path: string = procCheckpointPath_get(identity, root);
  const malformedCheckpoint: unknown = {
    schemaVersion: 1,
    identity,
    writtenAt: '2026-07-16T12:00:00.000Z',
    snapshot: {
      feeds: [feed_create(5)],
      instances: [{
        id: 10, feedID: 5, parentID: 999, pluginName: 'pl-child',
        params: null, status: 'finishedSuccessfully',
      }],
      topologyLoaded: [5],
    },
  };
  await mkdir(root, { recursive: true });
  await writeFile(path, JSON.stringify(malformedCheckpoint));
  procCache_get().feed_add(feed_create(9));

  expect(await procCheckpoint_restore(identity, root)).toMatchObject({
    restored: false,
    reason: 'incompatible checkpoint',
  });
  expect(procCache_get().feed_get(9)?.title).toBe('feed 9');
  expect(procCache_get().feed_get(5)).toBeUndefined();
});

it('debounces a checkpoint after mutations to a current cache', async () => {
  const watch_stop: () => void = procCheckpoint_watch(identity, root, 5);
  procCache_get().lifecycle_set('current');
  procCache_get().feed_add(feed_create(9));
  await new Promise<void>((resolve: () => void): void => { setTimeout(resolve, 25); });
  watch_stop();

  expect((await readFile(procCheckpointPath_get(identity, root), 'utf8'))).toContain('feed 9');
});
