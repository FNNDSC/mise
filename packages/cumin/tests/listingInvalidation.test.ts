/**
 * @file Unit tests for feed-driven folder-listing invalidation.
 *
 * Covers the two rules the design turns on: someone else's act dirties
 * rather than deletes, and movement coalesces into one pass.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { listCache_get, type ListCache } from '../src/cache/listCache.js';
import {
  listingsForFeeds_note,
  listingsForRoster_note,
  listingInvalidation_flush,
  listingInvalidation_reset,
  LISTING_INVALIDATION_WINDOW_MS,
} from '../src/cache/listingInvalidation.js';

describe('listing invalidation', () => {
  let cache: ListCache;

  beforeEach(() => {
    cache = listCache_get();
    cache.stats_reset();
    cache.cache_invalidate();
    listingInvalidation_reset();
  });

  /** Reports whether a cached path is currently served as fresh. */
  function fresh_check(path: string): boolean {
    return cache.cache_get(path)?.fresh === true;
  }

  describe('what a feed touches', () => {
    it('dirties every cached listing belonging to the moved feed', () => {
      cache.cache_set('/home/someone/feeds/feed_12', ['a']);
      cache.cache_set('/home/someone/feeds/feed_12/pl-dircopy_3/data', ['b']);
      cache.cache_set('/home/someone/feeds/feed_99', ['c']);

      listingsForFeeds_note([12]);
      const marked: string[] = listingInvalidation_flush();

      expect(marked).toEqual([
        '/home/someone/feeds/feed_12',
        '/home/someone/feeds/feed_12/pl-dircopy_3/data',
      ]);
      expect(fresh_check('/home/someone/feeds/feed_99')).toBe(true);
    });

    it('reaches a shared feed by the same rule, with no extra wiring', () => {
      cache.cache_set('/SHARED/someone/feeds/feed_4299/pl-dircopy_1/data', ['x']);
      listingsForFeeds_note([4299]);
      expect(listingInvalidation_flush()).toEqual([
        '/SHARED/someone/feeds/feed_4299/pl-dircopy_1/data',
      ]);
    });

    it('leaves a listing that belongs to no feed alone', () => {
      cache.cache_set('/bin', ['pl-a']);
      listingsForFeeds_note([12]);
      expect(listingInvalidation_flush()).toEqual([]);
      expect(fresh_check('/bin')).toBe(true);
    });
  });

  describe('dirty, not delete', () => {
    it('keeps the entry so it can be served at once and refreshed behind', () => {
      cache.cache_set('/home/someone/feeds/feed_12', ['still here']);
      listingsForFeeds_note([12]);
      listingInvalidation_flush();

      // The distinguishing property: someone else's change leaves data to
      // serve. Your own `rm` deletes instead, which is the mutation path.
      const result = cache.cache_get<string[]>('/home/someone/feeds/feed_12');
      expect(result).not.toBeNull();
      expect(result?.data).toEqual(['still here']);
      expect(result?.fresh).toBe(false);
    });
  });

  describe('arrivals and departures', () => {
    it('dirties the parent folders a feed appears in, not just the feed', () => {
      cache.cache_set('/home/someone/feeds', ['feed_12']);
      cache.cache_set('/SHARED', ['someone']);
      cache.cache_set('/bin', ['pl-a']);

      listingsForRoster_note([4299], ['/home/someone/feeds', '/SHARED']);
      const marked: string[] = listingInvalidation_flush();

      expect(marked).toContain('/home/someone/feeds');
      expect(marked).toContain('/SHARED');
      expect(marked).not.toContain('/bin');
    });

    it('does nothing when a host has declared no parent folders', () => {
      cache.cache_set('/home/someone/feeds', ['feed_12']);
      listingsForRoster_note([4299], []);
      expect(listingInvalidation_flush()).toEqual([]);
    });
  });

  describe('coalescing', () => {
    it('collapses a burst of terminal transitions into one pass', () => {
      jest.useFakeTimers();
      try {
        cache.cache_set('/home/someone/feeds/feed_12/pl-a_1/data', ['a']);
        const markDirty = jest.spyOn(cache, 'cache_markDirty');

        // A fan-out stage finishing: thirty jobs, one feed, same second.
        for (let i = 0; i < 30; i++) listingsForFeeds_note([12]);
        expect(markDirty).not.toHaveBeenCalled();

        jest.advanceTimersByTime(LISTING_INVALIDATION_WINDOW_MS);
        expect(markDirty).toHaveBeenCalledTimes(1);
        markDirty.mockRestore();
      } finally {
        jest.useRealTimers();
      }
    });

    it('applies nothing until the window closes', () => {
      jest.useFakeTimers();
      try {
        cache.cache_set('/home/someone/feeds/feed_12', ['a']);
        listingsForFeeds_note([12]);

        jest.advanceTimersByTime(LISTING_INVALIDATION_WINDOW_MS - 1);
        expect(fresh_check('/home/someone/feeds/feed_12')).toBe(true);

        jest.advanceTimersByTime(1);
        expect(fresh_check('/home/someone/feeds/feed_12')).toBe(false);
      } finally {
        jest.useRealTimers();
      }
    });

    it('forgets pending movement on reset', () => {
      cache.cache_set('/home/someone/feeds/feed_12', ['a']);
      listingsForFeeds_note([12]);
      listingInvalidation_reset();
      expect(listingInvalidation_flush()).toEqual([]);
      expect(fresh_check('/home/someone/feeds/feed_12')).toBe(true);
    });

    it('ignores an empty note', () => {
      listingsForFeeds_note([]);
      expect(listingInvalidation_flush()).toEqual([]);
    });
  });
});
