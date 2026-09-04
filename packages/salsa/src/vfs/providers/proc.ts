/**
 * @file /proc VFS Provider
 *
 * Surfaces ChRIS plugin instances as a navigable DAG under /proc/jobs/.
 * Backed by ProcCache: an accumulating index whose terminal entries are
 * immutable and whose freshness is visit-driven.
 *
 * Freshness model (every visit is a cheap delta, never a re-crawl):
 * - ls /proc/jobs        → roster delta (feeds newer than the highest known
 *                          id), and a full index walk once the roster is older
 *                          than {@link ROSTER_FULL_WALK_MS} — so a feed shared
 *                          later still appears within that window;
 * - ls /proc/jobs/N      → first visit loads the topology once; every later
 *                          visit runs {@link feedVisit_sync}: one feed-row
 *                          fetch (job counters), then, only when something
 *                          moved, a `min_end_date` delta walk (nodes created
 *                          or finished since the cursor) plus an `active=true`
 *                          sweep for the nodes still running;
 * - settled feeds        → re-checked at most once per {@link FEED_RECHECK_MS},
 *                          so work appended to a finished feed is still seen;
 * - cat .../status       → getPluginInstance(id), always live.
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
  feed_isActive,
  feedTopology_changed,
  Result,
  Ok,
  Err,
  feedsPage_get,
  publicFeedsPage_get,
  pluginInstancesPage_get,
  pluginInstance_get,
  listPages_walk,
  ListPage,
  FeedData,
  PluginInstanceData,
  PluginInstanceHandle,
  InstanceParameterData,
} from '@fnndsc/cumin';
import { VFSProvider, VFSItem, CpOptions } from '../provider.js';
import { job_cancel, job_delete, job_statusFetch, job_logFetch, jobs_statusBatch } from '../../jobs/index.js';
import { procJoins_sweep } from '../../dag/feedJoins.js';
import { pipelinePackages_sweep } from '../../pipelines/packages.js';

/** Fetches one page of a paginated feed collection through the wire contract. */
type FeedPageFetch = (params: Record<string, unknown>) => Promise<ListPage<FeedData>>;

/** Virtual filenames inside each instance directory. */
const INSTANCE_FILES: ReadonlySet<string> = new Set(['status', 'params', 'log', 'data']);
/** Virtual filenames inside each feed directory. */
const FEED_FILES: ReadonlySet<string> = new Set(['status', 'title']);

const PROC_JOBS_PREFIX: string = '/proc/jobs';
const PAGE: number = 100;
/** How long a settled feed's counters are trusted before a visit re-checks them. */
export const FEED_RECHECK_MS: number = 10 * 60 * 1000;
/** How old the roster may be before a visit walks the whole feed index again. */
export const ROSTER_FULL_WALK_MS: number = 10 * 60 * 1000;
/** Visits to one feed closer together than this share the first visit's result. */
export const FEED_VISIT_COALESCE_MS: number = 1000;

/**
 * Per-feed visit bookkeeping. Session memory only — never checkpointed; a
 * restart simply re-derives the cursor from the cached instance timestamps.
 *
 * @property checkedAt - Wall-clock ms of the last feed-row check.
 * @property cursor - Newest CUBE timestamp seen on this feed's rows, the
 *   `min_end_date` lower bound for the next delta walk; null when no row has
 *   carried a timestamp yet (the next delta is then a full walk).
 */
interface FeedVisit {
  checkedAt: number;
  cursor: string | null;
}

const feedVisits: Map<number, FeedVisit> = new Map();
const feedVisitInflight: Map<number, Promise<boolean>> = new Map();
let rosterWalkedAt: number = 0;
let rosterSyncInflight: Promise<number[]> | null = null;
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
function procFeed_create(feed: FeedData): ProcFeed {
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
  for await (const step of listPages_walk(
    (offset: number, limit: number): Promise<ListPage<FeedData>> => page_fetch({ limit, offset }),
    { pageSize: PAGE },
  )) {
    for (const feed of step.items) {
      const procFeed: ProcFeed = procFeed_create(feed);
      indexed.set(procFeed.id, procFeed);
    }
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

  const indexed: Map<number, ProcFeed> = new Map();
  await procFeeds_index(
    (params: Record<string, unknown>): Promise<ListPage<FeedData>> => feedsPage_get(client, params),
    indexed,
  );
  // Older CUBEs lack a public-feeds endpoint: the contract answers null
  // without a wire call, and an empty first page ends the index loop.
  const publicBefore: number = indexed.size;
  await procFeeds_index(
    async (params: Record<string, unknown>): Promise<ListPage<FeedData>> =>
      (await publicFeedsPage_get(client, params)) ?? { data: [], totalCount: 0 },
    indexed,
  );

  // An empty public walk while the cache already holds public feeds is a
  // failed SOURCE, not an authoritative absence: reconciling against it
  // would amputate every public feed from the roster (and the checkpoint
  // watcher would persist the amputation). Keep what we know and say so.
  if (indexed.size === publicBefore) {
    const knownPublic: ProcFeed[] = cache.feeds_find('').filter((feed: ProcFeed): boolean => feed.public);
    if (knownPublic.length > 0) {
      errorStack.stack_push(
        'warning',
        `proc roster: public-feeds source returned nothing while ${knownPublic.length} public feeds are known; keeping them`,
      );
      for (const feed of knownPublic) indexed.set(feed.id, feed);
    }
  }

  const knownBefore: Set<number> = new Set(cache.feedIDs_get());
  const reconciliationTargets: number[] = cache.feeds_reconcile(Array.from(indexed.values()));
  for (const feedID of reconciliationTargets) feedVisits.delete(feedID);
  // Feeds the walk brought in — created since, or shared to this identity —
  // are annunciated; a first build has no "before", so nothing arrives.
  if (knownBefore.size > 0) {
    cache.arrivals_note(Array.from(indexed.keys()).filter((feedID: number): boolean => !knownBefore.has(feedID)));
  }
  cache.built_set();
  rosterWalkedAt = Date.now();
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
/** Pulls the execution metrics a CUBE list row carries, defined-only. */
function instanceMetrics_fromRow(inst: PluginInstanceData): {
  startedAt?: string; finishedAt?: string; outputBytes?: number; computeResource?: string;
} {
  return {
    ...(typeof inst.start_date === 'string' ? { startedAt: inst.start_date } : {}),
    ...(typeof inst.end_date === 'string' ? { finishedAt: inst.end_date } : {}),
    ...(typeof inst.size === 'number' ? { outputBytes: inst.size } : {}),
    ...(typeof inst.compute_resource_name === 'string' && inst.compute_resource_name !== '' ? { computeResource: inst.compute_resource_name } : {}),
  };
}

/**
 * Converts a CUBE plugin-instance list row into the cache's instance model.
 *
 * @param inst - One list row.
 * @returns The instance as ProcCache stores it (params unresolved).
 */
function procInstance_fromRow(inst: PluginInstanceData): ProcInstance {
  const prevID: number | null = (inst.previous_id !== null && inst.previous_id !== undefined)
    ? Number(inst.previous_id)
    : null;
  return {
    id: Number(inst.id),
    feedID: Number(inst.feed_id),
    parentID: prevID,
    pluginName: String(inst.plugin_name),
    pluginType: inst.plugin_type !== undefined ? String(inst.plugin_type) : undefined,
    params: null,
    outputPath: outputPath_normalize(inst.output_path) ?? undefined,
    status: String(inst.status ?? 'unknown'),
    ...instanceMetrics_fromRow(inst),
  };
}

/**
 * Merges one CUBE list row into the cache: a known instance takes the row's
 * status and metrics (terminal status never regresses), an unknown one is
 * added to the topology.
 *
 * @param cache - The process cache.
 * @param inst - One list row.
 * @returns True when the row introduced a new instance.
 */
function procInstanceRow_merge(cache: ProcCache, inst: PluginInstanceData): boolean {
  const id: number = Number(inst.id);
  if (cache.instance_get(id)) {
    cache.status_update(id, String(inst.status ?? 'unknown'));
    cache.instanceMetrics_set(id, instanceMetrics_fromRow(inst));
    return false;
  }
  cache.instance_add(procInstance_fromRow(inst));
  return true;
}

/**
 * The newer of two ISO timestamps, tolerant of absent values.
 *
 * @param a - A timestamp or null.
 * @param b - A timestamp, or undefined when the row carried none.
 * @returns The later of the two, or whichever exists.
 */
function isoNewest_pick(a: string | null, b: unknown): string | null {
  if (typeof b !== 'string' || b === '') return a;
  if (a === null) return b;
  return Date.parse(b) > Date.parse(a) ? b : a;
}

async function feedInstances_load(feedID: number): Promise<void> {
  const cache: ProcCache = procCache_get();
  const client = await chrisConnection.client_get();
  if (!client) throw new Error('not connected');

  const instances: Map<number, PluginInstanceData> = new Map();
  // A first visit to a large feed is a page walk of a minute or more; the
  // prompt and the status strip carry its progress so it never reads as a
  // hang. The register is cleared on every exit, including failure.
  cache.feedLoad_progress(feedID, 0, 0);
  try {
    for await (const step of listPages_walk(
      (offset: number, limit: number): Promise<ListPage<PluginInstanceData>> =>
        pluginInstancesPage_get(client, { feed_id: feedID, limit, offset }),
      { pageSize: PAGE },
    )) {
      for (const instance of step.items) instances.set(Number(instance.id), instance);
      cache.feedLoad_progress(feedID, instances.size, step.total ?? 0);
    }
    for (const inst of instances.values()) cache.instance_add(procInstance_fromRow(inst));
    cache.topologyLoaded_mark(feedID);
  } finally {
    cache.feedLoad_clear(feedID);
  }
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
  /**
   * Set when the path descends THROUGH an instance's `data` link: the
   * portion after `data`, '' for the link itself. Everything under the
   * link belongs to the link's CFS target, not to `/proc`.
   */
  dataRemainder: string | null;
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
  let dataRemainder: string | null = null;

  if (parts.length >= 1) {
    const feedMatch: RegExpMatchArray | null = parts[0].match(/^feed_(\d+)$/);
    if (feedMatch) feedID = parseInt(feedMatch[1], 10);
  }

  // A `data` segment directly after an instance segment starts the link's
  // subtree: the instance is the one before it, whatever follows is the
  // remainder inside the CFS target.
  for (let index: number = 2; index < parts.length; index++) {
    if (parts[index] !== 'data') continue;
    const instMatch: RegExpMatchArray | null = parts[index - 1].match(/_(\d+)$/);
    if (!instMatch) continue;
    instanceID = parseInt(instMatch[1], 10);
    virtualFile = 'data';
    dataRemainder = parts.slice(index + 1).join('/');
    return { feedID, instanceID, virtualFile, dataRemainder };
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

  return { feedID, instanceID, virtualFile, dataRemainder };
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
/**
 * Resolves a path inside an instance's `data` link to its CFS target.
 *
 * @param instanceID - The instance whose output space the path enters.
 * @param remainder - The path below `data`, '' for the link itself.
 * @returns The absolute CFS path, or Err when the job has no output space.
 */
async function dataTarget_resolve(instanceID: number, remainder: string): Promise<Result<string>> {
  const outputPath: string | null = await instanceOutputPath_ensure(instanceID);
  if (!outputPath) {
    errorStack.stack_push('error', `No CFS output path is available for job ${instanceID}`);
    return Err();
  }
  return Ok(remainder === '' ? outputPath : `${outputPath}/${remainder}`);
}

async function instanceOutputPath_ensure(instanceID: number): Promise<string | null> {
  const cache: ProcCache = procCache_get();
  const inst: ProcInstance | undefined = cache.instance_get(instanceID);
  if (!inst) return null;
  if (inst.outputPath !== undefined) return inst.outputPath;

  const client = await chrisConnection.client_get();
  if (!client) return null;
  try {
    const handle: PluginInstanceHandle | null = await pluginInstance_get(client, instanceID);
    const outputPath: string | null = outputPath_normalize(handle?.data?.output_path);
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
 * @param handle - Typed handle for the instance being inspected.
 * @returns Parameter names mapped to their recorded invocation values.
 */
async function instanceParams_fetch(handle: PluginInstanceHandle): Promise<Record<string, unknown>> {
  const params: Record<string, unknown> = {};
  for await (const step of listPages_walk(
    (offset: number, limit: number): Promise<ListPage<InstanceParameterData>> =>
      handle.parametersPage_get({ limit, offset }),
    { pageSize: PAGE },
  )) {
    for (const item of step.items) {
      if (item.param_name) params[item.param_name] = item.value;
    }
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
      await procRoster_sync();
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

    const { feedID, instanceID, virtualFile, dataRemainder } = procPath_parse(clean);

    // Anything under an instance's `data` link belongs to the link's CFS
    // target: resolve and delegate, so `ls .../data` (and deeper) shows the
    // target's real contents instead of silently re-listing the instance.
    if (instanceID !== null && virtualFile === 'data' && dataRemainder !== null) {
      const target: Result<string> = await dataTarget_resolve(instanceID, dataRemainder);
      if (!target.ok) return Err();
      const { vfsDispatcher } = await import('../dispatcher.js');
      return vfsDispatcher.list(target.value, _options);
    }

    // /proc/jobs/feed_N — list root instances + feed virtual files
    if (feedID !== null && instanceID === null) {
      const wasLoaded: boolean = cache.topologyLoaded_has(feedID);
      await feedInstances_ensureLoaded(feedID);
      const feed: ProcFeed | undefined = cache.feed_get(feedID);
      if (!feed) return Ok([]);

      // The initial load already carried live status and topology; a revisit
      // is a delta (feed counters, then only what moved).
      if (wasLoaded) await feedVisit_sync(feedID);
      const rootIDs: number[] = cache.feedRoots_get(feedID);

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

      if (wasLoaded) await feedVisit_sync(feedID);
      const childIDs: number[] = cache.children_get(instanceID);

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

  /**
   * Raw bytes exist only under the `data` link (an image in a job's output
   * space); everything else in `/proc` is synthesized text, served as its
   * UTF-8 bytes so a byte reader (the daemon's `/vfs` route, a preview)
   * sees the same file `cat` does.
   *
   * @param pathStr - Absolute `/proc/...` path.
   * @returns The file's bytes.
   */
  async readBinary(pathStr: string): Promise<Result<Buffer>> {
    await cache_ensure();
    const clean: string = pathStr.replace(/\/$/, '');
    const { instanceID, virtualFile, dataRemainder } = procPath_parse(clean);
    if (instanceID !== null && virtualFile === 'data' && dataRemainder !== null && dataRemainder !== '') {
      const target: Result<string> = await dataTarget_resolve(instanceID, dataRemainder);
      if (!target.ok) return Err();
      const { vfsDispatcher } = await import('../dispatcher.js');
      return vfsDispatcher.readBinary(target.value);
    }
    const text: Result<string> = await this.read(pathStr);
    return text.ok ? Ok(Buffer.from(text.value, 'utf8')) : text;
  }

  async read(pathStr: string): Promise<Result<string>> {
    await cache_ensure();
    const cache: ProcCache = procCache_get();
    const clean: string = pathStr.replace(/\/$/, '');
    const { feedID, instanceID, virtualFile, dataRemainder } = procPath_parse(clean);

    // A file under the `data` link is the CFS target's file.
    if (instanceID !== null && virtualFile === 'data' && dataRemainder !== null && dataRemainder !== '') {
      const target: Result<string> = await dataTarget_resolve(instanceID, dataRemainder);
      if (!target.ok) return Err();
      const { vfsDispatcher } = await import('../dispatcher.js');
      return vfsDispatcher.read(target.value);
    }

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
              const handle: PluginInstanceHandle | null = await pluginInstance_get(client, instanceID);
              if (handle) cache.params_update(instanceID, await instanceParams_fetch(handle));
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

  const page: ListPage<FeedData> = await feedsPage_get(client, { id: feedID, limit: 1, offset: 0 });
  const f: FeedData | undefined = page.data[0];
  if (!f) return;

  cache.feed_add(procFeed_create(f));
}

export async function feedStatus_refresh(feedID: number): Promise<void> {
  const cache: ProcCache = procCache_get();
  const client = await chrisConnection.client_get();
  if (!client) return;

  for await (const step of listPages_walk(
    (offset: number, limit: number): Promise<ListPage<PluginInstanceData>> =>
      pluginInstancesPage_get(client, { feed_id: feedID, limit, offset }),
    { pageSize: PAGE },
  )) {
    for (const inst of step.items) {
      cache.status_update(Number(inst.id), String(inst.status ?? 'unknown'));
      cache.instanceMetrics_set(Number(inst.id), instanceMetrics_fromRow(inst));
    }
  }
}

// ── Visit-driven freshness ─────────────────────────────────────────────────

/**
 * Whether every cached instance of a feed carries a terminal status. A fully
 * settled feed can only change by having work appended to it, which the
 * feed-row counters reveal.
 *
 * @param cache - The process cache.
 * @param feedID - The feed to inspect.
 * @returns True when no cached instance could still change status.
 */
export function feedCached_isSettled(cache: ProcCache, feedID: number): boolean {
  for (const id of cache.feedInstanceIDs_get(feedID)) {
    const inst: ProcInstance | undefined = cache.instance_get(id);
    if (inst === undefined || !status_isTerminal(inst.status)) return false;
  }
  return true;
}

/**
 * Derives a feed's delta cursor from what the cache already holds: the newest
 * start or end timestamp across its instances.
 *
 * @param cache - The process cache.
 * @param feedID - The feed whose rows to scan.
 * @returns The newest timestamp, or null when no row carried one.
 */
function feedCursor_derive(cache: ProcCache, feedID: number): string | null {
  let newest: string | null = null;
  for (const id of cache.feedInstanceIDs_get(feedID)) {
    const inst: ProcInstance | undefined = cache.instance_get(id);
    if (!inst) continue;
    newest = isoNewest_pick(newest, inst.startedAt);
    newest = isoNewest_pick(newest, inst.finishedAt);
  }
  return newest;
}

/**
 * Walks one filtered plugin-instance listing for a feed, merging every row.
 *
 * @param cache - The process cache.
 * @param client - Connected chrisapi client.
 * @param params - CUBE filter params beyond feed_id/limit/offset.
 * @param feedID - The feed being walked.
 * @param cursor - The cursor to advance with the rows' timestamps.
 * @returns The advanced cursor.
 */
async function feedRows_merge(
  cache: ProcCache,
  client: NonNullable<Awaited<ReturnType<typeof chrisConnection.client_get>>>,
  params: Record<string, unknown>,
  feedID: number,
  cursor: string | null,
): Promise<string | null> {
  let newest: string | null = cursor;
  for await (const step of listPages_walk(
    (offset: number, limit: number): Promise<ListPage<PluginInstanceData>> =>
      pluginInstancesPage_get(client, { ...params, feed_id: feedID, limit, offset }),
    { pageSize: PAGE },
  )) {
    for (const inst of step.items) {
      procInstanceRow_merge(cache, inst);
      newest = isoNewest_pick(newest, inst.start_date);
      newest = isoNewest_pick(newest, inst.end_date);
    }
  }
  return newest;
}

/**
 * Brings one already-loaded feed up to date with CUBE at the cost the change
 * warrants: a settled feed pays one feed-row fetch per {@link FEED_RECHECK_MS};
 * a feed with running work pays that fetch on every visit; and only when the
 * counters moved (or work is running) does the visit walk the delta —
 * `min_end_date` from the cursor, which yields nodes created OR finished since
 * (CUBE stamps end_date at creation and again at completion) — followed by an
 * `active=true` sweep for the nodes still in flight.
 *
 * Concurrent visits share one in-flight sync, and visits within
 * {@link FEED_VISIT_COALESCE_MS} of each other share the first one's result
 * (a pane tick and an `ls` in the same second are one visit). Failures are
 * surfaced as warnings and never fail the visit: the cache stays as it was.
 *
 * @param feedID - A feed whose topology is already loaded.
 * @param force - Ignore the settled-feed throttle (an explicit refresh).
 * @returns True when the cache reflects CUBE as of this visit (including a
 *   visit that needed no wire), false when the sync failed.
 */
export async function feedVisit_sync(feedID: number, force: boolean = false): Promise<boolean> {
  const inflight: Promise<boolean> | undefined = feedVisitInflight.get(feedID);
  if (inflight) return inflight;
  const run: Promise<boolean> = feedVisit_run(feedID, force)
    .then((): boolean => true)
    .catch((error: unknown): boolean => {
      const msg: string = error instanceof Error ? error.message : String(error);
      errorStack.stack_push('warning', `proc feed_${feedID}: live sync failed (${msg}); showing cached state`);
      return false;
    })
    .finally((): void => { feedVisitInflight.delete(feedID); });
  feedVisitInflight.set(feedID, run);
  return run;
}

async function feedVisit_run(feedID: number, force: boolean): Promise<void> {
  const cache: ProcCache = procCache_get();
  const feed: ProcFeed | undefined = cache.feed_get(feedID);
  if (!feed || !cache.topologyLoaded_has(feedID)) return;

  const visit: FeedVisit | undefined = feedVisits.get(feedID);
  const settled: boolean = feedCached_isSettled(cache, feedID) && !feed_isActive(feed);
  const now: number = Date.now();
  if (!force && visit && now - visit.checkedAt < FEED_VISIT_COALESCE_MS) return;
  if (!force && settled && visit && now - visit.checkedAt < FEED_RECHECK_MS) return;

  const client = await chrisConnection.client_get();
  if (!client) return;

  const page: ListPage<FeedData> = await feedsPage_get(client, { id: feedID, limit: 1, offset: 0 });
  const row: FeedData | undefined = page.data[0];
  let moved: boolean = !settled || force;
  if (row) {
    const fresh: ProcFeed = procFeed_create(row);
    if (feedTopology_changed(feed, fresh)) moved = true;
    cache.feed_add(fresh);
  }
  if (!moved) {
    feedVisits.set(feedID, { checkedAt: now, cursor: visit?.cursor ?? null });
    return;
  }

  let cursor: string | null = visit?.cursor ?? feedCursor_derive(cache, feedID);
  const since: Record<string, unknown> = cursor ? { min_end_date: cursor } : {};
  cursor = await feedRows_merge(cache, client, since, feedID, cursor);
  cursor = await feedRows_merge(cache, client, { active: true }, feedID, cursor);
  feedVisits.set(feedID, { checkedAt: Date.now(), cursor });
}

/**
 * Brings the feed roster up to date on a `/proc/jobs` visit. While the roster
 * is younger than {@link ROSTER_FULL_WALK_MS} this is a delta: feeds whose id
 * exceeds the highest known one, from both the owned/shared and the public
 * collections (one call each when nothing is new). Once older, it is the full
 * index walk, which is the only way a feed shared later, or one deleted, is
 * seen. A roster still owned by warmup (not yet `current`) is left alone.
 *
 * @param force - Walk the whole index regardless of age.
 * @returns Feed IDs the sync brought in or found changed: after a full
 *   walk, the reconciliation targets (new, changed, or active feeds); after
 *   a delta, the newly seen feeds. Empty when nothing moved or the roster
 *   was left alone.
 */
export async function procRoster_sync(force: boolean = false): Promise<number[]> {
  if (rosterSyncInflight) return rosterSyncInflight;
  const run: Promise<number[]> = procRoster_run(force)
    .catch((error: unknown): number[] => {
      const msg: string = error instanceof Error ? error.message : String(error);
      errorStack.stack_push('warning', `proc roster: live sync failed (${msg}); showing cached roster`);
      return [];
    })
    .finally((): void => { rosterSyncInflight = null; });
  rosterSyncInflight = run;
  return run;
}

async function procRoster_run(force: boolean): Promise<number[]> {
  const cache: ProcCache = procCache_get();
  if (!cache.built || cache.lifecycle_get().state !== 'current') return [];

  if (force || Date.now() - rosterWalkedAt >= ROSTER_FULL_WALK_MS) {
    return procCache_build();
  }

  const client = await chrisConnection.client_get();
  if (!client) return [];
  return procRosterDelta_run(cache, client);
}

/**
 * Walks the feeds newer than the highest known id, in both collections,
 * and adds them to the roster.
 *
 * @param cache - The process cache.
 * @param client - Connected chrisapi client.
 * @returns The feed IDs added.
 */
async function procRosterDelta_run(
  cache: ProcCache,
  client: NonNullable<Awaited<ReturnType<typeof chrisConnection.client_get>>>,
): Promise<number[]> {
  const knownIDs: number[] = cache.feedIDs_get();
  const minID: number = (knownIDs.length > 0 ? Math.max(...knownIDs) : 0) + 1;
  const fresh: Map<number, ProcFeed> = new Map();
  await procFeeds_index(
    (params: Record<string, unknown>): Promise<ListPage<FeedData>> =>
      feedsPage_get(client, { ...params, min_id: minID }),
    fresh,
  );
  await procFeeds_index(
    async (params: Record<string, unknown>): Promise<ListPage<FeedData>> =>
      (await publicFeedsPage_get(client, { ...params, min_id: minID })) ?? { data: [], totalCount: 0 },
    fresh,
  );
  for (const feed of fresh.values()) cache.feed_add(feed);
  cache.arrivals_note(Array.from(fresh.keys()));
  return Array.from(fresh.keys());
}

/**
 * Brings a restored roster into service at boot without walking the whole
 * feed index: feeds newer than the highest restored id are added (one call
 * per collection when nothing is new), and the cache is marked built so
 * visits can begin. Counters of restored feeds stay as checkpointed until a
 * visit or the full walk the host runs in the background afterwards.
 *
 * @returns The feed IDs added.
 * @throws {Error} When not connected or the roster is empty (nothing was
 *   restored) — the host then falls back to the full index build.
 */
export async function procRoster_bootSync(): Promise<number[]> {
  const cache: ProcCache = procCache_get();
  if (cache.feedIDs_get().length === 0) throw new Error('no restored roster to bring into service');
  const client = await chrisConnection.client_get();
  if (!client) throw new Error('not connected');
  const added: number[] = await procRosterDelta_run(cache, client);
  cache.built_set();
  return added;
}

/**
 * Forgets all visit bookkeeping (tests, and a cache cleared underneath us).
 */
export function procVisitState_reset(): void {
  feedVisits.clear();
  feedVisitInflight.clear();
  rosterWalkedAt = 0;
  rosterSyncInflight = null;
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

  // state.total of 0 encodes "unknown" in the persisted sweep state; the
  // walker's null encoding is translated at this boundary so a resumed
  // sweep keeps its latched total and offset.
  for await (const step of listPages_walk(
    (offset: number, limit: number): Promise<ListPage<PluginInstanceData>> =>
      pluginInstancesPage_get(client, { limit, offset }),
    { pageSize: PAGE, startOffset: state.offset, startTotal: state.total > 0 ? state.total : null },
  )) {
    if (state.total === 0 && step.total !== null) {
      state.total = step.total;
      if (state.total > 0) cache.warmup_progress(0, state.total);
    }

    for (const inst of step.items) {
      const instanceID: number = Number(inst.id);
      const feedID: number = Number(inst.feed_id);
      state.fetchedInstanceIDs.add(instanceID);

      if (!cache.feed_get(feedID)) continue;

      cache.instance_add(procInstance_fromRow(inst));
      state.seenInstanceIDs.add(instanceID);
      state.seenFeedIDs.add(feedID);
    }

    state.offset = step.offset + step.items.length;
    if (state.total > 0) cache.warmup_progress(state.fetchedInstanceIDs.size, state.total);
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
        procSettlementTails_run();
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
 * Kicks the quiet settlement tails once the topology index is complete:
 * every unresolved `ts` join resolves in the background (so first diagrams
 * are pure cache, and the checkpoint persists them), and the pipeline
 * package store sweeps unseen registered pipelines. Both are best-effort —
 * a failure leaves the lazy paths intact.
 */
function procSettlementTails_run(): void {
  void procJoins_sweep().catch((): void => { /* lazy resolution remains */ });
  void pipelinePackages_sweep().catch((): void => { /* lazy fetch remains */ });
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
  procSettlementTails_run();
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
    feedVisits.delete(feedID);
    cache.feed_remove(feedID);
    // Re-fetch feed metadata with job counters
    const client = await chrisConnection.client_get();
    if (client) {
      const page: ListPage<FeedData> = await feedsPage_get(client, { id: feedID, limit: 1, offset: 0 });
      const f: FeedData | undefined = page.data[0];
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
    feedVisits.clear();
    return procCache_build();
  }
}
