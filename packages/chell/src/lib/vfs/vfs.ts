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
import { ListingItem } from '@fnndsc/chili/models/listing.js';
import { grid_render, long_render } from '@fnndsc/chili/views/ls.js';
import { list_applySort } from '@fnndsc/chili/utils/sort.js';
import { listCache_get, Result, Ok, Err, errorStack } from '@fnndsc/cumin';
import { spinner } from '../spinner.js';
import { builtinCommands_list, builtinCommand_description } from '../../builtins/help.js';
import { error_stripDebugPrefix } from '../../builtins/utils.js';

/**
 * Virtual File System Router.
 * Dispatches operations to Virtual or Native providers.
 */
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
    try {
      const cwd: string = await session.getCWD();
      const effectivePath: string = targetPath
        ? path.posix.resolve(cwd, targetPath)
        : cwd;

      // Check cache first
      const listCache = listCache_get();
      const cached = listCache.cache_get<ListingItem[]>(effectivePath);
      if (cached) {
        const sortField: 'name' | 'size' | 'date' | 'owner' = options.sort || 'name';
        const sortedItems: ListingItem[] = list_applySort(cached.data, sortField, options.reverse);
        return Ok(sortedItems);
      }

      // Delegate path queries to the unified vfsDispatcher (which handles both virtual and native paths)
      const vfsResult = await vfsDispatcher.list(effectivePath, options);
      if (vfsResult.ok) {
        const items = vfsResult.value as unknown as ListingItem[];

        // Cache the results!
        listCache.cache_set(effectivePath, items);

        return Ok(items);
      }

      return Err();
    } catch (error: unknown) {
      const errorMsg: string = error instanceof Error ? error.message : String(error);
      errorStack.stack_push("error", `Failed to get directory data: ${errorMsg}`);
      return Err();
    }
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
  async list(targetPath?: string, options: { long?: boolean, human?: boolean, sort?: 'name' | 'size' | 'date' | 'owner', reverse?: boolean, directory?: boolean } = {}): Promise<void> {
    // Resolve effective path for cache checking
    const cwd: string = await session.getCWD();
    const effectivePath: string = targetPath
      ? path.posix.resolve(cwd, targetPath)
      : cwd;

    // Check if we're serving from stale cache BEFORE fetching
    const listCache = listCache_get();
    const cached = listCache.cache_get(effectivePath);
    const wasStale = cached && !cached.fresh;
    const isCacheMiss = !cached;

    // For cache miss, show loading indicator after 500ms timeout
    let spinnerStarted = false; // Flag to track if spinner was actually started
    let spinnerDelayTimeout: NodeJS.Timeout | null = null;

    if (isCacheMiss) {
      spinnerDelayTimeout = setTimeout(() => {
        spinner.start('Fetching directory from remote', true); // The spinner message with timing
        spinnerStarted = true;
      }, 500);
    }

    // Fetch data (may be from cache)
    const result: Result<ListingItem[]> = await this.data_get(targetPath, options);

    // Clear loading timeout and indicator
    if (spinnerDelayTimeout) {
      clearTimeout(spinnerDelayTimeout);
    }
    if (spinnerStarted) {
      spinner.stop();
    }

    if (!result.ok) {
      const lastError = errorStack.stack_pop();
      if (lastError) {
        console.error(chalk.red(error_stripDebugPrefix(lastError.message)));
      }
      return;
    }

    if (result.value.length === 0) {
      return;
    }

    // Render based on options
    if (options.long) {
      console.log(long_render(result.value, { human: !!options.human }));
    } else {
      console.log(grid_render(result.value));
    }

    // If we served stale cache, show indicator and refresh in background
    if (wasStale) {
      console.log(chalk.gray('(cached, refreshing...)'));
      // Trigger background refresh - don't await
      this.refreshInBackground(effectivePath, options).catch(() => {
        // Silently ignore refresh errors - user has moved on
      });
    }
  }

  /**
   * Refreshes cache in the background without blocking or updating display.
   * Used for optimistic rendering - fetch fresh data after serving stale cache.
   *
   * @param targetPath - The path to refresh.
   * @param options - Options including sort and reverse.
   */
  private async refreshInBackground(targetPath: string, options: { sort?: 'name' | 'size' | 'date' | 'owner', reverse?: boolean, directory?: boolean }): Promise<void> {
    try {
      // Invalidate cache to force fresh fetch
      const listCache = listCache_get();
      listCache.cache_invalidate(targetPath);

      // Fetch fresh data - this will repopulate cache
      await this.data_get(targetPath, options);

      // Don't update display - user has moved on
      // Fresh data is now cached for next access
    } catch (error) {
      // Silently fail - background refresh is best-effort
    }
  }

  // Removed legacy virtual directory list helpers (fully unified under StaticVfsProvider and VFSDispatcher)
}

export const vfs = new VFS();
