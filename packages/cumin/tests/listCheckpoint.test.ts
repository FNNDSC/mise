/**
 * @file Persistence tests for the listing-cache checkpoint: permissions,
 * restore with original timestamps (stale stays stale), identity and
 * schema rejection, and the throttled writer.
 */
import { mkdtemp, readFile, stat, writeFile, mkdir, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { listCache_get } from '../src/cache/listCache';
import {
  listCheckpointPath_get,
  listCheckpoint_restore,
  listCheckpoint_save,
  listCheckpoint_watch,
} from '../src/cache/listCheckpoint';

const identity: string = 'user@https://cube.example.org/api/v1/';
let root: string;

function sleep(ms: number): Promise<void> {
  return new Promise<void>((resolve: () => void): void => { setTimeout(resolve, ms); });
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'chell-list-checkpoint-'));
  listCache_get().cache_invalidate();
});

afterEach(async () => { await rm(root, { recursive: true, force: true }); });

it('saves a mode-0600 file and restores entries with their original timestamps', async () => {
  const cache = listCache_get();
  cache.cache_set('/home/u/feeds', [{ name: 'feed_1', type: 'dir', size: 0, owner: 'u', date: '' }], { ttl: 50 });
  cache.cache_set('/bin', [{ name: 'pl-dircopy', type: 'plugin', size: 0, owner: '', date: '' }]);
  await listCheckpoint_save(identity, root);

  const path: string = listCheckpointPath_get(identity, root);
  expect((await stat(path)).mode & 0o777).toBe(0o600);
  expect((await stat(root)).mode & 0o777).toBe(0o700);
  expect(await readFile(path, 'utf8')).toContain('feed_1');

  await sleep(60);
  cache.cache_invalidate();
  expect(await listCheckpoint_restore(identity, root)).toMatchObject({ restored: true, count: 2 });
  const feeds = cache.cache_get<unknown[]>('/home/u/feeds');
  expect(feeds?.data).toHaveLength(1);
  expect(feeds?.fresh).toBe(false); // its 50 ms TTL elapsed while on disk
  expect(cache.cache_get('/bin')?.fresh).toBe(true);
});

it('ignores corrupt, wrong-identity, and malformed checkpoints without changing the cache', async () => {
  const cache = listCache_get();
  cache.cache_set('/keep', []);
  const path: string = listCheckpointPath_get(identity, root);
  await mkdir(root, { recursive: true });
  await writeFile(path, '{bad json');
  expect((await listCheckpoint_restore(identity, root)).restored).toBe(false);
  expect(cache.cache_get('/keep')).not.toBeNull();

  await writeFile(path, JSON.stringify({ schemaVersion: 1, identity: 'other', writtenAt: new Date().toISOString(), entries: [] }));
  expect((await listCheckpoint_restore(identity, root)).reason).toBe('incompatible listing checkpoint');

  await writeFile(path, JSON.stringify({
    schemaVersion: 1, identity, writtenAt: new Date().toISOString(),
    entries: [{ path: 'relative', data: [], timestamp: 1, dirty: false, ttl: 10 }],
  }));
  expect((await listCheckpoint_restore(identity, root)).reason).toBe('incompatible listing checkpoint');
  expect(cache.cache_get('/keep')).not.toBeNull();
  expect((await listCheckpoint_restore(identity, join(root, 'nowhere'))).reason).toBe('no listing checkpoint');
});

it('the watcher coalesces a burst and spaces writes by the floor without dropping the last change', async () => {
  const cache = listCache_get();
  const watch_stop: () => void = listCheckpoint_watch(identity, root, 5, 150);
  cache.cache_set('/a', []);
  cache.cache_set('/b', []);
  await sleep(40);
  const path: string = listCheckpointPath_get(identity, root);
  const first: string = await readFile(path, 'utf8');
  expect(first).toContain('"/a"');
  expect(first).toContain('"/b"');

  cache.cache_set('/c', []);
  await sleep(40);
  expect(await readFile(path, 'utf8')).not.toContain('"/c"'); // inside the floor
  await sleep(200);
  expect(await readFile(path, 'utf8')).toContain('"/c"');
  watch_stop();
});

it('the default checkpoint path lives under the user cache home, keyed but never naming the identity', () => {
  const path: string = listCheckpointPath_get(identity);
  expect(path).toMatch(/\/chell\/vfs\/listings-[0-9a-f]{16}-v1\.json$/);
  expect(path).not.toContain('cube.example.org');
});

it('restore merges: a path already cached in this process outranks the checkpoint', async () => {
  const cache = listCache_get();
  cache.cache_set('/etc/group', { content: 'old' });
  await listCheckpoint_save(identity, root);
  cache.cache_invalidate();
  cache.cache_set('/etc/group', { content: 'rendered just now' });
  expect(await listCheckpoint_restore(identity, root)).toMatchObject({ restored: true, count: 1 });
  expect(cache.cache_get<{ content: string }>('/etc/group')?.data.content).toBe('rendered just now');
});
