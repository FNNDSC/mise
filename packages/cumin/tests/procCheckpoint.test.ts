/**
 * @file Persistence and validation tests for sharded process-cache checkpoints.
 *
 * Uses isolated temporary directories to verify permissions, atomic restore
 * behavior, identity/schema rejection, graph validation, orphan shards,
 * legacy migration, and the per-shard throttled writer.
 */
import { mkdtemp, readFile, readdir, stat, writeFile, mkdir, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { procCache_get, ProcFeed } from '../src/cache/procCache';
import {
  procCheckpointDir_get,
  procCheckpointPath_get,
  procCheckpoint_restore,
  procCheckpoint_save,
  procCheckpoint_watch,
} from '../src/cache/procCheckpoint';

const identity: string = 'user@https://cube.example.org/api/v1/';
let root: string;
let dir: string;

function feed_create(id: number): ProcFeed {
  return {
    id, title: `feed ${id}`, ownerUsername: 'rudolph', public: false,
    creationDate: '2026-07-16T00:00:00Z', finishedJobs: 1, erroredJobs: 0,
    startedJobs: 0, scheduledJobs: 0, cancelledJobs: 0, createdJobs: 0,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise<void>((resolve: () => void): void => { setTimeout(resolve, ms); });
}

async function shardNames(): Promise<string[]> {
  return (await readdir(dir)).filter((name: string): boolean => name.startsWith('feed-')).sort();
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'chell-proc-checkpoint-'));
  dir = procCheckpointDir_get(identity, root);
  procCache_get().cache_clear();
});

afterEach(async () => { await rm(root, { recursive: true, force: true }); });

it('saves a mode-0700 directory of mode-0600 shards and restores the matching identity', async () => {
  procCache_get().feed_add(feed_create(5));
  procCache_get().feed_add(feed_create(6));
  procCache_get().instance_add({
    id: 10, feedID: 5, parentID: null, pluginName: 'pl-root', params: null,
    status: 'finishedSuccessfully',
  });
  procCache_get().topologyLoaded_mark(5);
  await procCheckpoint_save(identity, root);

  expect((await stat(dir)).mode & 0o777).toBe(0o700);
  expect((await stat(join(dir, 'roster.json'))).mode & 0o777).toBe(0o600);
  expect(await shardNames()).toEqual(['feed-5.json']); // feed 6 holds no topology: no shard
  expect(await readFile(join(dir, 'feed-5.json'), 'utf8')).toContain('pl-root');

  procCache_get().cache_clear();
  expect(await procCheckpoint_restore(identity, root)).toMatchObject({ restored: true, count: 1 });
  expect(procCache_get().path_build(10)).toBe('/proc/jobs/feed_5/pl-root_10');
  expect(procCache_get().topologyLoaded_has(5)).toBe(true);
  expect(procCache_get().feed_get(6)?.title).toBe('feed 6');
});

it('ignores corrupt and wrong-identity checkpoints without changing the cache', async () => {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'roster.json'), '{bad json');
  expect((await procCheckpoint_restore(identity, root)).restored).toBe(false);
  expect(procCache_get().instances_count()).toBe(0);

  await writeFile(join(dir, 'roster.json'), JSON.stringify({
    schemaVersion: 3, identity: 'other', writtenAt: new Date().toISOString(), feeds: [],
  }));
  expect((await procCheckpoint_restore(identity, root)).reason).toBe('incompatible checkpoint');
});

it('rejects malformed topology atomically without replacing live cache data', async () => {
  await mkdir(dir, { recursive: true });
  const writtenAt: string = '2026-07-16T12:00:00.000Z';
  await writeFile(join(dir, 'roster.json'), JSON.stringify({
    schemaVersion: 3, identity, writtenAt, feeds: [feed_create(5)],
  }));
  await writeFile(join(dir, 'feed-5.json'), JSON.stringify({
    schemaVersion: 3, identity, writtenAt, feedID: 5, loaded: true,
    instances: [{ id: 10, feedID: 5, parentID: 999, pluginName: 'pl-child', params: null, status: 'finishedSuccessfully' }],
  }));
  procCache_get().feed_add(feed_create(9));

  expect(await procCheckpoint_restore(identity, root)).toMatchObject({
    restored: false,
    reason: 'incompatible checkpoint',
  });
  expect(procCache_get().feed_get(9)?.title).toBe('feed 9');
  expect(procCache_get().feed_get(5)).toBeUndefined();
});

it('skips a shard whose feed left the roster, and restores the rest', async () => {
  await mkdir(dir, { recursive: true });
  const writtenAt: string = '2026-07-16T12:00:00.000Z';
  await writeFile(join(dir, 'roster.json'), JSON.stringify({
    schemaVersion: 3, identity, writtenAt, feeds: [feed_create(5)],
  }));
  await writeFile(join(dir, 'feed-5.json'), JSON.stringify({
    schemaVersion: 3, identity, writtenAt, feedID: 5, loaded: true,
    instances: [{ id: 10, feedID: 5, parentID: null, pluginName: 'pl-root', params: null, status: 'finishedSuccessfully' }],
  }));
  await writeFile(join(dir, 'feed-7.json'), JSON.stringify({
    schemaVersion: 3, identity, writtenAt, feedID: 7, loaded: true,
    instances: [{ id: 70, feedID: 7, parentID: null, pluginName: 'pl-gone', params: null, status: 'finishedSuccessfully' }],
  }));

  expect(await procCheckpoint_restore(identity, root)).toMatchObject({ restored: true, count: 1 });
  expect(procCache_get().instance_get(70)).toBeUndefined();
  expect(procCache_get().instance_get(10)?.pluginName).toBe('pl-root');
});

it('migrates a legacy single-file checkpoint into shards', async () => {
  await mkdir(root, { recursive: true });
  await writeFile(procCheckpointPath_get(identity, root), JSON.stringify({
    schemaVersion: 2, identity, writtenAt: '2026-07-16T12:00:00.000Z',
    snapshot: {
      feeds: [feed_create(5)],
      instances: [{ id: 10, feedID: 5, parentID: null, pluginName: 'pl-root', params: null, status: 'finishedSuccessfully', startedAt: '2026-07-16T11:00:00Z' }],
      topologyLoaded: [5],
    },
  }));

  expect(await procCheckpoint_restore(identity, root)).toMatchObject({ restored: true, count: 1, migrated: true });
  expect(await shardNames()).toEqual(['feed-5.json']);
  expect(await readFile(join(dir, 'roster.json'), 'utf8')).toContain('feed 5');

  procCache_get().cache_clear();
  expect(await procCheckpoint_restore(identity, root)).toMatchObject({ restored: true, count: 1 });
  expect(procCache_get().instance_get(10)?.startedAt).toBe('2026-07-16T11:00:00Z');
});

it('refuses to write a roster that lost feeds whose topology is loaded', async () => {
  procCache_get().feed_add(feed_create(5));
  procCache_get().instance_add({ id: 10, feedID: 5, parentID: null, pluginName: 'pl-root', params: null, status: 'finishedSuccessfully' });
  procCache_get().topologyLoaded_mark(5);
  await procCheckpoint_save(identity, root);
  const before: string = await readFile(join(dir, 'roster.json'), 'utf8');

  // Amputate the roster in memory without touching topology.
  procCache_get().feeds_reconcile([]);
  procCache_get().topologyLoaded_mark(5);
  await procCheckpoint_save(identity, root);
  expect(await readFile(join(dir, 'roster.json'), 'utf8')).toBe(before);
});

it('the watcher writes only the shard a mutation touched', async () => {
  const watch_stop: () => void = procCheckpoint_watch(identity, root, 5, 20);
  procCache_get().lifecycle_set('current');
  procCache_get().feed_add(feed_create(9));
  procCache_get().instance_add({ id: 90, feedID: 9, parentID: null, pluginName: 'pl-root', params: null, status: 'started' });
  await sleep(40);
  expect(await readFile(join(dir, 'roster.json'), 'utf8')).toContain('feed 9');
  expect(await shardNames()).toEqual(['feed-9.json']);
  const rosterBefore = await stat(join(dir, 'roster.json'));

  await sleep(25);
  procCache_get().status_update(90, 'finishedSuccessfully');
  await sleep(40);
  expect(await readFile(join(dir, 'feed-9.json'), 'utf8')).toContain('finishedSuccessfully');
  expect((await stat(join(dir, 'roster.json'))).mtimeMs).toBe(rosterBefore.mtimeMs);
  watch_stop();
});

it('the watcher spaces writes of one shard by the floor, never dropping the last change', async () => {
  const watch_stop: () => void = procCheckpoint_watch(identity, root, 5, 150);
  procCache_get().lifecycle_set('current');
  procCache_get().feed_add(feed_create(9));
  procCache_get().instance_add({ id: 90, feedID: 9, parentID: null, pluginName: 'pl-a', params: null, status: 'finishedSuccessfully' });
  await sleep(30);
  expect(await readFile(join(dir, 'feed-9.json'), 'utf8')).toContain('pl-a');

  procCache_get().instance_add({ id: 91, feedID: 9, parentID: 90, pluginName: 'pl-b', params: null, status: 'finishedSuccessfully' });
  await sleep(30);
  expect(await readFile(join(dir, 'feed-9.json'), 'utf8')).not.toContain('pl-b'); // inside the floor
  await sleep(200);
  expect(await readFile(join(dir, 'feed-9.json'), 'utf8')).toContain('pl-b'); // trailing write landed
  watch_stop();
});

it('the default checkpoint directory lives under the user cache home, keyed but never naming the identity', () => {
  const dir: string = procCheckpointDir_get(identity);
  expect(dir).toMatch(/\/chell\/proc\/[0-9a-f]{16}$/);
  expect(dir).not.toContain('cube.example.org');
});
