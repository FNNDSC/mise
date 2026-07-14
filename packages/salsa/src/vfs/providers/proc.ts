/**
 * @file /proc VFS Provider
 *
 * Surfaces ChRIS plugin instances as a navigable DAG under /proc/jobs/.
 * Backed by ProcCache (topology only — no status stored).
 *
 * Status is always fetched live:
 * - cat .../status        → getPluginInstance(id)
 * - ls -l /proc/jobs/N   → jobs_statusBatch(allNodeIDs) — parallel
 * - ls /proc/jobs        → aggregate from ProcFeed job counters (no API)
 *
 * @module
 */

import {
  chrisConnection,
  errorStack,
  procCache_get,
  ProcCache,
  ProcInstance,
  ProcFeed,
  status_isTerminal,
  Result,
  Ok,
  Err,
} from '@fnndsc/cumin';
import { VFSProvider, VFSItem, CpOptions } from '../provider.js';
import { job_cancel, job_delete, job_statusFetch, job_logFetch, jobs_statusBatch } from '../../jobs/index.js';

/** Raw instance data from chrisapi. */
interface RawInstance {
  id: number;
  feed_id: number;
  previous_id: number | null;
  plugin_name: string;
  plugin_type?: string;
  status: string;
  [key: string]: unknown;
}

/** Raw feed data from chrisapi (includes job count fields). */
interface RawFeed {
  id: number;
  name: string;
  creation_date?: string;
  finished_jobs?: number;
  errored_jobs?: number;
  started_jobs?: number;
  scheduled_jobs?: number;
  cancelled_jobs?: number;
  created_jobs?: number;
  [key: string]: unknown;
}

interface ChrisListResource<T> {
  data: T[] | null;
}

interface ChrisClient {
  getPluginInstances(params?: Record<string, unknown>): Promise<ChrisListResource<RawInstance>>;
  getFeeds(params?: Record<string, unknown>): Promise<ChrisListResource<RawFeed>>;
}

/** Virtual filenames inside each instance directory. */
const INSTANCE_FILES: ReadonlySet<string> = new Set(['status', 'params', 'log']);
/** Virtual filenames inside each feed directory. */
const FEED_FILES: ReadonlySet<string> = new Set(['status', 'title']);

const PAGE: number = 100;

// ── Cache build ────────────────────────────────────────────────────────────

/**
 * Builds the feed index (fast). Fetches all feeds with job counters.
 * Instance topology is loaded separately via procTopology_warmup().
 */
async function procCache_build(): Promise<void> {
  const cache: ProcCache = procCache_get();
  cache.cache_clear();

  const client = await chrisConnection.client_get();
  if (!client) {
    errorStack.stack_push('error', 'procCache_build: not connected');
    return;
  }

  const typedClient: ChrisClient = client as unknown as ChrisClient;
  let feedOffset: number = 0;

  while (true) {
    const feedPage: ChrisListResource<RawFeed> = await typedClient.getFeeds({ limit: PAGE, offset: feedOffset });
    const chunk: RawFeed[] = feedPage.data ?? [];
    for (const f of chunk) {
      cache.feed_add({
        id: Number(f.id),
        title: String(f.name),
        creationDate:   String(f.creation_date ?? ''),
        finishedJobs:   Number(f.finished_jobs  ?? 0),
        erroredJobs:    Number(f.errored_jobs    ?? 0),
        startedJobs:    Number(f.started_jobs    ?? 0),
        scheduledJobs:  Number(f.scheduled_jobs  ?? 0),
        cancelledJobs:  Number(f.cancelled_jobs  ?? 0),
        createdJobs:    Number(f.created_jobs    ?? 0),
      });
    }
    if (chunk.length < PAGE) break;
    feedOffset += PAGE;
  }

  cache.built_set();
}

/** Ensures the feed index is built, building it on first access. */
async function cache_ensure(): Promise<void> {
  if (!procCache_get().built) {
    await procCache_build();
  }
}

/**
 * Loads instance topology for a single feed.
 * Uses in-flight map to prevent duplicate API calls.
 */
async function feedInstances_load(feedID: number): Promise<void> {
  const cache: ProcCache = procCache_get();
  const client = await chrisConnection.client_get();
  if (!client) return;

  const typedClient: ChrisClient = client as unknown as ChrisClient;
  const instances: RawInstance[] = [];
  let offset: number = 0;

  while (true) {
    const page: ChrisListResource<RawInstance> = await typedClient.getPluginInstances({
      feed_id: feedID, limit: PAGE, offset,
    });
    const chunk: RawInstance[] = page.data ?? [];
    instances.push(...chunk);
    if (chunk.length < PAGE) break;
    offset += PAGE;
  }

  for (const inst of instances) {
    const prevID: number | null = (inst.previous_id !== null && inst.previous_id !== undefined)
      ? Number(inst.previous_id)
      : null;
    cache.instance_add({
      id: Number(inst.id),
      feedID: Number(inst.feed_id),
      parentID: prevID,
      pluginName: String(inst.plugin_name),
      pluginType: inst.plugin_type !== undefined ? String(inst.plugin_type) : undefined,
      params: null,
      status: String(inst.status ?? 'unknown'),
    });
  }

  cache.topologyLoaded_mark(feedID);
}

/**
 * Ensures topology for a feed is loaded.
 * Per-feed loads proceed immediately even while the global sweep is running —
 * instance_add is idempotent so concurrent additions are safe.
 */
async function feedInstances_ensureLoaded(feedID: number): Promise<void> {
  const cache: ProcCache = procCache_get();
  if (cache.topologyLoaded_has(feedID)) return;

  const inflight: Promise<void> | undefined = cache.loading_get(feedID);
  if (inflight) return inflight;

  const promise: Promise<void> = feedInstances_load(feedID);
  cache.loading_set(feedID, promise);
  await promise;
  cache.loading_clear(feedID);
}

// ── Aggregate status ───────────────────────────────────────────────────────

/** Derives aggregate feed status from stored job counters — no API call. */
export function feedStatus_derive(feed: ProcFeed): string {
  if (feed.erroredJobs > 0) return 'finishedWithError';
  const running: number = feed.startedJobs + feed.scheduledJobs + feed.createdJobs;
  if (running > 0) return 'running';
  if (feed.cancelledJobs > 0 && feed.finishedJobs === 0) return 'cancelled';
  if (feed.finishedJobs > 0) return 'finishedSuccessfully';
  return 'empty';
}

// ── Path parsing ───────────────────────────────────────────────────────────

export function procPath_parse(pathStr: string): {
  feedID: number | null;
  instanceID: number | null;
  virtualFile: string | null;
} {
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
  if (!inst.params || Object.keys(inst.params).length === 0) return '(no parameters)';
  return Object.entries(inst.params)
    .map(([k, v]: [string, unknown]) => `${k}=${String(v)}`)
    .join('\n');
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

// ── Provider ───────────────────────────────────────────────────────────────

/**
 * VFS provider exposing running jobs and feeds under the /proc namespace.
 */
export class ProcVfsProvider implements VFSProvider {
  readonly prefix: string = '/proc/jobs';

  async list(
    pathStr: string,
    _options?: { sort?: 'name' | 'size' | 'date' | 'owner'; reverse?: boolean }
  ): Promise<Result<VFSItem[]>> {
    await cache_ensure();
    const cache: ProcCache = procCache_get();
    const clean: string = pathStr.replace(/\/$/, '');

    // /proc/jobs — list all feeds with aggregate status from counters
    if (clean === '/proc/jobs') {
      const items: VFSItem[] = cache.feedIDs_get().map((feedID: number): VFSItem => {
        const feed: ProcFeed | undefined = cache.feed_get(feedID);
        const status: string = feed ? feedStatus_derive(feed) : 'unknown';
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

    // /proc/jobs/feed_N — list root instances + feed virtual files
    if (feedID !== null && instanceID === null) {
      const wasLoaded: boolean = cache.topologyLoaded_has(feedID);
      await feedInstances_ensureLoaded(feedID);
      const feed: ProcFeed | undefined = cache.feed_get(feedID);
      if (!feed) return Ok([]);

      const rootIDs: number[] = cache.feedRoots_get(feedID);
      // The initial load already carried live status; only re-fetch when revisiting
      // a feed that still has active (non-terminal) nodes among those shown. One
      // feed-scoped list call updates all of them — no per-node detail fetches.
      if (wasLoaded && rootIDs.some((id: number) => !status_isTerminal(cache.instance_get(id)?.status))) {
        await feedStatus_refresh(feedID);
      }

      const items: VFSItem[] = [];
      items.push({ name: 'status', type: 'file', size: 0, owner: '', date: '' });
      items.push({ name: 'title',  type: 'file', size: 0, owner: '', date: '' });

      for (const rootID of rootIDs) {
        const inst: ProcInstance | undefined = cache.instance_get(rootID);
        if (!inst) continue;
        items.push({
          name: `${inst.pluginName}_${rootID}`,
          type: 'job',
          size: 0,
          owner: '',
          date: '',
          status: inst.status ?? 'unknown',
        });
      }
      return Ok(items);
    }

    // /proc/jobs/feed_N/plugin_ID — list children + virtual files
    if (feedID !== null && instanceID !== null) {
      const wasLoaded: boolean = cache.topologyLoaded_has(feedID);
      await feedInstances_ensureLoaded(feedID);
      const inst: ProcInstance | undefined = cache.instance_get(instanceID);
      if (!inst) return Ok([]);

      const childIDs: number[] = cache.children_get(instanceID);
      if (wasLoaded && childIDs.some((id: number) => !status_isTerminal(cache.instance_get(id)?.status))) {
        await feedStatus_refresh(feedID);
      }

      const items: VFSItem[] = [];
      items.push({ name: 'status', type: 'file', size: 0, owner: '', date: '' });
      items.push({ name: 'params', type: 'file', size: 0, owner: '', date: '' });
      items.push({ name: 'log',    type: 'file', size: 0, owner: '', date: '' });

      for (const childID of childIDs) {
        const child: ProcInstance | undefined = cache.instance_get(childID);
        if (!child) continue;
        items.push({
          name: `${child.pluginName}_${childID}`,
          type: 'job',
          size: 0,
          owner: '',
          date: '',
          status: child.status ?? 'unknown',
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
      if (virtualFile === 'status') return Ok(feedStatus_derive(feed));
      if (virtualFile === 'title') return Ok(feed.title);
      return Ok('');
    }

    // Instance-level virtual files — all live or cached-on-first-read
    if (instanceID !== null && virtualFile !== null) {
      await feedInstances_ensureLoaded(feedID!);
      const inst: ProcInstance | undefined = cache.instance_get(instanceID);
      if (!inst) return Ok('');

      if (virtualFile === 'status') {
        // Settled jobs never change — return the cached terminal status, no call.
        if (status_isTerminal(inst.status)) return Ok(inst.status as string);
        const fresh: Result<string> = await job_statusFetch(instanceID);
        if (fresh.ok) cache.status_update(instanceID, fresh.value);
        return Ok(fresh.ok ? fresh.value : (inst.status ?? 'unknown'));
      }

      if (virtualFile === 'params') {
        if (inst.params === null) {
          // Fetch params on first read and cache permanently
          const client = await chrisConnection.client_get();
          if (client) {
            try {
              const raw = await (client as unknown as {
                getPluginInstance(id: number): Promise<{ data: Record<string, unknown> } | null>;
              }).getPluginInstance(instanceID);
              if (raw?.data) {
                const p: Record<string, unknown> = { ...raw.data };
                delete p['id']; delete p['feed_id']; delete p['plugin_name'];
                delete p['status']; delete p['previous_id'];
                cache.params_update(instanceID, p);
              }
            } catch { /* leave null */ }
          }
        }
        return Ok(params_render(inst));
      }

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

    if (feedID !== null && instanceID === null) {
      const allIDs: number[] = getAllInstanceIDs_forFeed(feedID, cache);
      const statusMap: Map<number, string> = await jobs_statusBatch(allIDs);
      await Promise.all(allIDs.map(async (id: number) => {
        const s: string = statusMap.get(id) ?? '';
        if (!status_isTerminal(s)) {
          await job_cancel(id);
        }
      }));
      cache.feed_remove(feedID);
      return true;
    }

    if (instanceID !== null) {
      const statusResult: Result<string> = await job_statusFetch(instanceID);
      const status: string = statusResult.ok ? statusResult.value : '';
      const isTerminal: boolean = status_isTerminal(status);

      let result: Result<boolean>;
      if (!isTerminal) {
        result = await job_cancel(instanceID);
      } else {
        result = await job_delete(instanceID);
        if (result.ok) cache.instance_remove(instanceID);
      }
      return result.ok;
    }

    return false;
  }

  async cp(_src: string, _dst: string, _options?: CpOptions): Promise<boolean> { return false; }
  async mv(_src: string, _dst: string): Promise<boolean> { return false; }
  async mkdir(_pathStr: string): Promise<boolean> { return false; }
  async touch(_pathStr: string): Promise<boolean> { return false; }
  async upload(_localPath: string, _remotePath: string): Promise<boolean> { return false; }
  async write(_pathStr: string, _content: string): Promise<boolean> { return false; }
}

/**
 * Ensures instance topology is loaded for a feed without clearing existing data.
 * Use this from proc find — it respects already-loaded feeds and the in-flight map.
 * Use procCache_refresh(feedID) only when a forced reload is desired.
 */
export async function procFeed_ensureLoaded(feedID: number): Promise<void> {
  const cache: ProcCache = procCache_get();
  if (!cache.feed_get(feedID)) {
    cache.feed_add({
      id: feedID, title: `feed_${feedID}`, creationDate: '',
      finishedJobs: 0, erroredJobs: 0, startedJobs: 0,
      scheduledJobs: 0, cancelledJobs: 0, createdJobs: 0,
    });
  }
  await feedInstances_ensureLoaded(feedID);
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Refreshes volatile job status for one feed via a single paginated LIST sweep.
 *
 * The plugin-instance list response carries `status`, so one feed-scoped list call
 * updates every node — far cheaper than per-node detail fetches. Terminal statuses
 * are frozen by {@link ProcCache.status_update} and never regress.
 *
 * @param feedID - Feed whose instance statuses should be refreshed.
 */
export async function feedStatus_refresh(feedID: number): Promise<void> {
  const cache: ProcCache = procCache_get();
  const client = await chrisConnection.client_get();
  if (!client) return;

  const typedClient: ChrisClient = client as unknown as ChrisClient;
  let offset: number = 0;

  while (true) {
    const page: ChrisListResource<RawInstance> = await typedClient.getPluginInstances({
      feed_id: feedID, limit: PAGE, offset,
    });
    const chunk: RawInstance[] = page.data ?? [];
    for (const inst of chunk) {
      cache.status_update(Number(inst.id), String(inst.status ?? 'unknown'));
    }
    if (chunk.length < PAGE) break;
    offset += PAGE;
  }
}

/**
 * Background topology warm-up — single paginated sweep of all plugin instances
 * across all feeds. Replaces the per-feed fan-out that was O(feeds) round trips.
 *
 * Registers itself as the active sweep so that any concurrent
 * feedInstances_ensureLoaded call waits for this sweep rather than launching
 * its own per-feed API call.
 */
export async function procTopology_warmup(): Promise<void> {
  await cache_ensure();
  const cache: ProcCache = procCache_get();
  const client = await chrisConnection.client_get();
  if (!client) return;

  cache.warmup_progress(0, 0);

  const typedClient: ChrisClient = client as unknown as ChrisClient;
  let offset: number = 0;
  let loaded: number = 0;
  const seenFeedIDs: Set<number> = new Set();

  while (true) {
    const page: ChrisListResource<RawInstance> = await typedClient.getPluginInstances({
      limit: PAGE, offset,
    });
    const chunk: RawInstance[] = page.data ?? [];

    for (const inst of chunk) {
      const feedID: number = Number(inst.feed_id);
      const prevID: number | null = (inst.previous_id !== null && inst.previous_id !== undefined)
        ? Number(inst.previous_id)
        : null;

      if (!cache.feed_get(feedID)) {
        cache.feed_add({
          id: feedID, title: `feed_${feedID}`, creationDate: '',
          finishedJobs: 0, erroredJobs: 0, startedJobs: 0,
          scheduledJobs: 0, cancelledJobs: 0, createdJobs: 0,
        });
      }

      cache.instance_add({
        id: Number(inst.id),
        feedID,
        parentID: prevID,
        pluginName: String(inst.plugin_name),
        pluginType: inst.plugin_type !== undefined ? String(inst.plugin_type) : undefined,
        params: null,
        status: String(inst.status ?? 'unknown'),
      });
      seenFeedIDs.add(feedID);
      loaded++;
    }

    cache.warmup_progress(loaded, 0);
    if (chunk.length < PAGE) break;
    offset += PAGE;
  }

  for (const feedID of seenFeedIDs) {
    cache.topologyLoaded_mark(feedID);
  }
  cache.warmup_complete();
}

/**
 * Rebuilds the ProcCache, optionally scoped to one feed.
 */
export async function procCache_refresh(feedID?: number): Promise<void> {
  if (feedID !== undefined) {
    const cache: ProcCache = procCache_get();
    cache.feed_remove(feedID);
    // Re-fetch feed metadata with job counters
    const client = await chrisConnection.client_get();
    if (client) {
      const typedClient: ChrisClient = client as unknown as ChrisClient;
      const page: ChrisListResource<RawFeed> = await typedClient.getFeeds({ id: feedID, limit: 1, offset: 0 });
      const f: RawFeed | undefined = (page.data ?? [])[0];
      if (f) {
        cache.feed_add({
          id: Number(f.id),
          title: String(f.name),
          creationDate:   String(f.creation_date ?? ''),
          finishedJobs:   Number(f.finished_jobs  ?? 0),
          erroredJobs:    Number(f.errored_jobs    ?? 0),
          startedJobs:    Number(f.started_jobs    ?? 0),
          scheduledJobs:  Number(f.scheduled_jobs  ?? 0),
          cancelledJobs:  Number(f.cancelled_jobs  ?? 0),
          createdJobs:    Number(f.created_jobs    ?? 0),
        });
      }
    }
    await feedInstances_ensureLoaded(feedID);
  } else {
    await procCache_build();
  }
}
