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


/**
 * Keeps a run just started live until it settles.
 *
 * Kept OUT of {@link newFeed_cacheAdd}, which is a cache write and nothing
 * more: a helper that quietly began visiting a remote service would surprise
 * every caller, and it did — the moment it was tried, every test that
 * records a feed started a sampler. A run is followed where a run is
 * STARTED, which is a decision the command makes.
 *
 * A new feed enters the cache with its jobs SCHEDULED, because that is what
 * they are at the instant of creation. Nothing then followed them: the
 * operator's own run never turned over to running, never turned over to
 * finished, and the lab's pulse in the header counted it as scheduled for
 * as long as the cache lived. The count only ever climbed — one operator's
 * header read SCHEDULED 90 with nothing running at all, which is not a
 * gauge, it is a tally of everything they had ever started.
 *
 * The sampler already exists and already knows when to stop: it visits on
 * an adaptive cadence and ends the moment the feed is settled, because a
 * settled feed cannot change. Starting a run is exactly the moment worth
 * watching, so the run itself takes out the watch. Nobody has to be looking
 * at a pane for the header to tell the truth.
 *
 * Held behind a lazy import: a host that never starts a run never loads the
 * sampler, and the module graph stays what it was.
 *
 * @param feedID - The feed that has just been given work.
 */
export function run_follow(feedID: number): void {
  void import('./procWatch.js')
    .then(({ procWatch_add }): void => {
      procWatch_add(feedID, RUN_WATCH_OWNER);
    })
    .catch((): void => {
      // A run that cannot be followed still ran. The pulse lags; nothing
      // else is worse for it.
    });
}

/** Who holds a watch taken out by the run itself, rather than by a pane. */
export const RUN_WATCH_OWNER: string = 'kernel:run';
