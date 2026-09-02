/**
 * @file Enhanced Directory Listing Cache with TTL and dirty tracking.
 *
 * Provides a singleton cache for directory listings to avoid redundant API calls
 * during tab completion and file operations. Features:
 * - TTL-based expiration (different TTLs per path pattern)
 * - Dirty flag tracking (local mutations mark cache as needing refresh)
 * - LRU eviction (bounded memory usage)
 * - Optimistic serving (serve stale cache while refreshing)
 *
 * Generic implementation - stores any data type keyed by path.
 *
 * @module
 */

/**
 * Cache entry with metadata.
 */
interface CacheEntry<T = unknown> {
  /** The cached data (ListingItem[], plugin list, etc.) */
  data: T;

  /** Timestamp when cached (milliseconds since epoch) */
  timestamp: number;

  /** True if local mutation happened (rm, mkdir, touch, upload) */
  dirty: boolean;

  /** Time-to-live in milliseconds */
  ttl: number;
}

/**
 * Result returned by cache_get with freshness information.
 */
export interface CacheResult<T = unknown> {
  /** The cached data */
  data: T;

  /** True if within TTL and not dirty */
  fresh: boolean;

  /** Age in milliseconds */
  age: number;
}

/**
 * Options for cache_set.
 */
export interface CacheOptions {
  /** Override default TTL for this entry (milliseconds) */
  ttl?: number;

  /** Mark as dirty immediately */
  dirty?: boolean;
}

/**
 * A persistence-safe copy of one cache entry.
 *
 * @property path - The listed path.
 * @property data - The cached listing.
 * @property timestamp - When it was cached (ms since epoch); age is judged
 *   against this on restore, so a restored entry is as stale as it really is.
 * @property dirty - Whether a local mutation invalidated it.
 * @property ttl - Its time-to-live in milliseconds.
 */
export interface ListCacheEntrySnapshot {
  path: string;
  data: unknown;
  timestamp: number;
  dirty: boolean;
  ttl: number;
}

/** The whole cache, oldest entry first (the LRU order). */
export interface ListCacheSnapshot {
  entries: ListCacheEntrySnapshot[];
}

/**
 * Statistics about cache usage.
 */
export interface CacheStats {
  /** Total number of cache hits (fresh). */
  hits: number;

  /** Total number of cache misses. */
  misses: number;

  /** Total number of stale hits (served but expired). */
  staleHits: number;

  /** Number of LRU evictions. */
  evictions: number;

  /** Number of entries currently in cache. */
  entries: number;

  /** Estimated total memory usage in bytes. */
  totalSize: number;
}

/**
 * Singleton cache for directory listings with TTL and dirty tracking.
 *
 * Generic cache that stores any data type keyed by path. Eliminates redundant
 * API calls by caching directory contents after ls operations.
 *
 * Enhanced features:
 * - TTL-based expiration: Different paths have different TTLs
 * - Dirty flag tracking: Local mutations mark cache as needing refresh
 * - LRU eviction: Bounded memory usage
 * - Optimistic serving: Serve stale cache immediately, refresh in background
 *
 * Usage:
 * ```typescript
 * const cache = listCache_get();
 *
 * // Check cache (returns CacheResult with freshness info)
 * const cached = cache.cache_get("/PUBLIC");
 * if (cached) {
 *   console.log(cached.data);  // Show immediately
 *   if (!cached.fresh) {
 *     console.log('Refreshing...');
 *     // Fetch fresh data in background
 *   }
 * }
 *
 * // Store data
 * cache.cache_set("/PUBLIC", items);
 *
 * // Mark dirty after mutation
 * cache.cache_markDirty("/home/user");
 *
 * // Optimistic update
 * cache.cache_update("/home/user", (items) => items.filter(i => i.name !== 'deleted.txt'));
 * ```
 */
export class ListCache {
  private static instance: ListCache;

  /** Cache storage: path → entry. */
  private cache: Map<string, CacheEntry<unknown>> = new Map();

  /** Maximum cache entries (LRU eviction). */
  private maxEntries: number = 100;

  /** Default TTL for unconfigured paths (3 minutes). */
  private defaultTTL: number = 3 * 60 * 1000;

  /** Path-specific TTL configuration. */
  private ttlConfig: Map<string, number> = new Map([
    ['/PUBLIC', 10 * 60 * 1000],     // 10 min (stable, public directory)
    ['/home', 5 * 60 * 1000],         // 5 min (user home directories)
    ['/bin', 60 * 60 * 1000],         // 1 hour (plugins rarely change)
    ['/feeds/*', 5 * 60 * 1000],      // 5 min (feed outputs)
  ]);

  /** Cache statistics. */
  private stats = {
    hits: 0,
    misses: 0,
    staleHits: 0,
    evictions: 0,
  };
  /** Listeners told after any mutation a persister would want to see. */
  private listeners: Set<() => void> = new Set();

  /**
   * Registers a callback for checkpoint-worthy mutations (set, update,
   * dirty, invalidate).
   *
   * @param listener - Callback invoked after a mutation.
   * @returns Function that unregisters the callback.
   */
  changeListener_add(listener: () => void): () => void {
    this.listeners.add(listener);
    return (): void => { this.listeners.delete(listener); };
  }

  private change_emit(): void {
    for (const listener of this.listeners) listener();
  }

  /**
   * Creates a persistence-safe copy of every entry, oldest first.
   *
   * @returns The snapshot.
   */
  snapshot_create(): ListCacheSnapshot {
    const entries: ListCacheEntrySnapshot[] = [];
    for (const [path, entry] of this.cache) {
      entries.push({ path, data: entry.data, timestamp: entry.timestamp, dirty: entry.dirty, ttl: entry.ttl });
    }
    return { entries };
  }

  /**
   * Replaces the cache with a snapshot's entries, keeping their original
   * timestamps: what was stale stays stale and is revalidated on its next
   * visit. Entries beyond the LRU bound are dropped oldest-first.
   *
   * @param snapshot - A validated snapshot.
   */
  snapshot_restore(snapshot: ListCacheSnapshot): void {
    this.cache.clear();
    for (const entry of snapshot.entries) {
      this.cache.set(entry.path, { data: entry.data, timestamp: entry.timestamp, dirty: entry.dirty, ttl: entry.ttl });
    }
    this.evict_lru();
    this.change_emit();
  }

  /**
   * Private constructor to enforce singleton pattern.
   */
  private constructor() {}

  /**
   * Gets the singleton instance of ListCache.
   *
   * @returns The ListCache singleton instance.
   */
  static instance_get(): ListCache {
    if (!ListCache.instance) {
      ListCache.instance = new ListCache();
    }
    return ListCache.instance;
  }

  /**
   * Retrieves data from cache with freshness information.
   *
   * @param path - The path to retrieve.
   * @returns CacheResult with freshness info, or null if not cached.
   */
  cache_get<T = unknown>(path: string): CacheResult<T> | null {
    const entry: CacheEntry<unknown> | undefined = this.cache.get(path);

    if (!entry) {
      this.stats.misses++;
      return null;
    }

    // LRU: Move to end (mark as recently used)
    this.cache.delete(path);
    this.cache.set(path, entry);

    // Calculate freshness
    const age: number = Date.now() - entry.timestamp;
    const fresh: boolean = !entry.dirty && age < entry.ttl;

    if (fresh) {
      this.stats.hits++;
    } else {
      this.stats.staleHits++;
    }

    return { data: entry.data as T, fresh, age };
  }

  /**
   * Stores data in cache with optional TTL override.
   *
   * @param path - The path to cache.
   * @param data - The data to cache.
   * @param options - Optional TTL and dirty flag.
   */
  cache_set<T = unknown>(path: string, data: T, options?: CacheOptions): void {
    // LRU: If exists, delete and re-add (moves to end)
    if (this.cache.has(path)) {
      this.cache.delete(path);
    }

    const ttl: number = options?.ttl ?? this.ttl_get(path);

    this.cache.set(path, {
      data,
      timestamp: Date.now(),
      dirty: options?.dirty ?? false,
      ttl,
    });

    // LRU eviction if over limit
    this.evict_lru();
    this.change_emit();
  }

  /**
   * Marks a cached path as dirty (needs refresh).
   * Used when local mutations might have changed the data.
   *
   * @param path - The path to mark dirty.
   */
  cache_markDirty(path: string): void {
    const entry: CacheEntry<unknown> | undefined = this.cache.get(path);
    if (entry) {
      entry.dirty = true;
      this.change_emit();
    }
  }

  /**
   * Optimistically updates cache after a mutation.
   * Example: After rm, remove item from parent directory cache.
   *
   * @param path - The parent directory path.
   * @param updater - Function to transform cached data.
   */
  cache_update<T = unknown>(path: string, updater: (data: T) => T): void {
    const entry: CacheEntry<unknown> | undefined = this.cache.get(path);
    if (entry) {
      entry.data = updater(entry.data as T);
      entry.timestamp = Date.now();  // Reset timestamp
      entry.dirty = false;            // Clean after update
      this.change_emit();
    }
  }

  /**
   * Invalidates cache for a specific path or clears entire cache.
   * Called by file operations that modify directory contents (mkdir, touch, rm, upload).
   *
   * @param path - Optional specific path to invalidate. If omitted, clears entire cache.
   */
  cache_invalidate(path?: string): void {
    if (path !== undefined) {
      this.cache.delete(path);
    } else {
      this.cache.clear();
    }
    this.change_emit();
  }

  /**
   * Invalidates a path and every cached listing beneath it.
   * Called by operations that remove or replace an entire directory tree
   * (rm -r, a directory re-upload): nested listings cached before the
   * mutation would otherwise serve the old tree's contents until their TTL
   * expires, with no refresh hint.
   *
   * @param path - Root of the subtree to invalidate. The entry for the path
   *     itself is removed along with all entries under `path + '/'`.
   */
  cache_invalidateTree(path: string): void {
    this.cache.delete(path);
    const prefix: string = path.endsWith("/") ? path : `${path}/`;
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) {
        this.cache.delete(key);
      }
    }
    this.change_emit();
  }

  /**
   * @deprecated Use cache without cwd tracking. Cache persists across navigation.
   * This method is kept for backward compatibility but does nothing.
   *
   * @param _newCwd - Ignored.
   */
  cwd_update(_newCwd: string): void {
    // No-op: Cache no longer flushes on directory change
    // Kept for backward compatibility during transition
  }

  /**
   * Gets TTL for a specific path based on configuration.
   *
   * @param path - The path to get TTL for.
   * @returns TTL in milliseconds.
   */
  private ttl_get(path: string): number {
    if (this.ttlConfig.has(path)) {
      return this.ttlConfig.get(path)!;
    }

    for (const [pattern, ttl] of this.ttlConfig) {
      if (pattern.includes('*')) {
        const regex: RegExp = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
        if (regex.test(path)) {
          return ttl;
        }
      }
    }

    return this.defaultTTL;
  }

  /**
   * Evicts oldest entries if cache exceeds max size.
   */
  private evict_lru(): void {
    while (this.cache.size > this.maxEntries) {
      const oldestKey: string | undefined = this.cache.keys().next().value;
      if (oldestKey !== undefined) {
        this.cache.delete(oldestKey);
        this.stats.evictions++;
      } else {
        break;  // Should never happen, but safety check
      }
    }
  }

  /**
   * Gets cache statistics.
   *
   * @returns Cache statistics including hits, misses, and current state.
   */
  stats_get(): CacheStats {
    let totalSize: number = 0;
    for (const entry of this.cache.values()) {
      // Rough estimate: JSON string length
      totalSize += JSON.stringify(entry.data).length;
    }

    return {
      hits: this.stats.hits,
      misses: this.stats.misses,
      staleHits: this.stats.staleHits,
      evictions: this.stats.evictions,
      entries: this.cache.size,
      totalSize,
    };
  }

  /**
   * Resets cache statistics.
   * Useful for testing and monitoring.
   */
  stats_reset(): void {
    this.stats.hits = 0;
    this.stats.misses = 0;
    this.stats.staleHits = 0;
    this.stats.evictions = 0;
  }
}

/**
 * Convenience function to get the ListCache singleton instance.
 *
 * @returns The ListCache singleton instance.
 */
export function listCache_get(): ListCache {
  return ListCache.instance_get();
}
