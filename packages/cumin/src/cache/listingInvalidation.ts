/**
 * @file Feed movement invalidates the folder listings it touched.
 *
 * The listing cache used to decide staleness with a clock that had no
 * relationship to when anything changed, while `/proc` — in the same
 * process — knew and said nothing. This is the wire between them.
 *
 * Two rules govern what happens on the far end:
 *
 * - **Your own act deletes; someone else's act dirties.** A mutation
 *   (rm, mv, cp, upload) removes the entry, because showing a file you
 *   just deleted is incoherent. A job's output or a colleague's share is
 *   not wrong, merely behind, so the entry is marked dirty and served at
 *   once while it refreshes behind.
 * - **Movement coalesces.** A feed completing a fan-out stage lands many
 *   terminal transitions in the same second; they collapse into one pass
 *   over the cache keys.
 *
 * Nothing here subscribes to the process cache's change stream. That
 * stream fires on every instance add and status observation, so indexing
 * one large feed emits tens of thousands of events, none of which mean a
 * file appeared. Movement is pushed from the two places that know.
 *
 * @module
 */
import { listCache_get } from './listCache';
import { path_extractFeedID } from '../path/chrisPath';

/**
 * How long feed movement collects before the cache is walked.
 *
 * Short on purpose: the whole point is that the mark beats the operator's
 * next listing of that folder.
 */
export const LISTING_INVALIDATION_WINDOW_MS: number = 1500;

/** Feed ids whose listings are waiting to be marked. */
const pendingFeeds: Set<number> = new Set();

/** Parent folders waiting to be marked, from arrivals and departures. */
const pendingParents: Set<string> = new Set();

/** The open coalescing window, or null when nothing is pending. */
let windowTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Marks every cached listing belonging to the given feeds, and any parent
 * folders queued alongside them.
 *
 * @returns The cache paths marked dirty.
 */
function pending_flush(): string[] {
  const feeds: Set<number> = new Set(pendingFeeds);
  const parents: Set<string> = new Set(pendingParents);
  pendingFeeds.clear();
  pendingParents.clear();
  windowTimer = null;
  if (feeds.size === 0 && parents.size === 0) return [];

  const cache = listCache_get();
  const marked: string[] = [];
  for (const path of cache.paths_get()) {
    const feedID: number | null = path_extractFeedID(path);
    const isFeedPath: boolean = feedID !== null && feeds.has(feedID);
    if (!isFeedPath && !parents.has(path)) continue;
    cache.cache_markDirty(path);
    marked.push(path);
  }
  return marked;
}

/** Opens the coalescing window if one is not already running. */
function window_open(): void {
  if (windowTimer !== null) return;
  windowTimer = setTimeout((): void => { pending_flush(); }, LISTING_INVALIDATION_WINDOW_MS);
  // A pending mark must never hold a process open on its own.
  windowTimer.unref?.();
}

/**
 * Notes that a feed's contents moved, so its cached folder listings are
 * behind. Call when a job crosses into a terminal state — that is when
 * output becomes visible.
 *
 * @param feedIDs - Feeds whose contents changed.
 */
export function listingsForFeeds_note(feedIDs: readonly number[]): void {
  if (feedIDs.length === 0) return;
  for (const feedID of feedIDs) pendingFeeds.add(feedID);
  window_open();
}

/**
 * Notes that feeds arrived in, or vanished from, a parent folder.
 *
 * An arrival changes the *parent* listing rather than anything inside the
 * feed, which is why this takes the folders as well: a feed shared to this
 * identity adds a row to a folder that may itself be perfectly fresh.
 *
 * @param feedIDs - Feeds that arrived or departed.
 * @param parentPaths - Folder listings whose membership therefore changed.
 */
export function listingsForRoster_note(feedIDs: readonly number[], parentPaths: readonly string[]): void {
  if (feedIDs.length === 0 && parentPaths.length === 0) return;
  for (const feedID of feedIDs) pendingFeeds.add(feedID);
  for (const path of parentPaths) pendingParents.add(path);
  window_open();
}

/**
 * Applies any pending movement at once, without waiting for the window.
 *
 * @returns The cache paths marked dirty.
 */
export function listingInvalidation_flush(): string[] {
  if (windowTimer !== null) {
    clearTimeout(windowTimer);
    windowTimer = null;
  }
  return pending_flush();
}

/** Discards pending movement without applying it (tests, cache reset). */
export function listingInvalidation_reset(): void {
  if (windowTimer !== null) {
    clearTimeout(windowTimer);
    windowTimer = null;
  }
  pendingFeeds.clear();
  pendingParents.clear();
}
