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
  /** null until first cat — immutable once populated. */
  params: Record<string, unknown> | null;
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

  /** Whether initial feed index has been built. */
  private _built: boolean = false;

  private lifecycle: ProcCacheLifecycle = { state: 'empty' };
  private listeners: Set<() => void> = new Set();

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
    this.change_emit();
  }

  /**
   * Registers a callback for checkpoint-worthy cache mutations.
   *
   * @param listener - Callback invoked after a cache mutation.
   * @returns Function that unregisters the callback.
   */
  changeListener_add(listener: () => void): () => void {
    this.listeners.add(listener);
    return (): void => { this.listeners.delete(listener); };
  }

  private change_emit(): void {
    for (const listener of this.listeners) listener();
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
    this.change_emit();
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
    this.change_emit();
  }

  /**
   * Replaces the visible feed set while preserving topology for retained feeds.
   *
   * @param feeds - Authoritative feeds visible to the current identity.
   * @returns Nothing.
   */
  feeds_reconcile(feeds: ProcFeed[]): void {
    const visible: Set<number> = new Set(feeds.map((feed: ProcFeed): number => feed.id));
    for (const feedID of this.feedIDs_get()) {
      if (!visible.has(feedID)) this.feed_remove(feedID);
    }
    for (const feed of feeds) this.feed_add(feed);
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
    this.change_emit();
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
    this.change_emit();
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
    this.change_emit();
  }

  /**
   * Updates cached params for an instance (on first cat).
   */
  params_update(id: number, params: Record<string, unknown>): void {
    const inst: ProcInstance | undefined = this.instances.get(id);
    if (inst) inst.params = params;
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
    if (inst.status !== status) { inst.status = status; this.change_emit(); }
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
    if (inst) { inst.joinParentIDs = ids; this.change_emit(); }
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
    this.change_emit();
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
    this.change_emit();
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
    this.change_emit();
  }

  warmup_progress(loaded: number, total: number): void {
    this._warmupProgress = { loaded, total, active: true };
  }

  warmupProgress_get(): ProcWarmupProgress {
    return { ...this._warmupProgress };
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
    this.change_emit();
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
    const instances: ProcInstance[] = Array.from(this.instances.values()).map((inst: ProcInstance): ProcInstance => ({
      ...inst,
      params: null,
      status: status_isTerminal(inst.status) ? inst.status : null,
      joinParentIDs: inst.joinParentIDs ? [...inst.joinParentIDs] : undefined,
    }));
    return {
      feeds: Array.from(this.feeds.values()).map((feed: ProcFeed): ProcFeed => ({ ...feed })),
      instances,
      topologyLoaded: Array.from(this.topologyLoaded),
    };
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
      this.instance_add({ ...inst, params: null, status: status_isTerminal(inst.status) ? inst.status : null });
    }
    this.topologyLoaded = new Set(snapshot.topologyLoaded.filter((id: number): boolean => this.feeds.has(id)));
    this._warmupProgress = { loaded: this.instances.size, total: this.instances.size, active: false };
    this.lifecycle = { state: 'restored', checkpointAt };
    this.change_emit();
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
    this._warmupComplete = false;
    this._warmupProgress = { loaded: 0, total: 0, active: false };
    this._built = false;
    this.lifecycle = { state: 'empty' };
    this.change_emit();
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
