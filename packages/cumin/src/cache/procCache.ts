/**
 * @file Process Cache
 *
 * Session-scoped cache of ChRIS feed topology. Separates permanent data
 * (instance DAG structure and terminal status) from volatile active status.
 *
 * Design decisions:
 * - Topology (id, feedID, parentID, pluginName) is permanent once written.
 * - Terminal status is immutable and checkpointed; active status refreshes live.
 * - Feed job counters (finishedJobs etc.) give aggregate feed status
 *   without per-instance API calls.
 * - topologyLoaded distinguishes "loaded but 0 instances" from "not yet loaded".
 * - loading map prevents duplicate API calls when background loader and
 *   user navigation race on the same feed.
 * - warmupComplete enables pure in-memory path for proc find <name>.
 *
 * @module
 */

/**
 * Feed-level metadata including job count fields for aggregate status.
 *
 * @property ownerUsername - Username that owns the feed.
 * @property public - Whether the feed is publicly visible.
 */
export interface ProcFeed {
  id: number;
  title: string;
  ownerUsername: string;
  public: boolean;
  creationDate: string;   // ISO string — used to filter warmup to recent feeds
  finishedJobs: number;
  erroredJobs: number;
  startedJobs: number;
  scheduledJobs: number;
  cancelledJobs: number;
  createdJobs: number;
}

/**
 * Exclusive feed counts by how the current identity can see each feed.
 *
 * @property user - Feeds owned by the current identity.
 * @property public - Public feeds owned by another identity.
 * @property shared - Non-public feeds shared by another identity.
 * @property total - Unique visible feeds across all three buckets.
 */
export interface ProcFeedScopeCounts {
  user: number;
  public: number;
  shared: number;
  total: number;
}

/** Feed counters whose changes can alter a feed's plugin-instance topology. */
const FEED_TOPOLOGY_COUNTERS: ReadonlyArray<keyof Pick<ProcFeed,
  'finishedJobs' | 'erroredJobs' | 'startedJobs' | 'scheduledJobs' | 'cancelledJobs' | 'createdJobs'
>> = [
  'finishedJobs',
  'erroredJobs',
  'startedJobs',
  'scheduledJobs',
  'cancelledJobs',
  'createdJobs',
];

/**
 * Reports whether a feed has work which can still change after checkpointing.
 *
 * @param feed - Feed summary with CUBE job counters.
 * @returns True when any job is created, scheduled, or started.
 */
export function feed_isActive(feed: ProcFeed): boolean {
  return feed.startedJobs > 0 || feed.scheduledJobs > 0 || feed.createdJobs > 0;
}

/**
 * Reports whether two feed summaries indicate different instance topology.
 *
 * @param previous - The cached feed summary.
 * @param current - A freshly fetched feed summary.
 * @returns True when any job counter differs.
 */
export function feedTopology_changed(previous: ProcFeed, current: ProcFeed): boolean {
  return FEED_TOPOLOGY_COUNTERS.some(
    (counter: keyof Pick<ProcFeed,
      'finishedJobs' | 'erroredJobs' | 'startedJobs' | 'scheduledJobs' | 'cancelledJobs' | 'createdJobs'
    >): boolean => previous[counter] !== current[counter],
  );
}

/**
 * Instance entry. Topology (id/feedID/parentID/pluginName) is permanent.
 * Status is cached only once terminal (settled); active status is refreshed live.
 */
export interface ProcInstance {
  id: number;
  feedID: number;
  /** null for root nodes (direct children of a feed). */
  parentID: number | null;
  pluginName: string;
  /**
   * Plugin type (`fs` | `ds` | `ts`), immutable. Authoritative for detecting a
   * topological-join node (`ts`). Optional — absent for nodes added before this was
   * tracked; callers should fall back to a name match when undefined.
   */
  pluginType?: string;
  /** ISO execution start, from the CUBE list row; undefined when unobserved. */
  startedAt?: string;
  /** ISO execution end; undefined until the job is terminal. */
  finishedAt?: string;
  /** Output size in bytes, as CUBE reports it; undefined when unobserved. */
  outputBytes?: number;
  /** The compute resource the job ran on; undefined when unobserved. */
  computeResource?: string;
  /** null until first cat — immutable once populated. */
  params: Record<string, unknown> | null;
  /**
   * Authoritative CUBE output directory, resolved lazily for the `/proc` data
   * link. `undefined` means not looked up; `null` means CUBE reported none.
   * This navigation convenience is deliberately excluded from checkpoints.
   */
  outputPath?: string | null;
  /**
   * Last known job status. Terminal statuses (see {@link PROC_TERMINAL_STATUSES})
   * are immutable and kept permanently; active statuses are refreshed live.
   * null when topology is known but status has not been observed yet.
   */
  status: string | null;
  /**
   * Extra parent instance IDs for a topological-join (`ts`) node — the sources it
   * merges beyond its anchor {@link ProcInstance.parentID}. Immutable once a feed has
   * run; populated lazily (only ts nodes have any). Absent/undefined = not yet
   * resolved; empty array = resolved, no joins. See the feed-DAG design notes.
   */
  joinParentIDs?: number[];
}

/**
 * Job statuses that never change once reached. An instance in one of these states
 * is settled — its status can be cached permanently rather than re-fetched.
 */
export const PROC_TERMINAL_STATUSES: ReadonlySet<string> = new Set<string>([
  'finishedSuccessfully',
  'finishedWithError',
  'cancelled',
]);

/**
 * Reports whether a status is terminal (settled) and therefore safe to cache.
 *
 * @param status - Job status string, or null/undefined when unknown.
 * @returns True if the status is terminal and immutable.
 */
export function status_isTerminal(status: string | null | undefined): boolean {
  return status != null && PROC_TERMINAL_STATUSES.has(status);
}

/**
 * Warm-up progress counters for the prompt indicator.
 * total is zero until the server reports the visible plugin-instance count.
 * active becomes true when observable page progress begins, and false when the
 * sweep completes or aborts. Use the topology lifecycle to detect an earlier
 * running state before the first page arrives.
 */
export interface ProcWarmupProgress {
  loaded: number;
  total: number;
  active: boolean;
}

/**
 * One feed's first-visit topology load in flight: the prompt shows it so a
 * 20k-node feed's walk is never a silent hang.
 *
 * @property feedID - The feed being loaded.
 * @property loaded - Instances fetched so far.
 * @property total - The server's count for the feed, zero until reported.
 */
export interface ProcFeedLoadProgress {
  feedID: number;
  loaded: number;
  total: number;
}

/** How long a roster arrival stays annunciated after it lands. */
export const PROC_ARRIVAL_TTL_MS: number = 30 * 1000;

/** Availability and freshness states for the persistent process cache. */
export type ProcCacheState = 'empty' | 'restored' | 'reconciling' | 'current' | 'failed';

/**
 * Persistent process-cache freshness metadata.
 *
 * @property state - Current availability and reconciliation state.
 * @property checkpointAt - ISO timestamp of the latest durable checkpoint.
 */
export interface ProcCacheLifecycle {
  state: ProcCacheState;
  checkpointAt?: string;
}

/**
 * Serializable topology retained across daemon restarts.
 *
 * @property feeds - Visible feed metadata.
 * @property instances - Normalized plugin-instance topology.
 * @property topologyLoaded - Feed IDs whose instance topology is complete.
 */
export interface ProcCacheSnapshot {
  feeds: ProcFeed[];
  instances: ProcInstance[];
  topologyLoaded: number[];
}

/**
 * One feed's persistence-safe topology: what a per-feed checkpoint shard holds.
 *
 * @property feedID - The feed these instances belong to.
 * @property loaded - Whether the feed's topology is known to be complete.
 * @property instances - Normalized instances with terminal status only.
 */
export interface ProcFeedSnapshot {
  feedID: number;
  loaded: boolean;
  instances: ProcInstance[];
}

/**
 * What a cache mutation touched, so a persister can write only that part.
 *
 * - `roster`: the feed index (a feed row added, updated, or removed);
 * - `feed`: one feed's topology, status, metrics, joins, or loaded mark;
 * - `all`: every feed at once (a completed global sweep);
 * - `lifecycle`: freshness state only — nothing durable changed.
 */
export type ProcCacheChange =
  | { scope: 'roster' }
  | { scope: 'feed'; feedID: number }
  | { scope: 'all' }
  | { scope: 'lifecycle' };

/** A cache mutation listener, told what the mutation touched. */
export type ProcCacheListener = (change: ProcCacheChange) => void;

/**
 * Strips an instance to its persistence-safe form: no params, no output
 * path, and only a terminal status (an active one is re-observed live).
 *
 * @param inst - A cached instance.
 * @returns A copy safe to checkpoint.
 */
function procInstance_persistent(inst: ProcInstance): ProcInstance {
  const { outputPath: _outputPath, ...persistent }: ProcInstance = inst;
  return {
    ...persistent,
    params: null,
    status: status_isTerminal(inst.status) ? inst.status : null,
    joinParentIDs: inst.joinParentIDs ? [...inst.joinParentIDs] : undefined,
  };
}

/**
 * Session-scoped cache of feed and instance topology with restorable terminal state.
 */
export class ProcCache {
  private static _instance: ProcCache | null = null;

  private feeds: Map<number, ProcFeed> = new Map();
  private instances: Map<number, ProcInstance> = new Map();
  private feedRoots: Map<number, number[]> = new Map();
  private children: Map<number, number[]> = new Map();

  /** Feed IDs whose instance topology has been fully fetched. */
  private topologyLoaded: Set<number> = new Set();

  /** In-flight topology fetch promises — prevents duplicate API calls. */
  private loading: Map<number, Promise<void>> = new Map();

  /** True when background warm-up has finished all feeds. */
  private _warmupComplete: boolean = false;

  private _warmupProgress: ProcWarmupProgress = { loaded: 0, total: 0, active: false };

  /** Per-feed topology loads in flight, keyed by feed id. */
  private feedLoads: Map<number, ProcFeedLoadProgress> = new Map();

  /** Feeds the roster gained (created or shared) with the moment they landed. */
  private arrivals: Map<number, number> = new Map();

  /** Whether initial feed index has been built. */
  private _built: boolean = false;

  private lifecycle: ProcCacheLifecycle = { state: 'empty' };
  private listeners: Set<ProcCacheListener> = new Set();

  private constructor() {}

  static instance_get(): ProcCache {
    if (!ProcCache._instance) {
      ProcCache._instance = new ProcCache();
    }
    return ProcCache._instance;
  }

  get built(): boolean { return this._built; }
  get warmupComplete(): boolean { return this._warmupComplete; }

  /**
   * Returns a copy of the current cache lifecycle metadata.
   *
   * @returns Current cache state and checkpoint timestamp.
   */
  lifecycle_get(): ProcCacheLifecycle { return { ...this.lifecycle }; }

  /**
   * Changes the cache freshness state.
   *
   * @param state - New lifecycle state.
   * @returns Nothing.
   */
  lifecycle_set(state: ProcCacheState): void {
    this.lifecycle = { ...this.lifecycle, state };
    this.change_emit({ scope: 'lifecycle' });
  }

  /**
   * Registers a callback for checkpoint-worthy cache mutations.
   *
   * @param listener - Callback invoked after a cache mutation with what it touched.
   * @returns Function that unregisters the callback.
   */
  changeListener_add(listener: ProcCacheListener): () => void {
    this.listeners.add(listener);
    return (): void => { this.listeners.delete(listener); };
  }

  private change_emit(change: ProcCacheChange): void {
    for (const listener of this.listeners) listener(change);
  }

  // ── Feed ──────────────────────────────────────────────────────────────────

  /**
   * Adds or updates a feed entry.
   */
  feed_add(feed: ProcFeed): void {
    this.feeds.set(feed.id, feed);
    if (!this.feedRoots.has(feed.id)) {
      this.feedRoots.set(feed.id, []);
    }
    this.change_emit({ scope: 'roster' });
  }

  feed_get(feedID: number): ProcFeed | undefined {
    return this.feeds.get(feedID);
  }

  feedIDs_get(): number[] {
    return Array.from(this.feeds.keys());
  }

  /**
   * Counts visible feeds in exclusive ownership, sharing, and public buckets.
   *
   * Ownership takes precedence over public visibility so the buckets sum to
   * the unique feed total.
   *
   * @param username - Authenticated username whose owned feeds form `user`.
   * @returns Exclusive scope counts whose components sum to `total`.
   */
  feedScopeCounts_get(username: string): ProcFeedScopeCounts {
    const counts: ProcFeedScopeCounts = { user: 0, public: 0, shared: 0, total: this.feeds.size };
    for (const feed of this.feeds.values()) {
      if (feed.ownerUsername === username) counts.user++;
      else if (feed.public) counts.public++;
      else counts.shared++;
    }
    return counts;
  }

  feedRoots_get(feedID: number): number[] {
    return this.feedRoots.get(feedID) ?? [];
  }

  /**
   * Removes a feed and all its instances from the cache.
   */
  feed_remove(feedID: number): void {
    this.feeds.delete(feedID);
    this.topologyLoaded.delete(feedID);
    const allInstances: ProcInstance[] = Array.from(this.instances.values())
      .filter((i: ProcInstance) => i.feedID === feedID);
    for (const inst of allInstances) {
      this.instance_remove(inst.id);
    }
    this.feedRoots.delete(feedID);
    this.change_emit({ scope: 'feed', feedID });
    this.change_emit({ scope: 'roster' });
  }

  /**
   * Replaces the visible feed set while preserving topology for retained feeds.
   *
   * @param feeds - Authoritative feeds visible to the current identity.
   * @returns IDs requiring topology reconciliation because they are new, their
   *   aggregate job counts changed, or they still have active work.
   */
  feeds_reconcile(feeds: ProcFeed[]): number[] {
    const reconciliationTargets: number[] = [];
    const visible: Set<number> = new Set(feeds.map((feed: ProcFeed): number => feed.id));
    for (const feedID of this.feedIDs_get()) {
      if (!visible.has(feedID)) this.feed_remove(feedID);
    }
    for (const feed of feeds) {
      const previous: ProcFeed | undefined = this.feed_get(feed.id);
      if (!previous || feedTopology_changed(previous, feed) || feed_isActive(feed)) {
        reconciliationTargets.push(feed.id);
      }
      this.feed_add(feed);
    }
    return reconciliationTargets;
  }

  // ── Instance ──────────────────────────────────────────────────────────────

  /**
   * Adds a plugin instance to the topology cache.
   */
  instance_add(inst: ProcInstance): void {
    this.instances.set(inst.id, inst);
    if (inst.parentID === null) {
      const roots: number[] = this.feedRoots.get(inst.feedID) ?? [];
      if (!roots.includes(inst.id)) {
        roots.push(inst.id);
        this.feedRoots.set(inst.feedID, roots);
      }
    } else {
      const kids: number[] = this.children.get(inst.parentID) ?? [];
      if (!kids.includes(inst.id)) {
        kids.push(inst.id);
        this.children.set(inst.parentID, kids);
      }
    }
    this.change_emit({ scope: 'feed', feedID: inst.feedID });
  }

  /**
   * Merges observed execution metrics onto an instance. Only defined values
   * land, so a refresh that carries no timing never erases what warmup saw.
   */
  instanceMetrics_set(
    id: number,
    metrics: { startedAt?: string; finishedAt?: string; outputBytes?: number; computeResource?: string },
  ): void {
    const inst: ProcInstance | undefined = this.instances.get(id);
    if (!inst) return;
    let changed: boolean = false;
    if (metrics.startedAt !== undefined && inst.startedAt !== metrics.startedAt) { inst.startedAt = metrics.startedAt; changed = true; }
    if (metrics.finishedAt !== undefined && inst.finishedAt !== metrics.finishedAt) { inst.finishedAt = metrics.finishedAt; changed = true; }
    if (metrics.outputBytes !== undefined && inst.outputBytes !== metrics.outputBytes) { inst.outputBytes = metrics.outputBytes; changed = true; }
    if (metrics.computeResource !== undefined && inst.computeResource !== metrics.computeResource) { inst.computeResource = metrics.computeResource; changed = true; }
    if (changed) this.change_emit({ scope: 'feed', feedID: inst.feedID });
  }

  instance_get(id: number): ProcInstance | undefined {
    return this.instances.get(id);
  }

  instances_count(): number {
    return this.instances.size;
  }

  instancesForFeed_count(feedID: number): number {
    let n: number = 0;
    for (const inst of this.instances.values()) {
      if (inst.feedID === feedID) n++;
    }
    return n;
  }

  children_get(parentID: number): number[] {
    return this.children.get(parentID) ?? [];
  }

  /**
   * Returns every instance ID belonging to a feed, walking the anchor tree from its
   * roots (breadth-first). Order is roots-first, then descendants.
   *
   * @param feedID - Feed to enumerate.
   * @returns All instance IDs in the feed's anchor tree.
   */
  feedInstanceIDs_get(feedID: number): number[] {
    const result: number[] = [];
    const queue: number[] = [...this.feedRoots_get(feedID)];
    while (queue.length > 0) {
      const id: number = queue.shift()!;
      result.push(id);
      queue.push(...this.children_get(id));
    }
    return result;
  }

  /**
   * Removes an instance from the topology cache.
   */
  instance_remove(id: number): void {
    const inst: ProcInstance | undefined = this.instances.get(id);
    if (!inst) return;
    this.instances.delete(id);
    if (inst.parentID === null) {
      const roots: number[] = this.feedRoots.get(inst.feedID) ?? [];
      this.feedRoots.set(inst.feedID, roots.filter((r: number) => r !== id));
    } else {
      const kids: number[] = this.children.get(inst.parentID) ?? [];
      this.children.set(inst.parentID, kids.filter((k: number) => k !== id));
    }
    this.change_emit({ scope: 'feed', feedID: inst.feedID });
  }

  /**
   * Removes instances absent from an authoritative topology sweep.
   *
   * @param instanceIDs - Instance IDs returned by the completed CUBE sweep.
   * @returns Nothing.
   */
  topology_reconcile(instanceIDs: Set<number>): void {
    for (const id of Array.from(this.instances.keys())) {
      if (!instanceIDs.has(id)) this.instance_remove(id);
    }
    for (const feedID of this.feedIDs_get()) this.topologyLoaded.add(feedID);
    this.change_emit({ scope: 'all' });
  }

  /**
   * Updates cached params for an instance (on first cat).
   */
  params_update(id: number, params: Record<string, unknown>): void {
    const inst: ProcInstance | undefined = this.instances.get(id);
    if (inst) inst.params = params;
  }

  /**
   * Stores the lazily resolved CUBE output path for one instance.
   *
   * @param id - Plugin-instance ID whose output location was resolved.
   * @param outputPath - Absolute CFS output directory, or null when absent.
   * @returns Nothing.
   */
  outputPath_update(id: number, outputPath: string | null): void {
    const inst: ProcInstance | undefined = this.instances.get(id);
    if (inst) inst.outputPath = outputPath;
  }

  /**
   * Finds the closest cached job output containing a CFS path.
   *
   * An output path is a directory boundary: `/home/alice/run` contains
   * `/home/alice/run/result.txt`, but not `/home/alice/run-old`.
   *
   * @param cfsPath - Absolute CFS path to resolve against live-session outputs.
   * @returns The closest producing instance, or undefined when no output path
   *   known in this session contains the path.
   */
  outputPath_match(cfsPath: string): ProcInstance | undefined {
    const cleanPath: string = cfsPath.length > 1 && cfsPath.endsWith('/')
      ? cfsPath.slice(0, -1)
      : cfsPath;
    let closest: ProcInstance | undefined;
    for (const inst of this.instances.values()) {
      const outputPath: string | null | undefined = inst.outputPath;
      if (!outputPath) continue;
      const isAncestor: boolean = outputPath === '/'
        ? cleanPath.startsWith('/')
        : cleanPath === outputPath || cleanPath.startsWith(`${outputPath}/`);
      if (isAncestor && (!closest || outputPath.length > (closest.outputPath?.length ?? 0))) {
        closest = inst;
      }
    }
    return closest;
  }

  /**
   * Updates the cached status for an instance. Terminal (settled) statuses are
   * never overwritten — once finished, a job's status is immutable.
   *
   * @param id - Instance ID.
   * @param status - Fresh status observed from the API.
   */
  status_update(id: number, status: string): void {
    const inst: ProcInstance | undefined = this.instances.get(id);
    if (!inst) return;
    if (status_isTerminal(inst.status)) return;
    if (inst.status !== status) { inst.status = status; this.change_emit({ scope: 'feed', feedID: inst.feedID }); }
  }

  /**
   * Records the resolved topological-join parent IDs for a `ts` instance. Immutable
   * data — set once when the feed's join edges are first fetched.
   *
   * @param id - Instance ID of the join (ts) node.
   * @param ids - Source instance IDs it merges (beyond its anchor parent).
   */
  joinParents_update(id: number, ids: number[]): void {
    const inst: ProcInstance | undefined = this.instances.get(id);
    if (inst) { inst.joinParentIDs = ids; this.change_emit({ scope: 'feed', feedID: inst.feedID }); }
  }

  /**
   * Returns the resolved join parent IDs for an instance, or an empty array when the
   * node has none or they have not been resolved yet.
   *
   * @param id - Instance ID.
   * @returns Source instance IDs, or `[]`.
   */
  joinParents_get(id: number): number[] {
    return this.instances.get(id)?.joinParentIDs ?? [];
  }

  // ── Topology loaded tracking ───────────────────────────────────────────────

  topologyLoaded_mark(feedID: number): void {
    this.topologyLoaded.add(feedID);
    this.change_emit({ scope: 'feed', feedID });
  }

  topologyLoaded_has(feedID: number): boolean {
    return this.topologyLoaded.has(feedID);
  }

  // ── In-flight map ─────────────────────────────────────────────────────────

  loading_set(feedID: number, promise: Promise<void>): void {
    this.loading.set(feedID, promise);
  }

  loading_get(feedID: number): Promise<void> | undefined {
    return this.loading.get(feedID);
  }

  loading_clear(feedID: number): void {
    this.loading.delete(feedID);
  }

  // ── Warm-up state ─────────────────────────────────────────────────────────

  warmup_complete(): void {
    this._warmupComplete = true;
    this._warmupProgress = { ...this._warmupProgress, active: false };
    this.lifecycle = { ...this.lifecycle, state: 'current' };
    this.change_emit({ scope: 'lifecycle' });
  }

  /**
   * Stops an unsuccessful warm-up without marking its topology complete.
   *
   * @returns Nothing.
   */
  warmup_abort(): void {
    this._warmupComplete = false;
    this._warmupProgress = { ...this._warmupProgress, active: false };
    this.lifecycle = { ...this.lifecycle, state: 'failed' };
    this.change_emit({ scope: 'lifecycle' });
  }

  warmup_progress(loaded: number, total: number): void {
    this._warmupProgress = { loaded, total, active: true };
  }

  warmupProgress_get(): ProcWarmupProgress {
    return { ...this._warmupProgress };
  }

  // ── Per-feed load and roster arrivals ─────────────────────────────────────

  /**
   * Records progress of one feed's topology load.
   *
   * @param feedID - The feed being loaded.
   * @param loaded - Instances fetched so far.
   * @param total - The server's count, or zero while unknown.
   */
  feedLoad_progress(feedID: number, loaded: number, total: number): void {
    this.feedLoads.set(feedID, { feedID, loaded, total });
  }

  /**
   * Ends one feed's load annunciation.
   *
   * @param feedID - The feed whose load finished or failed.
   */
  feedLoad_clear(feedID: number): void {
    this.feedLoads.delete(feedID);
  }

  /**
   * The feed load currently worth showing: the earliest still in flight.
   *
   * @returns The load in progress, or null when none is.
   */
  feedLoad_get(): ProcFeedLoadProgress | null {
    const first: ProcFeedLoadProgress | undefined = this.feedLoads.values().next().value;
    return first === undefined ? null : { ...first };
  }

  /**
   * Notes feeds the roster just gained, so surfaces can annunciate them.
   *
   * @param feedIDs - The arriving feed ids.
   * @param at - When they landed (default now).
   */
  arrivals_note(feedIDs: number[], at: number = Date.now()): void {
    for (const feedID of feedIDs) this.arrivals.set(feedID, at);
  }

  /**
   * Arrivals still within their annunciation window, oldest first; expired
   * ones are forgotten on the way.
   *
   * @param now - The current time (default now).
   * @returns Feed ids that arrived within {@link PROC_ARRIVAL_TTL_MS}.
   */
  arrivals_recent(now: number = Date.now()): number[] {
    const recent: number[] = [];
    for (const [feedID, at] of this.arrivals) {
      if (now - at > PROC_ARRIVAL_TTL_MS) this.arrivals.delete(feedID);
      else recent.push(feedID);
    }
    return recent;
  }

  /**
   * Resets reconciliation progress while retaining restored topology.
   *
   * @returns Nothing.
   */
  warmup_reset(): void {
    this._warmupComplete = false;
    this._warmupProgress = { loaded: this.instances.size, total: this.instances.size, active: false };
    this.lifecycle = this.lifecycle.checkpointAt
      ? { ...this.lifecycle, state: 'restored' }
      : { state: 'empty' };
    this.change_emit({ scope: 'lifecycle' });
  }

  // ── Path reconstruction ───────────────────────────────────────────────────

  /**
   * Reconstructs the full /proc/jobs path for a given instance ID.
   *
   * @param id - Instance ID.
   * @returns Full path string, or null if instance not in cache.
   *
   * @example
   * ```typescript
   * cache.path_build(64306)
   * // '/proc/jobs/feed_1107/pl-dircopy_64267/.../pl-neurofiles-push_64306'
   * ```
   */
  path_build(id: number): string | null {
    const inst: ProcInstance | undefined = this.instances.get(id);
    if (!inst) return null;
    const segments: string[] = [];
    let current: ProcInstance | undefined = inst;
    while (current) {
      segments.unshift(`${current.pluginName}_${current.id}`);
      if (current.parentID === null) break;
      current = this.instances.get(current.parentID);
    }
    return `/proc/jobs/feed_${inst.feedID}/${segments.join('/')}`;
  }

  /**
   * Searches cached feeds by title substring (case-insensitive).
   */
  feeds_find(term: string): ProcFeed[] {
    const lower: string = term.toLowerCase();
    return Array.from(this.feeds.values())
      .filter((f: ProcFeed) => f.title.toLowerCase().includes(lower));
  }

  /**
   * Searches cached instances by numeric ID or plugin name substring.
   */
  instances_find(term: string): ProcInstance[] {
    const numeric: number = parseInt(term, 10);
    const isID: boolean = !isNaN(numeric) && String(numeric) === term;
    if (isID) {
      const hit: ProcInstance | undefined = this.instances.get(numeric);
      return hit ? [hit] : [];
    }
    const lower: string = term.toLowerCase();
    return Array.from(this.instances.values())
      .filter((i: ProcInstance) => i.pluginName.toLowerCase().includes(lower));
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  built_set(): void {
    this._built = true;
  }

  /**
   * Creates a persistence-safe snapshot without parameters or active statuses.
   *
   * @returns Serializable feed and terminal-topology state.
   */
  snapshot_create(): ProcCacheSnapshot {
    const instances: ProcInstance[] = Array.from(this.instances.values()).map(procInstance_persistent);
    return {
      feeds: Array.from(this.feeds.values()).map((feed: ProcFeed): ProcFeed => ({ ...feed })),
      instances,
      topologyLoaded: Array.from(this.topologyLoaded),
    };
  }

  /**
   * Creates one feed's persistence-safe snapshot: its instances (terminal
   * status only, no params or output paths) and whether its topology is
   * complete. A per-feed checkpoint shard is exactly this.
   *
   * @param feedID - The feed to snapshot.
   * @returns The feed's shard content; empty when the feed holds no instances.
   */
  feedSnapshot_create(feedID: number): ProcFeedSnapshot {
    const instances: ProcInstance[] = [];
    for (const inst of this.instances.values()) {
      if (inst.feedID === feedID) instances.push(procInstance_persistent(inst));
    }
    return { feedID, loaded: this.topologyLoaded.has(feedID), instances };
  }

  /**
   * Feed IDs that hold any instances or a loaded mark — the feeds a full
   * checkpoint must shard.
   *
   * @returns Feed IDs with persistent topology state.
   */
  shardedFeedIDs_get(): number[] {
    const ids: Set<number> = new Set(this.topologyLoaded);
    for (const inst of this.instances.values()) ids.add(inst.feedID);
    return Array.from(ids);
  }

  /**
   * Replaces in-memory topology with a validated persistent snapshot.
   *
   * @param snapshot - Previously validated snapshot data.
   * @param checkpointAt - ISO timestamp when the checkpoint was written.
   * @returns Nothing.
   */
  snapshot_restore(snapshot: ProcCacheSnapshot, checkpointAt: string): void {
    this.cache_clear();
    for (const feed of snapshot.feeds) {
      this.feeds.set(feed.id, { ...feed });
      this.feedRoots.set(feed.id, []);
    }
    for (const inst of snapshot.instances) {
      const { outputPath: _outputPath, ...restored }: ProcInstance = inst;
      this.instance_add({ ...restored, params: null, status: status_isTerminal(inst.status) ? inst.status : null });
    }
    this.topologyLoaded = new Set(snapshot.topologyLoaded.filter((id: number): boolean => this.feeds.has(id)));
    this._warmupProgress = { loaded: this.instances.size, total: this.instances.size, active: false };
    this.lifecycle = { state: 'restored', checkpointAt };
    this.change_emit({ scope: 'lifecycle' });
  }

  /**
   * Records the timestamp of a successful durable save.
   *
   * @param checkpointAt - ISO timestamp written into the checkpoint.
   * @returns Nothing.
   */
  checkpoint_mark(checkpointAt: string): void {
    this.lifecycle = { ...this.lifecycle, checkpointAt };
  }

  /**
   * Clears all cache data. Called before a full rebuild.
   */
  cache_clear(): void {
    this.feeds.clear();
    this.instances.clear();
    this.feedRoots.clear();
    this.children.clear();
    this.topologyLoaded.clear();
    this.loading.clear();
    this.feedLoads.clear();
    this.arrivals.clear();
    this._warmupComplete = false;
    this._warmupProgress = { loaded: 0, total: 0, active: false };
    this._built = false;
    this.lifecycle = { state: 'empty' };
    this.change_emit({ scope: 'all' });
  }
}

/**
 * Returns the singleton ProcCache instance.
 *
 * @example
 * ```typescript
 * const cache = procCache_get();
 * cache.instance_add({ id: 789, feedID: 123, parentID: 456,
 *                      pluginName: 'pl-fshack', params: null, status: 'scheduled' });
 * ```
 */
export function procCache_get(): ProcCache {
  return ProcCache.instance_get();
}
