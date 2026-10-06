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

/**
 * Waits until a check passes, or fails with its last error at the deadline.
 * The watcher writes on a timer and the write itself is asynchronous, so a
 * fixed sleep races the disk: a slow runner read a shard that had not
 * landed yet (ENOENT). A positive expectation polls instead.
 */
async function eventually(check: () => Promise<void>, timeoutMs: number = 3000): Promise<void> {
  const deadline: number = Date.now() + timeoutMs;
  for (;;) {
    try {
      await check();
      return;
    } catch (error: unknown) {
      if (Date.now() > deadline) throw error;
      await sleep(10);
    }
  }
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

it('leaves out a torn shard, names it, and restores the rest — one bad file costs one feed, not the checkpoint', async () => {
  await mkdir(dir, { recursive: true });
  const writtenAt: string = '2026-07-16T12:00:00.000Z';
  await writeFile(join(dir, 'roster.json'), JSON.stringify({
    schemaVersion: 3, identity, writtenAt, feeds: [feed_create(5), feed_create(6)],
  }));
  // A walk that lost a row: the child names a parent the shard never held
  // (titan, feed 800: 475 of 477 instances, and a cold boot for all 729 feeds).
  await writeFile(join(dir, 'feed-5.json'), JSON.stringify({
    schemaVersion: 3, identity, writtenAt, feedID: 5, loaded: true,
    instances: [{ id: 10, feedID: 5, parentID: 999, pluginName: 'pl-child', params: null, status: 'finishedSuccessfully' }],
  }));
  await writeFile(join(dir, 'feed-6.json'), JSON.stringify({
    schemaVersion: 3, identity, writtenAt, feedID: 6, loaded: true,
    instances: [{ id: 60, feedID: 6, parentID: null, pluginName: 'pl-root', params: null, status: 'finishedSuccessfully' }],
  }));

  expect(await procCheckpoint_restore(identity, root)).toEqual({
    restored: true,
    count: 1,
    writtenAt,
    torn: ['feed 5: instance 10 names parent 999, which the shard does not hold'],
  });
  // The torn feed stays in the roster, with no topology: the sweep walks it again.
  expect(procCache_get().feed_get(5)?.title).toBe('feed 5');
  expect(procCache_get().topologyLoaded_has(5)).toBe(false);
  expect(procCache_get().topologyLoaded_has(6)).toBe(true);
  expect(procCache_get().instance_get?.(10) ?? undefined).toBeUndefined();
});

it('a torn shard is one whose graph does not stand on its own: a cycle, a twin, a stray, a missing join parent', async () => {
  await mkdir(dir, { recursive: true });
  const writtenAt: string = '2026-07-16T12:00:00.000Z';
  const feeds: ProcFeed[] = [1, 2, 3, 4].map(feed_create);
  await writeFile(join(dir, 'roster.json'), JSON.stringify({ schemaVersion: 3, identity, writtenAt, feeds }));
  const shard = (feedID: number, instances: unknown[]): Promise<void> => writeFile(
    join(dir, `feed-${feedID}.json`),
    JSON.stringify({ schemaVersion: 3, identity, writtenAt, feedID, loaded: true, instances }),
  );
  await shard(1, [
    { id: 11, feedID: 1, parentID: 12, pluginName: 'pl-a', params: null, status: 'finishedSuccessfully' },
    { id: 12, feedID: 1, parentID: 11, pluginName: 'pl-b', params: null, status: 'finishedSuccessfully' },
  ]);
  await shard(2, [
    { id: 21, feedID: 2, parentID: null, pluginName: 'pl-a', params: null, status: 'finishedSuccessfully' },
    { id: 21, feedID: 2, parentID: null, pluginName: 'pl-a', params: null, status: 'finishedSuccessfully' },
  ]);
  await shard(3, [{ id: 31, feedID: 7, parentID: null, pluginName: 'pl-a', params: null, status: 'finishedSuccessfully' }]);
  await shard(4, [
    { id: 41, feedID: 4, parentID: null, pluginName: 'pl-a', params: null, status: 'finishedSuccessfully' },
    { id: 42, feedID: 4, parentID: 41, pluginName: 'pl-ts', params: null, status: 'finishedSuccessfully', joinParentIDs: [43] },
  ]);

  const outcome = await procCheckpoint_restore(identity, root);
  expect(outcome.restored).toBe(true);
  expect(outcome.count).toBe(0);
  expect(outcome.torn).toEqual([
    'feed 1: instance 11 sits on a cycle',
    'feed 2: instance 21 appears twice',
    'feed 3: instance 31 belongs to feed 7',
    'feed 4: instance 42 names join parent 43, which the shard does not hold',
  ]);
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

it('the watcher writes the whole checkpoint when the sweep makes the cache current', async () => {
  const watch_stop: () => void = procCheckpoint_watch(identity, root, 5, 20);
  // A cold sweep: the cache reconciles, feeds and instances land, the
  // reconcile emits its `all`, feeds are marked loaded — none of it current.
  procCache_get().lifecycle_set('reconciling');
  procCache_get().feed_add(feed_create(9));
  procCache_get().feed_add(feed_create(10));
  procCache_get().instance_add({ id: 90, feedID: 9, parentID: null, pluginName: 'pl-root', params: null, status: 'finishedSuccessfully' });
  procCache_get().instance_add({ id: 100, feedID: 10, parentID: null, pluginName: 'pl-root', params: null, status: 'finishedSuccessfully' });
  procCache_get().topology_reconcile(new Set([90, 100]));
  procCache_get().topologyLoaded_mark(9);
  procCache_get().topologyLoaded_mark(10);
  await sleep(40);
  expect(await shardNames().catch((): string[] => [])).toEqual([]);
  // The sweep ends. Nothing else will happen on a quiet night.
  procCache_get().warmup_complete();
  await eventually(async (): Promise<void> => {
    expect(await readFile(join(dir, 'roster.json'), 'utf8')).toContain('feed 10');
    expect(await shardNames()).toEqual(['feed-10.json', 'feed-9.json']);
  });
  expect(await procCheckpoint_restore(identity, root)).toMatchObject({ restored: true, count: 2 });
  watch_stop();
});

it('the watcher writes only the shard a mutation touched', async () => {
  const watch_stop: () => void = procCheckpoint_watch(identity, root, 5, 20);
  procCache_get().lifecycle_set('current');
  procCache_get().feed_add(feed_create(9));
  procCache_get().instance_add({ id: 90, feedID: 9, parentID: null, pluginName: 'pl-root', params: null, status: 'started' });
  await eventually(async (): Promise<void> => {
    expect(await readFile(join(dir, 'roster.json'), 'utf8')).toContain('feed 9');
    expect(await readFile(join(dir, 'feed-9.json'), 'utf8')).toContain('pl-root');
  });
  expect(await shardNames()).toEqual(['feed-9.json']);
  const rosterBefore = await stat(join(dir, 'roster.json'));

  await sleep(25);
  procCache_get().status_update(90, 'finishedSuccessfully');
  await eventually(async (): Promise<void> => {
    expect(await readFile(join(dir, 'feed-9.json'), 'utf8')).toContain('finishedSuccessfully');
  });
  expect((await stat(join(dir, 'roster.json'))).mtimeMs).toBe(rosterBefore.mtimeMs);
  watch_stop();
});

it('the watcher spaces writes of one shard by the floor, never dropping the last change', async () => {
  // A floor wide enough that the check inside it never races a slow runner.
  const watch_stop: () => void = procCheckpoint_watch(identity, root, 5, 1000);
  procCache_get().lifecycle_set('current');
  procCache_get().feed_add(feed_create(9));
  procCache_get().instance_add({ id: 90, feedID: 9, parentID: null, pluginName: 'pl-a', params: null, status: 'finishedSuccessfully' });
  await eventually(async (): Promise<void> => {
    expect(await readFile(join(dir, 'feed-9.json'), 'utf8')).toContain('pl-a');
  });

  procCache_get().instance_add({ id: 91, feedID: 9, parentID: 90, pluginName: 'pl-b', params: null, status: 'finishedSuccessfully' });
  await sleep(50);
  expect(await readFile(join(dir, 'feed-9.json'), 'utf8')).not.toContain('pl-b'); // inside the floor
  await eventually(async (): Promise<void> => {
    expect(await readFile(join(dir, 'feed-9.json'), 'utf8')).toContain('pl-b'); // trailing write landed
  });
  watch_stop();
});

it('the default checkpoint directory lives under the user cache home, keyed but never naming the identity', () => {
  const dir: string = procCheckpointDir_get(identity);
  expect(dir).toMatch(/\/chell\/proc\/[0-9a-f]{16}$/);
  expect(dir).not.toContain('cube.example.org');
});

describe('a feed\'s data facts', () => {
  it('ride the feed\'s shard and come back with it, even for a feed holding no topology yet', async () => {
    procCache_get().feed_add(feed_create(5));
    procCache_get().feed_add(feed_create(6));
    procCache_get().instance_add({ id: 10, feedID: 5, parentID: null, pluginName: 'pl-root', params: null, status: 'finishedSuccessfully' });
    procCache_get().topologyLoaded_mark(5);
    procCache_get().dataFacts_set(5, { format: 'dicom', modality: 'MR', seriesDescription: 'SAG MPRAGE' });
    procCache_get().dataFacts_set(6, { format: 'nifti' });
    await procCheckpoint_save(identity, root);
    expect(await shardNames()).toEqual(['feed-5.json', 'feed-6.json']);
    procCache_get().cache_clear();
    expect(procCache_get().dataFacts_of(5)).toBeUndefined();
    expect((await procCheckpoint_restore(identity, root)).restored).toBe(true);
    expect(procCache_get().dataFacts_of(5)).toEqual({ format: 'dicom', modality: 'MR', seriesDescription: 'SAG MPRAGE' });
    expect(procCache_get().dataFacts_of(6)).toEqual({ format: 'nifti' });
  });

  it('are absent from a shard written before they existed, and the shard restores all the same', async () => {
    procCache_get().feed_add(feed_create(5));
    procCache_get().instance_add({ id: 10, feedID: 5, parentID: null, pluginName: 'pl-root', params: null, status: 'finishedSuccessfully' });
    procCache_get().topologyLoaded_mark(5);
    await procCheckpoint_save(identity, root);
    const shard = JSON.parse(await readFile(join(dir, 'feed-5.json'), 'utf8'));
    expect(shard.dataFacts).toBeUndefined();
    procCache_get().cache_clear();
    expect((await procCheckpoint_restore(identity, root)).restored).toBe(true);
    expect(procCache_get().topologyLoaded_has(5)).toBe(true);
    expect(procCache_get().dataFacts_of(5)).toBeUndefined();
  });

  it('are dropped when malformed, and the feed\'s topology kept', async () => {
    procCache_get().feed_add(feed_create(5));
    procCache_get().instance_add({ id: 10, feedID: 5, parentID: null, pluginName: 'pl-root', params: null, status: 'finishedSuccessfully' });
    procCache_get().topologyLoaded_mark(5);
    procCache_get().dataFacts_set(5, { format: 'dicom' });
    await procCheckpoint_save(identity, root);
    const path = join(dir, 'feed-5.json');
    const shard = JSON.parse(await readFile(path, 'utf8'));
    shard.dataFacts = { format: 'hologram' };
    await writeFile(path, JSON.stringify(shard));
    procCache_get().cache_clear();
    expect((await procCheckpoint_restore(identity, root)).restored).toBe(true);
    expect(procCache_get().topologyLoaded_has(5)).toBe(true);
    expect(procCache_get().dataFacts_of(5)).toBeUndefined();
  });

  it('outlive a re-walk of the feed\'s graph and leave with the feed', () => {
    procCache_get().feed_add(feed_create(5));
    procCache_get().dataFacts_set(5, { format: 'png' });
    procCache_get().feedTopology_evict(5);
    expect(procCache_get().dataFacts_of(5)).toEqual({ format: 'png' });
    procCache_get().feed_remove(5);
    expect(procCache_get().dataFacts_of(5)).toBeUndefined();
    procCache_get().dataFacts_set(7, { format: 'png' });
    expect(procCache_get().dataFacts_of(7)).toBeUndefined();
  });
});
