/**
 * @file Virtual File System Router.
 *
 * Handles path resolution and dispatching to appropriate file system providers
 * (native ChRIS or virtual overlays like /bin).
 *
 * @module
 */
import { plugins_listAll, vfsDispatcher } from '@fnndsc/salsa';
import { session } from '../../session/index.js';
import chalk from 'chalk';
import * as path from 'path';
import { ambient_publish, ambient_hasListeners } from '../../core/ambient.js';
import { ListingItem } from '@fnndsc/chili/models/listing.js';
import { grid_render, long_render } from '@fnndsc/chili/views/ls.js';
import { list_applySort } from '@fnndsc/chili/utils/sort.js';
import { listCache_get, Result, Ok, Err, errorStack, feedTags_byFeed, type CommandEnvelope, envelope_ok, envelope_error } from '@fnndsc/cumin';
import { spinner } from '../spinner.js';
import { error_stripDebugPrefix } from '../../builtins/utils.js';
import { listingItemsFromVfs_make } from './listing.js';

/**
 * Virtual File System Router.
 * Dispatches operations to Virtual or Native providers.
 */
/**
 * A resolved directory listing with its freshness.
 *
 * @property path - The absolute path listed.
 * @property items - The entries.
 * @property fresh - True when current; false when served stale with a
 *   revalidation running behind it.
 */
export interface VfsListing {
  path: string;
  items: ListingItem[];
  fresh: boolean;
}

export class VFS {
  /**
   * Gets data for a directory (Virtual or Native).
   * Separated from rendering to allow Result<T> pattern.
   *
   * @param targetPath - The path to get data for. If empty, uses CWD.
   * @param options - Options including directory flag and sort.
   * @returns Result<ListingItem[]> - Ok with items or Err with error message.
   */
  async data_get(targetPath?: string, options: { sort?: 'name' | 'size' | 'date' | 'owner', reverse?: boolean, directory?: boolean } = {}): Promise<Result<ListingItem[]>> {
    const resolved: Result<VfsListing> = await this.listing_get(targetPath, options);
    return resolved.ok ? Ok(resolved.value.items) : Err();
  }

  /** Background revalidations in flight, one per path. */
  private revalidating: Map<string, Promise<void>> = new Map();

  /**
   * Re-fetches one listing behind a stale serve and publishes the fresh
   * result as an ambient `fs.listing` envelope, so every surface showing
   * that path repaints. One fetch per path at a time.
   *
   * @param effectivePath - The absolute path to refresh.
   */
  private listing_revalidate(effectivePath: string): Promise<void> {
    const inflight: Promise<void> | undefined = this.revalidating.get(effectivePath);
    if (inflight) return inflight;
    const run: Promise<void> = (async (): Promise<void> => {
      const fetched = await vfsDispatcher.list(effectivePath, {});
      if (!fetched.ok) return;
      const items: ListingItem[] = listingItemsFromVfs_make(fetched.value);
      listCache_get().cache_set(effectivePath, items);
      ambient_publish({
        kind: 'envelope',
        envelope: { status: 'ok', rendered: '', model: { kind: 'fs.listing', data: [{ path: effectivePath, items, fresh: true }] } },
      });
    })()
      .catch((): void => { /* the stale listing stands until the next visit */ })
      .finally((): void => { this.revalidating.delete(effectivePath); });
    this.revalidating.set(effectivePath, run);
    return run;
  }

  /**
   * Resolves a directory listing with its freshness. A fresh cached
   * listing is served as is. A stale one is served at once only when a
   * host can carry the refresh (an ambient listener exists — the daemon),
   * with the revalidation running behind it; at a plain console the stale
   * entry is refetched in line, because nobody would deliver the refresh.
   * `/proc` paths never touch this cache.
   *
   * @param targetPath - The path to list; the working directory when empty.
   * @param options - Sort and `-d` options.
   * @returns The listing, its absolute path, and whether it is current.
   */
  async listing_get(targetPath?: string, options: { sort?: 'name' | 'size' | 'date' | 'owner', reverse?: boolean, directory?: boolean } = {}): Promise<Result<VfsListing>> {
    try {
      const cwd: string = await session.getCWD();
      const effectivePath: string = targetPath
        ? path.posix.resolve(cwd, targetPath)
        : cwd;

      // -d: show the target entry itself rather than descending into it
      if (options.directory && targetPath) {
        const entry: Result<ListingItem[]> = await this.directoryEntry_get(effectivePath, options);
        return entry.ok ? Ok({ path: effectivePath, items: entry.value, fresh: true }) : Err();
      }

      // /proc paths are backed by ProcCache which manages its own freshness —
      // skip listCache entirely so proc refresh and live status reads are visible.
      const isProcPath: boolean = effectivePath.startsWith('/proc');

      // Check cache first (not for /proc paths)
      const listCache = listCache_get();
      if (!isProcPath) {
        const cached = listCache.cache_get<ListingItem[]>(effectivePath);
        if (cached && (cached.fresh || ambient_hasListeners())) {
          if (!cached.fresh) void this.listing_revalidate(effectivePath);
          const sortField: 'name' | 'size' | 'date' | 'owner' = options.sort || 'name';
          const sortedItems: ListingItem[] = list_applySort(cached.data, sortField, options.reverse);
          return Ok({ path: effectivePath, items: sortedItems, fresh: cached.fresh });
        }

        // Shell wildcard expansion reads and caches the parent directory before
        // passing each matched path to ls. Leaf entries are not directories to
        // descend into, so return the matching cached entry itself.
        const parentLeaf: ListingItem | null = this.leafFromParentCache_get(effectivePath);
        if (parentLeaf) {
          return Ok({ path: effectivePath, items: [parentLeaf], fresh: true });
        }
      }

      // Delegate path queries to the unified vfsDispatcher (which handles both virtual and native paths)
      const vfsResult = await vfsDispatcher.list(effectivePath, options);
      if (vfsResult.ok) {
        const items: ListingItem[] = listingItemsFromVfs_make(vfsResult.value);

        // Cache the results (not for /proc paths)
        if (!isProcPath) {
          listCache.cache_set(effectivePath, items);
        }

        return Ok({ path: effectivePath, items, fresh: true });
      }

      return Err();
    } catch (error: unknown) {
      const errorMsg: string = error instanceof Error ? error.message : String(error);
      errorStack.stack_push("error", `Failed to get directory data: ${errorMsg}`);
      return Err();
    }
  }

  /**
   * Returns the directory entry for `absolutePath` itself (not its contents).
   * Looks up the entry in the parent's listing — used to implement `ls -d`.
   *
   * @param absolutePath - The fully resolved path of the target.
   * @param options - Sort options forwarded to the parent listing.
   */
  private async directoryEntry_get(
    absolutePath: string,
    options: { sort?: 'name' | 'size' | 'date' | 'owner'; reverse?: boolean },
  ): Promise<Result<ListingItem[]>> {
    const baseName: string = path.posix.basename(absolutePath);
    const parentPath: string = path.posix.dirname(absolutePath);

    if (!baseName || absolutePath === '/') {
      return Ok([{ name: '/', type: 'vfs', size: 0, owner: 'root', date: '' }]);
    }

    // Fetch parent listing (use cache when available)
    const listCache = listCache_get();
    let parentItems: ListingItem[] | null = null;

    const cached = listCache.cache_get<ListingItem[]>(parentPath);
    if (cached) {
      parentItems = cached.data;
    } else {
      const parentResult = await vfsDispatcher.list(parentPath, options);
      if (parentResult.ok) {
        parentItems = listingItemsFromVfs_make(parentResult.value);
        listCache.cache_set(parentPath, parentItems);
      }
    }

    if (parentItems) {
      const match: ListingItem | undefined = parentItems.find((item: ListingItem) => item.name === baseName);
      if (match) return Ok([match]);
    }

    // Fallback: synthesize an entry from the path name
    return Ok([{ name: baseName, type: 'dir', size: 0, owner: 'system', date: '' }]);
  }

  /**
   * Finds a non-directory target in its cached parent listing.
   *
   * @param absolutePath - Absolute path whose parent was previously listed.
   * @returns The matching leaf item, or null when absent or directory-like.
   */
  private leafFromParentCache_get(absolutePath: string): ListingItem | null {
    const baseName: string = path.posix.basename(absolutePath);
    const parentPath: string = path.posix.dirname(absolutePath);
    const cached = listCache_get().cache_get<ListingItem[]>(parentPath);
    if (!cached) return null;

    const item: ListingItem | undefined = cached.data.find(
      (candidate: ListingItem): boolean => candidate.name === baseName,
    );
    // A link is not a leaf: plain `ls` follows a link to a directory (POSIX),
    // so it must fall through to the dispatcher, whose PathMapper resolves
    // the target. Returning the link entry here rendered `ls ~/public` as
    // the link itself whenever the parent listing happened to be cached.
    if (!item || item.type === 'dir' || item.type === 'vfs' || item.type === 'job' || item.type === 'link') {
      return null;
    }
    return item;
  }

  /**
   * List contents of a directory (Virtual or Native).
   * Convenience method that fetches data and renders it.
   * Implements optimistic rendering with progress feedback:
   * - Stale cache: serve immediately with "(cached, refreshing...)" indicator
   * - Cache miss: show "Fetching..." after 500ms if still loading
   *
   * @param targetPath - The path to list. If empty, uses CWD.
   * @param options - Listing options (long, human, sort, reverse, directory).
   */
  async list(targetPath?: string, options: { long?: boolean, human?: boolean, oneColumn?: boolean, sort?: 'name' | 'size' | 'date' | 'owner', reverse?: boolean, directory?: boolean } = {}): Promise<CommandEnvelope> {
    // Resolve effective path for cache checking
    const cwd: string = await session.getCWD();
    const effectivePath: string = targetPath
      ? path.posix.resolve(cwd, targetPath)
      : cwd;

    // A cache miss will wait on the wire; a stale entry may be served at
    // once (listing_get decides, and revalidates behind it where a host can
    // carry the refresh).
    const isCacheMiss: boolean = !listCache_get().cache_get(effectivePath);

    // For cache miss, show loading indicator after 500ms timeout
    let spinnerStarted: boolean = false; // Flag to track if spinner was actually started
    let spinnerDelayTimeout: NodeJS.Timeout | null = null;

    if (isCacheMiss) {
      spinnerDelayTimeout = setTimeout(() => {
        spinner.start('Fetching directory from remote', true); // The spinner message with timing
        spinnerStarted = true;
      }, 500);
    }

    // Only this listing's walk may name a parent whose links went unchecked.
    const { pathMapper_get } = await import('@fnndsc/chili/utils');
    pathMapper_get().blindParents_take();

    // Fetch data (may be from cache)
    const listing: Result<VfsListing> = await this.listing_get(targetPath, options);
    const blindParents: string[] = pathMapper_get().blindParents_take();
    const result: Result<ListingItem[]> = listing.ok ? Ok(listing.value.items) : Err();

    // Clear loading timeout and indicator
    if (spinnerDelayTimeout) {
      clearTimeout(spinnerDelayTimeout);
    }
    if (spinnerStarted) {
      spinner.stop();
    }

    if (!result.ok) {
      const lastError = errorStack.stack_pop();
      let renderedErr: string = lastError ? `${chalk.red(error_stripDebugPrefix(lastError.message))}\n` : '';
      // The walk to this path passed a folder whose links this identity may
      // not read (a shared feed's owner's home): a link there was not seen,
      // and may be why the path is not where the walk looked.
      for (const parent of blindParents) {
        renderedErr += `${chalk.yellow(`ls: links in '${parent}' could not be read; the path was walked as written`)}\n`;
      }
      return envelope_error('', undefined, renderedErr);
    }

    // A listing that could not read part of what it holds says so, and
    // still shows what it read: the provider names the sub-resource that
    // failed, and that reason travels with the answer rather than being
    // dropped for looking like success (#462).
    const unread: string[] = errorStack.stack_search('Cannot fully list');
    const partial: string = unread.length === 0
      ? ''
      : `${chalk.yellow(error_stripDebugPrefix(unread[unread.length - 1] ?? ''))}\n`;

    if (result.value.length === 0) {
      return partial === '' ? envelope_ok('') : envelope_error('', undefined, partial);
    }

    // Render based on options. A long listing over feeds shows their tags:
    // one map for the whole listing, never a read per feed.
    let rendered: string = options.long
      ? `${long_render(await feedTags_annotate(result.value), { human: !!options.human })}\n`
      : `${grid_render(result.value, { oneColumn: !!options.oneColumn })}\n`;

    // Served stale: say so. The refresh is already running behind this
    // answer and reaches every surface as an ambient listing.
    if (listing.ok && !listing.value.fresh) {
      rendered += `${chalk.gray('(cached, refreshing...)')}\n`;
    }

    if (partial !== '') {
      const envelope: CommandEnvelope = envelope_error(rendered, undefined, partial);
      return envelope;
    }
    return envelope_ok(rendered);
  }

  // Removed legacy virtual directory list helpers (fully unified under StaticVfsProvider and VFSDispatcher)
}

/**
 * Shared VFS singleton.
 */
export const vfs: VFS = new VFS();

/**
 * Hangs each feed's tags on its row, for a long listing that holds feeds
 * (`feed_N` rows). A listing with no feed in it reads nothing; a map that
 * cannot be read leaves the rows as they were.
 *
 * @param items - The rows.
 * @returns The rows, feeds carrying their tags.
 */
async function feedTags_annotate(items: ListingItem[]): Promise<ListingItem[]> {
  const feedOf = (name: string): number | null => {
    const match: RegExpMatchArray | null = name.match(/^feed_(\d+)$/);
    return match === null ? null : Number(match[1]);
  };
  if (!items.some((item: ListingItem): boolean => feedOf(item.name) !== null)) return items;
  const map: Result<Map<number, string[]>> = await feedTags_byFeed();
  if (!map.ok) {
    errorStack.stack_pop();
    return items;
  }
  return items.map((item: ListingItem): ListingItem => {
    const feedId: number | null = feedOf(item.name);
    const tags: string[] | undefined = feedId === null ? undefined : map.value.get(feedId);
    return tags === undefined ? item : { ...item, tags };
  });
}
