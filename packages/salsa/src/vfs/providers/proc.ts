/**
 * @file /proc VFS Provider
 *
 * Surfaces ChRIS plugin instances as a navigable DAG under /proc/feeds/.
 * Backed by ProcCache in cumin. Structure is permanent; status of non-terminal
 * nodes is refreshed live on read.
 *
 * @module
 */

import { VFSProvider, VFSItem, CpOptions } from '../provider.js';
import { job_cancel, job_delete, job_statusFetch, job_logFetch } from '../../jobs/index.js';
import { Result, Ok, Err, procCache_get, ProcCache, ProcInstance, ProcFeed, chrisConnection, errorStack } from '@fnndsc/cumin';

/** Raw plugin instance data shape from chrisapi. */
interface RawInstance {
  id: number;
  feed_id: number;
  previous_id: number | null;
  plugin_name: string;
  status: string;
  parameters?: Record<string, unknown>;
  [key: string]: unknown;
}

/** Raw feed data shape from chrisapi. */
interface RawFeed {
  id: number;
  name: string;
  [key: string]: unknown;
}

/** chrisapi client shape for the calls we need. */
interface ChrisClient {
  getPluginInstances(params?: Record<string, unknown>): Promise<{
    data: RawInstance[];
    hasNextPage?: boolean;
    getNext?(): Promise<{ data: RawInstance[] }>;
  }>;
  getFeeds(params?: Record<string, unknown>): Promise<{
    data: RawFeed[];
  }>;
}

const TERMINAL_STATUSES: ReadonlySet<string> = new Set([
  'finishedSuccessfully',
  'finishedWithError',
  'cancelled',
]);

/** Virtual filenames inside each instance directory. */
const INSTANCE_FILES: ReadonlySet<string> = new Set(['status', 'params', 'log']);

/** Virtual filenames inside each feed directory. */
const FEED_FILES: ReadonlySet<string> = new Set(['status', 'title']);

/**
 * Builds or rebuilds the ProcCache from the ChRIS API.
 * Fetches all visible plugin instances in one paginated call,
 * groups by feed_id.
 */
async function procCache_build(): Promise<void> {
  const cache: ProcCache = procCache_get();
  cache.cache_clear();

  const client = await chrisConnection.client_get();
  if (!client) {
    errorStack.stack_push('error', 'procCache_build: not connected');
    return;
  }

  const typedClient = client as unknown as ChrisClient;

  // Fetch all feeds for title lookup
  const feedsResp = await typedClient.getFeeds({ limit: 1000 });
  const feedMap: Map<number, string> = new Map();
  for (const f of (feedsResp.data as RawFeed[])) {
    feedMap.set(f.id, f.name);
  }

  // Fetch all plugin instances (paginated)
  const allInstances: RawInstance[] = [];
  let page = await typedClient.getPluginInstances({ limit: 100 });
  allInstances.push(...(page.data as RawInstance[]));

  while (page.hasNextPage && page.getNext) {
    page = await page.getNext();
    allInstances.push(...(page.data as RawInstance[]));
  }

  // Register feeds encountered in instances
  for (const inst of allInstances) {
    const feedID: number = inst.feed_id;
    if (!cache.feed_get(feedID)) {
      cache.feed_add({
        id: feedID,
        title: feedMap.get(feedID) ?? `feed_${feedID}`,
      });
    }
  }

  // Register all instances
  for (const inst of allInstances) {
    const params: Record<string, unknown> = {};
    if (inst.parameters) {
      for (const [k, v] of Object.entries(inst.parameters)) {
        params[k] = v;
      }
    }
    cache.instance_add({
      id: inst.id,
      feedID: inst.feed_id,
      parentID: inst.previous_id ?? null,
      pluginName: inst.plugin_name,
      status: inst.status,
      params: Object.keys(params).length > 0 ? params : null,
    });
  }

  cache.built_set();
}

/** Ensures cache is built, building it on first access. */
async function cache_ensure(): Promise<void> {
  if (!procCache_get().built) {
    await procCache_build();
  }
}

/** Derives aggregate feed status from its instances. */
function feedStatus_derive(feedID: number): string {
  const cache: ProcCache = procCache_get();
  const allIDs: number[] = getAllInstanceIDs_forFeed(feedID, cache);
  if (allIDs.length === 0) return 'empty';

  const statuses: string[] = allIDs
    .map((id: number) => cache.instance_get(id)?.status ?? '')
    .filter(Boolean);

  if (statuses.some((s: string) => s === 'finishedWithError')) return 'finishedWithError';
  if (statuses.some((s: string) => !TERMINAL_STATUSES.has(s))) return 'running';
  if (statuses.every((s: string) => s === 'cancelled')) return 'cancelled';
  return 'finishedSuccessfully';
}

/** Collects all instance IDs for a feed recursively. */
function getAllInstanceIDs_forFeed(feedID: number, cache: ProcCache): number[] {
  const result: number[] = [];
  const queue: number[] = [...cache.feedRoots_get(feedID)];
  while (queue.length > 0) {
    const id: number = queue.shift()!;
    result.push(id);
    queue.push(...cache.children_get(id));
  }
  return result;
}

/** Parses a /proc path into its components. */
function procPath_parse(pathStr: string): {
  feedID: number | null;
  instanceID: number | null;
  virtualFile: string | null;
} {
  // /proc/feeds/feed_123/pl-fshack_789/status
  const parts: string[] = pathStr.replace(/^\/proc\/feeds\/?/, '').split('/').filter(Boolean);

  let feedID: number | null = null;
  let instanceID: number | null = null;
  let virtualFile: string | null = null;

  if (parts.length >= 1) {
    const feedMatch: RegExpMatchArray | null = parts[0].match(/^feed_(\d+)$/);
    if (feedMatch) feedID = parseInt(feedMatch[1], 10);
  }

  if (parts.length >= 2) {
    const lastPart: string = parts[parts.length - 1];
    if (FEED_FILES.has(lastPart) || INSTANCE_FILES.has(lastPart)) {
      virtualFile = lastPart;
      if (parts.length >= 3) {
        const instMatch: RegExpMatchArray | null = parts[parts.length - 2].match(/_(\d+)$/);
        if (instMatch) instanceID = parseInt(instMatch[1], 10);
      }
    } else {
      const instMatch: RegExpMatchArray | null = lastPart.match(/_(\d+)$/);
      if (instMatch) instanceID = parseInt(instMatch[1], 10);
    }
  }

  return { feedID, instanceID, virtualFile };
}

/** Formats instance params as key=value lines. */
function params_render(inst: ProcInstance): string {
  if (!inst.params || Object.keys(inst.params).length === 0) {
    return '(no parameters)';
  }
  return Object.entries(inst.params)
    .map(([k, v]: [string, unknown]) => `${k}=${String(v)}`)
    .join('\n');
}

/**
 * VFS provider for the /proc/feeds/ namespace.
 * Backs /proc with ProcCache; does not use listCache.
 */
export class ProcVfsProvider implements VFSProvider {
  readonly prefix: string = '/proc/feeds';

  async list(
    pathStr: string,
    _options?: { sort?: 'name' | 'size' | 'date' | 'owner'; reverse?: boolean }
  ): Promise<Result<VFSItem[]>> {
    await cache_ensure();
    const cache: ProcCache = procCache_get();
    const clean: string = pathStr.replace(/\/$/, '');

    // /proc/feeds — list feeds
    if (clean === '/proc/feeds') {
      const items: VFSItem[] = cache.feedIDs_get().map((feedID: number): VFSItem => {
        const feed: ProcFeed | undefined = cache.feed_get(feedID);
        const status: string = feedStatus_derive(feedID);
        return {
          name: `feed_${feedID}`,
          type: 'job',
          size: 0,
          owner: '',
          date: '',
          title: feed?.title ?? `feed_${feedID}`,
          status,
        };
      });
      return Ok(items);
    }

    const { feedID, instanceID } = procPath_parse(clean);

    // /proc/feeds/feed_N — list root instances + feed virtual files
    if (feedID !== null && instanceID === null) {
      const feed: ProcFeed | undefined = cache.feed_get(feedID);
      if (!feed) return Ok([]);

      const items: VFSItem[] = [];

      // Virtual files
      items.push({ name: 'status', type: 'file', size: 0, owner: '', date: '' });
      items.push({ name: 'title',  type: 'file', size: 0, owner: '', date: '' });

      // Root instance dirs
      for (const rootID of cache.feedRoots_get(feedID)) {
        const inst: ProcInstance | undefined = cache.instance_get(rootID);
        if (!inst) continue;
        items.push({
          name: `${inst.pluginName}_${rootID}`,
          type: 'job',
          size: 0,
          owner: '',
          date: '',
          status: inst.status,
        });
      }
      return Ok(items);
    }

    // /proc/feeds/feed_N/plugin_ID — list children + instance virtual files
    if (feedID !== null && instanceID !== null) {
      const inst: ProcInstance | undefined = cache.instance_get(instanceID);
      if (!inst) return Ok([]);

      // Refresh status if non-terminal
      if (!inst.statusIsTerminal) {
        const fresh: Result<string> = await job_statusFetch(instanceID);
        if (fresh.ok) cache.status_update(instanceID, fresh.value);
      }

      const items: VFSItem[] = [];
      items.push({ name: 'status', type: 'file', size: 0, owner: '', date: '' });
      items.push({ name: 'params', type: 'file', size: 0, owner: '', date: '' });
      items.push({ name: 'log',    type: 'file', size: 0, owner: '', date: '' });

      for (const childID of cache.children_get(instanceID)) {
        const child: ProcInstance | undefined = cache.instance_get(childID);
        if (!child) continue;
        items.push({
          name: `${child.pluginName}_${childID}`,
          type: 'job',
          size: 0,
          owner: '',
          date: '',
          status: child.status,
        });
      }
      return Ok(items);
    }

    return Ok([]);
  }

  async read(pathStr: string): Promise<Result<string>> {
    await cache_ensure();
    const cache: ProcCache = procCache_get();
    const clean: string = pathStr.replace(/\/$/, '');
    const { feedID, instanceID, virtualFile } = procPath_parse(clean);

    // Feed-level virtual files
    if (feedID !== null && instanceID === null && virtualFile !== null) {
      const feed: ProcFeed | undefined = cache.feed_get(feedID);
      if (!feed) return Ok('');
      if (virtualFile === 'status') return Ok(feedStatus_derive(feedID));
      if (virtualFile === 'title') return Ok(feed.title);
      return Ok('');
    }

    // Instance-level virtual files
    if (instanceID !== null && virtualFile !== null) {
      const inst: ProcInstance | undefined = cache.instance_get(instanceID);
      if (!inst) return Ok('');

      if (virtualFile === 'status') {
        if (!inst.statusIsTerminal) {
          const fresh: Result<string> = await job_statusFetch(instanceID);
          if (fresh.ok) {
            cache.status_update(instanceID, fresh.value);
            return Ok(fresh.value);
          }
        }
        return Ok(inst.status);
      }

      if (virtualFile === 'params') return Ok(params_render(inst));

      if (virtualFile === 'log') {
        const logResult: Result<string> = await job_logFetch(instanceID);
        return Ok(logResult.ok ? logResult.value : '(log unavailable)');
      }
    }

    return Ok('');
  }

  async rm(pathStr: string, _options?: { recursive?: boolean; force?: boolean }): Promise<boolean> {
    await cache_ensure();
    const cache: ProcCache = procCache_get();
    const clean: string = pathStr.replace(/\/$/, '');
    const { feedID, instanceID } = procPath_parse(clean);

    // rm /proc/feeds/feed_N — delete entire feed (requires recursive)
    if (feedID !== null && instanceID === null) {
      const allIDs: number[] = getAllInstanceIDs_forFeed(feedID, cache);
      for (const id of allIDs) {
        const inst: ProcInstance | undefined = cache.instance_get(id);
        if (inst && !inst.statusIsTerminal) {
          await job_cancel(id);
        }
      }
      cache.feed_remove(feedID);
      return true;
    }

    // rm /proc/feeds/feed_N/plugin_ID — cancel or delete single instance
    if (instanceID !== null) {
      const inst: ProcInstance | undefined = cache.instance_get(instanceID);
      if (!inst) return false;

      let result: Result<boolean>;
      if (!inst.statusIsTerminal) {
        result = await job_cancel(instanceID);
        if (result.ok) cache.status_update(instanceID, 'cancelled');
      } else {
        result = await job_delete(instanceID);
        if (result.ok) cache.instance_remove(instanceID);
      }
      return result.ok;
    }

    return false;
  }

  // ProcVfsProvider is read-only except for rm
  async cp(_src: string, _dst: string, _options?: CpOptions): Promise<boolean> { return false; }
  async mv(_src: string, _dst: string): Promise<boolean> { return false; }
  async mkdir(_pathStr: string): Promise<boolean> { return false; }
  async touch(_pathStr: string): Promise<boolean> { return false; }
  async upload(_localPath: string, _remotePath: string): Promise<boolean> { return false; }
  async write(_pathStr: string, _content: string): Promise<boolean> { return false; }
}

/**
 * Rebuilds the ProcCache, optionally scoped to one feed.
 *
 * @param feedID - Optional feed ID to scope the rebuild.
 */
export async function procCache_refresh(feedID?: number): Promise<void> {
  if (feedID !== undefined) {
    // Scoped rebuild: remove existing feed entries then re-fetch
    procCache_get().feed_remove(feedID);
    const client = await chrisConnection.client_get();
    if (!client) return;

    const typedClient = client as unknown as ChrisClient;
    const page = await typedClient.getPluginInstances({ feed_id: feedID, limit: 1000 });
    const cache: ProcCache = procCache_get();

    for (const inst of (page.data as RawInstance[])) {
      if (!cache.feed_get(feedID)) {
        cache.feed_add({ id: feedID, title: `feed_${feedID}` });
      }
      cache.instance_add({
        id: inst.id,
        feedID: inst.feed_id,
        parentID: inst.previous_id ?? null,
        pluginName: inst.plugin_name,
        status: inst.status,
        params: null,
      });
    }
  } else {
    await procCache_build();
  }
}
