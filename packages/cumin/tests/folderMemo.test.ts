/**
 * @file A folder lookup is asked of CUBE once per path per session, shared
 * in flight, forgotten on a miss, and dropped with the listing it belongs to.
 */
import { describe, it, expect, beforeEach } from '@jest/globals';
import { listCache_get } from '../src/cache/listCache';
import { folderLookup_memoize } from '../src/filebrowser/folderMemo';
import type { Client } from '../src/chrisapi/adapter.js';

/** A client whose lookup counts its calls and answers what it is told. */
const client_fake = (answer: (path: string) => unknown): { client: Client; calls: string[] } => {
  const calls: string[] = [];
  const client = {
    getFileBrowserFolderByPath: async (path: string): Promise<unknown> => { calls.push(path); await new Promise((r) => setTimeout(r, 5)); const a = answer(path); if (a instanceof Error) throw a; return a; },
  } as unknown as Client;
  return { client, calls };
};

describe('folderLookup_memoize', () => {
  beforeEach(() => { listCache_get().cache_invalidate(); });

  it('asks once per path, shares a lookup in flight, and answers the kept record after', async () => {
    const { client, calls } = client_fake((path) => ({ data: { path } }));
    folderLookup_memoize(client);
    const [a, b] = await Promise.all([client.getFileBrowserFolderByPath('/home/x'), client.getFileBrowserFolderByPath('/home/x')]);
    expect(a).toEqual(b);
    expect(calls).toEqual(['/home/x']);
    await client.getFileBrowserFolderByPath('/home/x');
    await client.getFileBrowserFolderByPath('/home/y');
    expect(calls).toEqual(['/home/x', '/home/y']);
    expect(listCache_get().folders_count()).toBe(2);
  });

  it('keeps no miss and no failure', async () => {
    const { client, calls } = client_fake((path) => (path === '/gone' ? null : new Error('down')));
    folderLookup_memoize(client);
    expect(await client.getFileBrowserFolderByPath('/gone')).toBeNull();
    expect(await client.getFileBrowserFolderByPath('/gone')).toBeNull();
    await expect(client.getFileBrowserFolderByPath('/broken')).rejects.toThrow('down');
    await expect(client.getFileBrowserFolderByPath('/broken')).rejects.toThrow('down');
    expect(calls).toEqual(['/gone', '/gone', '/broken', '/broken']);
    expect(listCache_get().folders_count()).toBe(0);
  });

  it('drops the record with the listing: the path and its subtree on an invalidation, all on a clear', async () => {
    const { client, calls } = client_fake((path) => ({ data: { path } }));
    folderLookup_memoize(client);
    for (const p of ['/home/x', '/home/x/a', '/home/x/a/b', '/home/y']) await client.getFileBrowserFolderByPath(p);
    expect(listCache_get().folders_count()).toBe(4);
    listCache_get().cache_invalidate('/home/x');
    expect(listCache_get().folders_count()).toBe(1);
    await client.getFileBrowserFolderByPath('/home/y');
    expect(calls.filter((p) => p === '/home/y')).toHaveLength(1);
    listCache_get().cache_invalidateTree('/home');
    expect(listCache_get().folders_count()).toBe(0);
    await client.getFileBrowserFolderByPath('/home/y');
    listCache_get().cache_invalidate();
    expect(listCache_get().folders_count()).toBe(0);
  });

  it('wraps a client once', async () => {
    const { client, calls } = client_fake((path) => ({ data: { path } }));
    folderLookup_memoize(client);
    folderLookup_memoize(client);
    await client.getFileBrowserFolderByPath('/once');
    await client.getFileBrowserFolderByPath('/once');
    expect(calls).toEqual(['/once']);
  });
});
