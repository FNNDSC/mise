/**
 * @file One folder lookup per path per session: the chrisapi client's
 * `getFileBrowserFolderByPath` memoised through the listing cache.
 *
 * Every navigation asked CUBE `filebrowser/search?path=` for the same
 * path three times — the path resolver, `cd`'s validation and the listing
 * each resolved it on their own — and asked again on the next visit. The
 * record is kept beside the folder's listing, under the listing's own
 * TTL, and dropped by the same invalidations the poller of record and
 * local mutations already make (epic #367): no second clock. A lookup in
 * flight is shared; a miss or a failure is never kept.
 */
import type { Client } from '../chrisapi/adapter.js';
import { listCache_get } from '../cache/listCache';

/** How a memoised client is marked, so it is wrapped once. */
const MEMOISED: unique symbol = Symbol('folderLookup_memoised');

/**
 * Wraps a client's folder lookup with the session's memo. Idempotent.
 *
 * @param client - A connected chrisapi Client.
 * @returns The same client, its `getFileBrowserFolderByPath` memoised.
 */
export function folderLookup_memoize(client: Client): Client {
  const marked: { [MEMOISED]?: boolean } = client as unknown as { [MEMOISED]?: boolean };
  if (marked[MEMOISED] === true) return client;
  marked[MEMOISED] = true;
  const lookup = client.getFileBrowserFolderByPath.bind(client) as (path: string, timeout?: number) => Promise<unknown>;
  (client as unknown as { getFileBrowserFolderByPath: (path: string, timeout?: number) => Promise<unknown> }).getFileBrowserFolderByPath =
    (path: string, timeout?: number): Promise<unknown> => {
      const kept: Promise<unknown> | null = listCache_get().folder_get(path);
      if (kept !== null) return kept;
      const fresh: Promise<unknown> = lookup(path, timeout);
      listCache_get().folder_set(path, fresh);
      return fresh;
    };
  return client;
}
