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
  output_path?: string;
  [key: string]: unknown;
}

/** Raw feed data from chrisapi (includes job count fields). */
interface RawFeed {
  id: number;
  name: string;
  owner_username?: string;
  public?: boolean;
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
  totalCount?: number;
}

/** One resolved parameter value recorded on a plugin instance. */
interface RawInstanceParameter {
  param_name?: string;
  value?: unknown;
}

/** Paginated parameter collection exposed by a plugin-instance resource. */
interface InstanceParameterList {
  data?: RawInstanceParameter[] | null;
  totalCount?: number;
  getItems?: () => Array<{ data: RawInstanceParameter }>;
}

/** Detail resource through which CUBE exposes an instance's effective parameters. */
interface InstanceResource {
  data?: Record<string, unknown>;
  getParameters(params?: { limit: number; offset: number }): Promise<InstanceParameterList>;
}

/** Client operation needed for lazy instance-parameter resolution. */
interface InstanceDetailClient {
  getPluginInstance(id: number): Promise<InstanceResource | null>;
}

interface ChrisClient {
  getPluginInstances(params?: Record<string, unknown>): Promise<ChrisListResource<RawInstance>>;
  getFeeds(params?: Record<string, unknown>): Promise<ChrisListResource<RawFeed>>;
  getPublicFeeds?(params?: Record<string, unknown>): Promise<ChrisListResource<RawFeed>>;
}

type FeedPageFetch = (params: Record<string, unknown>) => Promise<ChrisListResource<RawFeed>>;

/** Virtual filenames inside each instance directory. */
const INSTANCE_FILES: ReadonlySet<string> = new Set(['status', 'params', 'log', 'data']);
/** Virtual filenames inside each feed directory. */
const FEED_FILES: ReadonlySet<string> = new Set(['status', 'title']);

const PROC_JOBS_PREFIX: string = '/proc/jobs';
const PAGE: number = 100;
let procTopologyPromise: Promise<void> | null = null;
let procTopologyFailure: string | undefined;

/** Private continuation state retained when a topology page request fails. */
interface ProcTopologySweepState {
  offset: number;
  total: number;
  fetchedInstanceIDs: Set<number>;
  seenInstanceIDs: Set<number>;
  seenFeedIDs: Set<number>;
}

let procTopologyResumeState: ProcTopologySweepState | null = null;
let procTopologyScopedResumeFeedIDs: number[] | null = null;

/** Lifecycle states for the session's global topology sweep. */
export type ProcTopologyState = 'idle' | 'running' | 'complete' | 'failed';

/**
 * Observable lifecycle of the session's global topology sweep.
 *
 * @property state - Current topology sweep lifecycle state.
 * @property failure - Failure reason when `state` is `failed`.
 */
export interface ProcTopologyStatus {
  state: ProcTopologyState;
  failure?: string;
}

/** Converts a CUBE feed row into the cache's feed model. */
function procFeed_create(feed: RawFeed): ProcFeed {
  return {
    id: Number(feed.id),
    title: String(feed.name),
    ownerUsername: String(feed.owner_username ?? ''),
    public: Boolean(feed.public ?? false),
    creationDate: String(feed.creation_date ?? ''),
    finishedJobs: Number(feed.finished_jobs ?? 0),
    erroredJobs: Number(feed.errored_jobs ?? 0),
    startedJobs: Number(feed.started_jobs ?? 0),
    scheduledJobs: Number(feed.scheduled_jobs ?? 0),
    cancelledJobs: Number(feed.cancelled_jobs ?? 0),
    createdJobs: Number(feed.created_jobs ?? 0),
  };
}

/** Indexes one complete paginated CUBE feed collection into the shared cache. */
async function procFeeds_index(page_fetch: FeedPageFetch, indexed: Map<number, ProcFeed>): Promise<void> {
  let offset: number = 0;
  let total: number = 0;
  const seenFeedIDs: Set<number> = new Set();

  while (true) {
    const page: ChrisListResource<RawFeed> = await page_fetch({ limit: PAGE, offset });
    const chunk: RawFeed[] = page.data ?? [];
    if (offset === 0 && typeof page.totalCount === 'number' && page.totalCount >= 0) {
      total = page.totalCount;
    }
    for (const feed of chunk) {
      const procFeed: ProcFeed = procFeed_create(feed);
      indexed.set(procFeed.id, procFeed);
      seenFeedIDs.add(Number(feed.id));
    }
    if (chunk.length === 0 || (total > 0 && seenFeedIDs.size >= total)) break;
    if (total === 0 && chunk.length < PAGE) break;
    offset += chunk.length;
  }
}

// ── Cache build ────────────────────────────────────────────────────────────

/**
 * Builds the feed index (fast). Fetches owned/shared and public feeds with job counters.
 * Instance topology is loaded separately via procTopology_warmup().
 */
async function procCache_build(): Promise<number[]> {
  const cache: ProcCache = procCache_get();

  const client = await chrisConnection.client_get();
  if (!client) {
    errorStack.stack_push('error', 'procCache_build: not connected');
    throw new Error('not connected');
  }

  const typedClient: ChrisClient = client as unknown as ChrisClient;
  const indexed: Map<number, ProcFeed> = new Map();
  await procFeeds_index(typedClient.getFeeds.bind(typedClient), indexed);
  if (typedClient.getPublicFeeds) {
    await procFeeds_index(typedClient.getPublicFeeds.bind(typedClient), indexed);
  }

  const reconciliationTargets: number[] = cache.feeds_reconcile(Array.from(indexed.values()));
  cache.built_set();
  return reconciliationTargets;
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
  if (!client) throw new Error('not connected');

  const typedClient: ChrisClient = client as unknown as ChrisClient;
  const instances: Map<number, RawInstance> = new Map();
  let offset: number = 0;
  let total: number = 0;

  while (true) {
    const page: ChrisListResource<RawInstance> = await typedClient.getPluginInstances({
      feed_id: feedID, limit: PAGE, offset,
    });
    const chunk: RawInstance[] = page.data ?? [];
    if (offset === 0 && typeof page.totalCount === 'number' && page.totalCount >= 0) {
      total = page.totalCount;
    }
    for (const instance of chunk) instances.set(Number(instance.id), instance);
    if (chunk.length === 0 || (total > 0 && instances.size >= total)) break;
    if (total === 0 && chunk.length < PAGE) break;
    offset += chunk.length;
  }

  for (const inst of instances.values()) {
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
      outputPath: outputPath_normalize(inst.output_path) ?? undefined,
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
export async function feedInstances_ensureLoaded(feedID: number): Promise<void> {
  const cache: ProcCache = procCache_get();
  if (cache.topologyLoaded_has(feedID)) return;

  const inflight: Promise<void> | undefined = cache.loading_get(feedID);
  if (inflight) return inflight;

  const promise: Promise<void> = feedInstances_load(feedID);
  cache.loading_set(feedID, promise);
  try {
    await promise;
  } finally {
    cache.loading_clear(feedID);
  }
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
  let relativePath: string = pathStr;
  if (pathStr === PROC_JOBS_PREFIX) {
    relativePath = '';
  } else if (pathStr.startsWith(`${PROC_JOBS_PREFIX}/`)) {
    relativePath = pathStr.slice(PROC_JOBS_PREFIX.length + 1);
  }
  const parts: string[] = relativePath.split('/').filter(Boolean);
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

/**
 * Normalizes CUBE's output-path spelling into an absolute CFS path.
 *
 * @param value - Raw `output_path` value from a plugin-instance resource.
 * @returns Absolute CFS path, or null when no usable path was supplied.
 */
function outputPath_normalize(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const clean: string = value.trim();
  return clean.startsWith('/') ? clean : `/${clean}`;
}

/**
 * Resolves and memoizes the authoritative CFS output directory for one job.
 *
 * @param instanceID - Plugin-instance ID whose output path is needed.
 * @returns Absolute output path, or null when CUBE has not recorded one.
 */
async function instanceOutputPath_ensure(instanceID: number): Promise<string | null> {
  const cache: ProcCache = procCache_get();
  const inst: ProcInstance | undefined = cache.instance_get(instanceID);
  if (!inst) return null;
  if (inst.outputPath !== undefined) return inst.outputPath;

  const client = await chrisConnection.client_get();
  if (!client) return null;
  try {
    const resource: InstanceResource | null = await (client as unknown as InstanceDetailClient)
      .getPluginInstance(instanceID);
    const outputPath: string | null = outputPath_normalize(resource?.data?.['output_path']);
    cache.outputPath_update(instanceID, outputPath);
    return outputPath;
  } catch (error: unknown) {
    // "No CFS output path" downstream must not mask a failed fetch.
    const msg: string = error instanceof Error ? error.message : String(error);
    errorStack.stack_push("warning", `Could not fetch output path for instance ${instanceID}: ${msg}`);
    return null;
  }
}

/**
 * Reads every page of effective parameter values from one plugin instance.
 *
 * @param resource - Detail resource for the instance being inspected.
 * @returns Parameter names mapped to their recorded invocation values.
 */
async function instanceParams_fetch(resource: InstanceResource): Promise<Record<string, unknown>> {
  const params: Record<string, unknown> = {};
  let offset: number = 0;
  let total: number = 0;
  let fetched: number = 0;

  while (true) {
    const page: InstanceParameterList = await resource.getParameters({ limit: PAGE, offset });
    const items: RawInstanceParameter[] = page.data
      ?? (page.getItems ? page.getItems().map((item: { data: RawInstanceParameter }): RawInstanceParameter => item.data) : []);
    if (offset === 0 && typeof page.totalCount === 'number' && page.totalCount >= 0) {
      total = page.totalCount;
    }
    for (const item of items) {
      if (item.param_name) params[item.param_name] = item.value;
    }
    fetched += items.length;
    if (items.length === 0 || (total > 0 && fetched >= total)) break;
    if (total === 0 && items.length < PAGE) break;
    offset += items.length;
  }

  return params;
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
  readonly prefix: string = PROC_JOBS_PREFIX;

  /**
   * Resolves the synthetic `data` link for one job only when navigation asks
   * to follow it. This keeps `/proc` topology listings and recursive trees
   * entirely cache-backed.
   *
   * @param pathStr - Absolute `/proc/jobs/.../data` path to resolve.
   * @returns The authoritative CFS output path, or an error when absent.
   */
  async linkTarget_resolve(pathStr: string): Promise<Result<string>> {
    await cache_ensure();
    const clean: string = pathStr.replace(/\/$/, '');
    const { feedID, instanceID, virtualFile } = procPath_parse(clean);
    if (feedID === null || instanceID === null || virtualFile !== 'data') {
      errorStack.stack_push('error', `Not a /proc job data link: ${pathStr}`);
      return Err();
    }

    const outputPath: string | null = await instanceOutputPath_ensure(instanceID);
    if (outputPath) return Ok(outputPath);

    errorStack.stack_push('error', `No CFS output path is available for job ${instanceID}`);
    return Err();
  }

  async list(
    pathStr: string,
    _options?: { sort?: 'name' | 'size' | 'date' | 'owner'; reverse?: boolean }
  ): Promise<Result<VFSItem[]>> {
    await cache_ensure();
    const cache: ProcCache = procCache_get();
    const clean: string = pathStr.replace(/\/$/, '');

    // /proc/jobs — list all feeds with aggregate status from counters
    if (clean === PROC_JOBS_PREFIX) {
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
      // `data` is structural: list it without fetching the per-instance detail
      // endpoint. Its target is resolved only when `cd data` follows the link.
      // A known null means CUBE has no output directory, so omit it entirely.
      if (inst.outputPath !== null) {
        const dataLink: VFSItem = { name: 'data', type: 'link', size: 0, owner: '', date: '' };
        if (inst.outputPath) dataLink.target = inst.outputPath;
        items.push(dataLink);
      }

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
          // CUBE stores the effective run values in the parameter sub-resource;
          // the instance detail payload itself is operational metadata.
          const client = await chrisConnection.client_get();
          if (client) {
            try {
              const resource: InstanceResource | null = await (client as unknown as InstanceDetailClient)
                .getPluginInstance(instanceID);
              if (resource) cache.params_update(instanceID, await instanceParams_fetch(resource));
            } catch {
              // Deliberate absorption, adjudicated 2026-08: parameters are a
              // lazy display enrichment; a failed fetch renders as
              // "(no parameters)" and the next read retries.
            }
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
      // Every cancel Result is checked: reporting success while jobs kept
      // running would leave the user believing the feed's work was stopped.
      const failedCancels: number[] = [];
      await Promise.all(allIDs.map(async (id: number) => {
        const s: string = statusMap.get(id) ?? '';
        if (!status_isTerminal(s)) {
          const cancelResult: Result<boolean> = await job_cancel(id);
          if (!cancelResult.ok) failedCancels.push(id);
        }
      }));
      if (failedCancels.length > 0) {
        errorStack.stack_push(
          'error',
          `rm: failed to cancel ${failedCancels.length} running job(s) in feed ${feedID}: instance(s) ${failedCancels.sort((a, b) => a - b).join(', ')}`,
        );
        return false;
      }
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
      id: feedID, title: `feed_${feedID}`, ownerUsername: '', public: false, creationDate: '',
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
/**
 * Ensures a feed's metadata (title + job counters, needed for aggregate status) is cached
 * with real values. No-op when the feed is already present with real metadata; fetches one
 * `getFeeds({id})` only when the feed is missing or a zero-counter placeholder. Does NOT
 * touch instance topology — reuse of the warm cache is the whole point.
 *
 * @param feedID - Feed whose metadata to ensure.
 */
export async function feedMeta_ensure(feedID: number): Promise<void> {
  const cache: ProcCache = procCache_get();
  const existing: ProcFeed | undefined = cache.feed_get(feedID);
  if (existing && existing.creationDate !== '') return;

  const client = await chrisConnection.client_get();
  if (!client) throw new Error('not connected');

  const typedClient: ChrisClient = client as unknown as ChrisClient;
  const page: ChrisListResource<RawFeed> = await typedClient.getFeeds({ id: feedID, limit: 1, offset: 0 });
  const f: RawFeed | undefined = (page.data ?? [])[0];
  if (!f) return;

  cache.feed_add(procFeed_create(f));
}

export async function feedStatus_refresh(feedID: number): Promise<void> {
  const cache: ProcCache = procCache_get();
  const client = await chrisConnection.client_get();
  if (!client) return;

  const typedClient: ChrisClient = client as unknown as ChrisClient;
  let offset: number = 0;
  let total: number = 0;
  const seenInstanceIDs: Set<number> = new Set();

  while (true) {
    const page: ChrisListResource<RawInstance> = await typedClient.getPluginInstances({
      feed_id: feedID, limit: PAGE, offset,
    });
    const chunk: RawInstance[] = page.data ?? [];
    if (offset === 0 && typeof page.totalCount === 'number' && page.totalCount >= 0) {
      total = page.totalCount;
    }
    for (const inst of chunk) {
      const instanceID: number = Number(inst.id);
      cache.status_update(instanceID, String(inst.status ?? 'unknown'));
      seenInstanceIDs.add(instanceID);
    }
    if (chunk.length === 0 || (total > 0 && seenInstanceIDs.size >= total)) break;
    if (total === 0 && chunk.length < PAGE) break;
    offset += chunk.length;
  }
}

/**
 * Background topology warm-up — single paginated sweep of all plugin instances
 * across all feeds. Replaces the per-feed fan-out that was O(feeds) round trips.
 *
 * Scoped per-feed loads may run concurrently for navigation; the completed
 * global sweep reconciles the cache to its authoritative instance set.
 *
 * @param state - Private pagination and reconciliation state for this sweep.
 * @returns A promise that settles when the complete topology has been reconciled.
 */
async function procTopology_run(state: ProcTopologySweepState): Promise<void> {
  await cache_ensure();
  const cache: ProcCache = procCache_get();
  cache.lifecycle_set('reconciling');
  if (state.total > 0) {
    cache.warmup_progress(state.fetchedInstanceIDs.size, state.total);
  }
  const client = await chrisConnection.client_get();
  if (!client) throw new Error('not connected');

  const typedClient: ChrisClient = client as unknown as ChrisClient;

  while (true) {
    const page: ChrisListResource<RawInstance> = await typedClient.getPluginInstances({
      limit: PAGE, offset: state.offset,
    });
    const chunk: RawInstance[] = page.data ?? [];
    if (state.offset === 0 && typeof page.totalCount === 'number' && page.totalCount >= 0) {
      state.total = page.totalCount;
      if (state.total > 0) cache.warmup_progress(0, state.total);
    }

    for (const inst of chunk) {
      const instanceID: number = Number(inst.id);
      const feedID: number = Number(inst.feed_id);
      state.fetchedInstanceIDs.add(instanceID);
      const prevID: number | null = (inst.previous_id !== null && inst.previous_id !== undefined)
        ? Number(inst.previous_id)
        : null;

      if (!cache.feed_get(feedID)) continue;

      cache.instance_add({
        id: instanceID,
        feedID,
        parentID: prevID,
        pluginName: String(inst.plugin_name),
        pluginType: inst.plugin_type !== undefined ? String(inst.plugin_type) : undefined,
        params: null,
        outputPath: outputPath_normalize(inst.output_path) ?? undefined,
        status: String(inst.status ?? 'unknown'),
      });
      state.seenInstanceIDs.add(instanceID);
      state.seenFeedIDs.add(feedID);
    }

    if (state.total > 0) cache.warmup_progress(state.fetchedInstanceIDs.size, state.total);
    if (chunk.length === 0 || (state.total > 0 && state.fetchedInstanceIDs.size >= state.total)) break;
    if (state.total === 0 && chunk.length < PAGE) break;
    state.offset += chunk.length;
  }

  cache.topology_reconcile(state.seenInstanceIDs);
  for (const feedID of state.seenFeedIDs) cache.topologyLoaded_mark(feedID);
  if (state.total === 0) {
    cache.warmup_progress(state.fetchedInstanceIDs.size, state.fetchedInstanceIDs.size);
  }
  cache.warmup_complete();
}

/**
 * Creates an empty continuation for a fresh global topology sweep.
 *
 * @returns New private pagination and reconciliation state.
 */
function procTopologyState_create(): ProcTopologySweepState {
  return {
    offset: 0,
    total: 0,
    fetchedInstanceIDs: new Set<number>(),
    seenInstanceIDs: new Set<number>(),
    seenFeedIDs: new Set<number>(),
  };
}

/**
 * Starts one topology sweep from the supplied private continuation state.
 *
 * @param state - Private pagination and reconciliation state to run or resume.
 * @returns The in-flight topology sweep promise.
 */
function procTopology_start(state: ProcTopologySweepState): Promise<void> {
  procTopologyFailure = undefined;
  procTopologyResumeState = state;
  procTopologyScopedResumeFeedIDs = null;
  const sweep: Promise<void> = procTopology_run(state);
  procTopologyPromise = sweep;
  sweep.then(
    (): void => {
      if (procTopologyPromise !== sweep) return;
      procTopologyPromise = null;
      if (procCache_get().warmupComplete) {
        procTopologyFailure = undefined;
        procTopologyResumeState = null;
      } else {
        procTopologyFailure = 'the topology sweep ended before the index completed';
      }
    },
    (error: unknown): void => {
      if (procTopologyPromise !== sweep) return;
      procTopologyPromise = null;
      procCache_get().warmup_abort();
      procTopologyFailure = error instanceof Error ? error.message : String(error);
    },
  );
  return sweep;
}

/**
 * Runs a feed-scoped topology reconciliation selected after checkpoint restore.
 *
 * @param feedIDs - Canonical feed IDs whose topology needs a fresh load.
 * @returns A promise that settles after the supplied feeds are reconciled.
 */
async function procTopologyScoped_run(feedIDs: number[]): Promise<void> {
  const cache: ProcCache = procCache_get();
  cache.lifecycle_set('reconciling');
  for (const feedID of feedIDs) await procCache_refresh(feedID);
  cache.warmup_complete();
}

/**
 * Starts one scoped reconciliation and retains its targets for `proc retry`.
 *
 * @param feedIDs - Canonical feed IDs selected by the fresh feed index.
 * @returns The in-flight scoped reconciliation promise.
 */
function procTopologyScoped_start(feedIDs: number[]): Promise<void> {
  const targets: number[] = [...feedIDs];
  procTopologyFailure = undefined;
  procTopologyResumeState = null;
  procTopologyScopedResumeFeedIDs = targets;
  const sweep: Promise<void> = procTopologyScoped_run(targets);
  procTopologyPromise = sweep;
  sweep.then(
    (): void => {
      if (procTopologyPromise !== sweep) return;
      procTopologyPromise = null;
      if (procCache_get().warmupComplete) {
        procTopologyFailure = undefined;
        procTopologyScopedResumeFeedIDs = null;
      } else {
        procTopologyFailure = 'the scoped topology reconciliation ended before the index completed';
      }
    },
    (error: unknown): void => {
      if (procTopologyPromise !== sweep) return;
      procTopologyPromise = null;
      procCache_get().warmup_abort();
      procTopologyFailure = error instanceof Error ? error.message : String(error);
    },
  );
  return sweep;
}

/**
 * Starts or joins the session's global plugin-instance topology sweep.
 *
 * @returns The single in-flight sweep promise.
 */
export function procTopology_warmup(): Promise<void> {
  if (procTopologyPromise) return procTopologyPromise;
  return procTopology_start(procTopologyState_create());
}

/**
 * Reconciles topology only for feed IDs selected by a restored-cache feed-index
 * comparison. This preserves the checkpointed topology for unchanged terminal
 * feeds while refreshing new, changed, and active feeds from CUBE.
 *
 * @param feedIDs - Canonical CUBE feed IDs whose topology must be reloaded.
 * @returns A promise that resolves after all supplied feeds have been refreshed.
 */
export function procTopology_reconcileFeeds(feedIDs: number[]): Promise<void> {
  if (procTopologyPromise) return procTopologyPromise;
  return procTopologyScoped_start(feedIDs);
}

/**
 * Continues a failed topology reconciliation from its retained global page or
 * scoped feed set.
 *
 * @returns The resumed sweep promise, or the active sweep when one is running.
 * @throws {Error} When there is no failed sweep continuation to retry.
 */
export function procTopology_retry(): Promise<void> {
  if (procTopologyPromise) return procTopologyPromise;
  if (procTopologyFailure === undefined) {
    throw new Error('no failed topology sweep to retry');
  }
  if (procTopologyResumeState) return procTopology_start(procTopologyResumeState);
  if (procTopologyScopedResumeFeedIDs) return procTopologyScoped_start(procTopologyScopedResumeFeedIDs);
  throw new Error('no failed topology sweep to retry');
}

/**
 * Reports the session topology sweep lifecycle.
 *
 * @returns A snapshot of the lifecycle state and any failure reason.
 */
export function procTopology_status(): ProcTopologyStatus {
  if (procTopologyPromise) return { state: 'running', failure: undefined };
  if (procTopologyFailure !== undefined) return { state: 'failed', failure: procTopologyFailure };
  if (procCache_get().warmupComplete) return { state: 'complete', failure: undefined };
  return { state: 'idle', failure: undefined };
}

/**
 * Waits for the active topology sweep without starting another.
 *
 * @returns A promise that resolves when the active sweep finishes, or
 * immediately when no sweep is running.
 */
export async function procTopology_await(): Promise<void> {
  const sweep: Promise<void> | null = procTopologyPromise;
  if (sweep) await sweep;
}

/**
 * Rebuilds the ProcCache, optionally scoped to one feed.
 *
 * A full refresh returns feeds whose topology merits reload after the feed-index
 * comparison. Callers performing an explicit `proc refresh` can ignore that
 * result and run a global topology sweep; restored startup uses it to stay scoped.
 *
 * @param feedID - One feed to force-refresh, or undefined for the full feed index.
 * @returns IDs whose topology is new, changed, or currently active.
 */
export async function procCache_refresh(feedID?: number): Promise<number[]> {
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
        cache.feed_add(procFeed_create(f));
      }
    }
    await feedInstances_ensureLoaded(feedID);
    return [feedID];
  } else {
    const activeSweep: Promise<void> | null = procTopologyPromise;
    if (activeSweep) {
      try {
        await activeSweep;
      } catch {
        // A full refresh replaces any failed sweep with a new idle lifecycle.
      }
    }
    procTopologyPromise = null;
    procTopologyFailure = undefined;
    procTopologyResumeState = null;
    procTopologyScopedResumeFeedIDs = null;
    procCache_get().warmup_reset();
    return procCache_build();
  }
}
