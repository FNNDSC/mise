/**
 * @file Shared bookkeeping for newly created feeds.
 * @module
 */

import { procCache_get } from '@fnndsc/cumin';

/** Optional child scheduled immediately below the pl-dircopy root. */
export interface NewFeedChild {
  id: number;
  pluginName: string;
}

/** Data needed to expose a newly created feed through `/proc` immediately. */
export interface NewFeedCacheEntry {
  feedID: number;
  title: string;
  ownerUsername: string;
  rootInstanceID: number;
  child?: NewFeedChild;
}

/**
 * Adds a new feed, its pl-dircopy root, and an optional child to ProcCache.
 *
 * @param entry - Stable feed/root identities plus optional scheduled child.
 */
export function newFeed_cacheAdd(entry: NewFeedCacheEntry): void {
  const scheduledJobs: number = entry.child ? 2 : 1;
  procCache_get().feed_add({
    id: entry.feedID,
    title: entry.title,
    ownerUsername: entry.ownerUsername,
    public: false,
    creationDate: new Date().toISOString(),
    finishedJobs: 0,
    erroredJobs: 0,
    startedJobs: 0,
    scheduledJobs,
    cancelledJobs: 0,
    createdJobs: 0,
  });
  procCache_get().instance_add({
    id: entry.rootInstanceID,
    feedID: entry.feedID,
    parentID: null,
    pluginName: 'pl-dircopy',
    params: null,
    status: 'scheduled',
  });
  if (entry.child) {
    procCache_get().instance_add({
      id: entry.child.id,
      feedID: entry.feedID,
      parentID: entry.rootInstanceID,
      pluginName: entry.child.pluginName,
      params: null,
      status: 'scheduled',
    });
  }
}
