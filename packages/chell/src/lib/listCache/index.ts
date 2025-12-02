/**
 * @file Directory Listing Cache.
 *
 * Provides a singleton cache for directory listings to avoid redundant API calls
 * during tab completion and file operations. Cache is invalidated when the user
 * navigates to a different directory or when file operations modify the directory.
 *
 * @module
 */
import { ListingItem } from '@fnndsc/chili/models/listing.js';

/**
 * Statistics about cache usage.
 */
export interface CacheStats {
  /** Total number of cache hits. */
  hits: number;

  /** Total number of cache misses. */
  misses: number;

  /** Number of entries currently in cache. */
  entries: number;

  /** Current working directory being tracked. */
  currentCwd: string;
}

/**
 * Singleton cache for directory listings.
 *
 * Eliminates redundant API calls by caching directory contents after ls operations.
 * Cache is automatically invalidated when:
 * - User navigates to a different directory (cd)
 * - File operations modify the directory (mkdir, touch, rm, upload)
 *
 * Usage:
 * ```typescript
 * const cache = listCache_get();
 *
 * // After ls operation
 * cache.cache_set("/PUBLIC", items);
 *
 * // During tab completion
 * const cached = cache.cache_get("/PUBLIC");
 * if (cached) {
 *   // Use cached items
 * } else {
 *   // Fetch from API
 * }
 *
 * // On directory change
 * cache.cwd_update("/PUBLIC/feeds");
 * ```
 */
export class ListCache {
  private static instance: ListCache;

  /** Cache storage: path → listing items. */
  private cache: Map<string, ListingItem[]> = new Map();

  /** Current working directory being tracked. */
  private currentCwd: string = '';

  /** Cache statistics. */
  private stats = {
    hits: 0,
    misses: 0,
  };

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
   * Stores directory listing in cache.
   *
   * @param path - The directory path.
   * @param items - The listing items for this directory.
   */
  cache_set(path: string, items: ListingItem[]): void {
    this.cache.set(path, items);
  }

  /**
   * Retrieves directory listing from cache.
   *
   * @param path - The directory path.
   * @returns The cached listing items, or null if not in cache.
   */
  cache_get(path: string): ListingItem[] | null {
    const items = this.cache.get(path);
    if (items !== undefined) {
      this.stats.hits++;
      return items;
    }
    this.stats.misses++;
    return null;
  }

  /**
   * Updates current working directory and invalidates cache if changed.
   * Called by session.setCWD() when user navigates to a different directory.
   *
   * @param newCwd - The new current working directory.
   */
  cwd_update(newCwd: string): void {
    if (newCwd !== this.currentCwd) {
      this.cache.clear();
      this.currentCwd = newCwd;
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
  }

  /**
   * Gets cache statistics.
   *
   * @returns Cache statistics including hits, misses, and current state.
   */
  stats_get(): CacheStats {
    return {
      hits: this.stats.hits,
      misses: this.stats.misses,
      entries: this.cache.size,
      currentCwd: this.currentCwd,
    };
  }

  /**
   * Resets cache statistics.
   * Useful for testing and monitoring.
   */
  stats_reset(): void {
    this.stats.hits = 0;
    this.stats.misses = 0;
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
