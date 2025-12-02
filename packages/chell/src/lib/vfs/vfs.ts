/**
 * @file Virtual File System Router.
 *
 * Handles path resolution and dispatching to appropriate file system providers
 * (native ChRIS or virtual overlays like /bin).
 *
 * @module
 */
import { plugins_listAll } from '@fnndsc/salsa';
import { session } from '../../session/index.js';
import chalk from 'chalk';
import * as path from 'path';
import { files_list } from '@fnndsc/chili/commands/fs/ls.js';
import { ListingItem } from '@fnndsc/chili/models/listing.js';
import { grid_render, long_render } from '@fnndsc/chili/views/ls.js';
import { list_applySort } from '@fnndsc/chili/utils/sort.js';
import { listCache_get, Result, Ok, Err, errorStack } from '@fnndsc/cumin';
import { spinner } from '../spinner.js';

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

      if (effectivePath === '/bin') {
        return await this.dataVirtualBin_get(options);
      } else {
        return await this.dataNative_get(effectivePath, options);
      }
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
        spinner.start('Fetching directory from remote'); // The spinner message
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
        console.error(chalk.red(lastError.message));
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

  /**
   * Gets data for the virtual `/bin` directory (plugins).
   * Returns Result<ListingItem[]> for proper error handling.
   *
   * @param options - Options including sort and reverse.
   * @returns Result<ListingItem[]>.
   */
  private async dataVirtualBin_get(options: { sort?: 'name' | 'size' | 'date' | 'owner', reverse?: boolean } = {}): Promise<Result<ListingItem[]>> {
    try {
      // Check cache first
      const listCache = listCache_get();
      const cached = listCache.cache_get('/bin');

      if (cached) {
        // Cache hit - return cached data
        // Note: Cache already has sorted data, but respect current sort options
        const sortField: 'name' | 'size' | 'date' | 'owner' = options.sort || 'name';
        const sortedItems: ListingItem[] = list_applySort(cached.data, sortField, options.reverse);
        return Ok(sortedItems);
      }

      // Cache miss - fetch from API
      const plugins = await plugins_listAll({});
      const items: ListingItem[] = [];

      if (plugins && plugins.tableData) {
        plugins.tableData.forEach((plugin: Record<string, unknown>) => {
          // Format as single string: pl-name-v1.0.5
          const pluginName: string = typeof plugin.name === 'string' ? plugin.name : String(plugin.name);
          const pluginVersion: string = typeof plugin.version === 'string' ? plugin.version : String(plugin.version || '');
          const displayName: string = pluginVersion
            ? `${pluginName}-v${pluginVersion}`
            : pluginName;

          items.push({
            name: displayName,
            type: 'plugin',
            size: 0,
            owner: 'system',
            date: typeof plugin.creation_date === 'string' ? plugin.creation_date : '',
          });
        });
      }

      // Apply sorting
      const sortField: 'name' | 'size' | 'date' | 'owner' = options.sort || 'name';
      const sortedItems: ListingItem[] = list_applySort(items, sortField, options.reverse);

      // Cache the results
      listCache.cache_set('/bin', sortedItems);

      return Ok(sortedItems);
    } catch (error: unknown) {
      const errorMsg: string = error instanceof Error ? error.message : String(error);
      errorStack.stack_push("error", `Failed to list plugins: ${errorMsg}`);
      return Err();
    }
  }

  /**
   * Gets the contents of the virtual `/bin` directory (plugins) as ListingItems.
   * Legacy method for backward compatibility. Consider using dataVirtualBin_get() instead.
   *
   * @returns A Promise resolving to an array of ListingItems.
   */
  async virtualBinItems_get(): Promise<ListingItem[]> {
    const result: Result<ListingItem[]> = await this.dataVirtualBin_get();
    return result.ok ? result.value : [];
  }


  /**
   * Gets data for a native ChRIS directory.
   * Returns Result<ListingItem[]> for proper error handling.
   *
   * @param target - The path to get data for.
   * @param options - Options including directory flag and sort.
   * @returns Result<ListingItem[]>.
   */
  private async dataNative_get(target: string, options: { sort?: 'name' | 'size' | 'date' | 'owner', reverse?: boolean, directory?: boolean } = {}): Promise<Result<ListingItem[]>> {
    try {
      // Handle -d flag: show directory itself, not contents
      if (options.directory) {
        // Get parent directory and find this item in it
        const parentPath: string = target.substring(0, target.lastIndexOf('/')) || '/';
        const itemName: string = target.substring(target.lastIndexOf('/') + 1);

        // Check cache first
        const listCache = listCache_get();
        const cached = listCache.cache_get(parentPath);
        let parentItems: ListingItem[];

        if (cached) {
          parentItems = cached.data;
        } else {
          parentItems = await files_list({}, parentPath);
          listCache.cache_set(parentPath, parentItems);
        }

        const item: ListingItem | undefined = parentItems.find((i: ListingItem) => i.name === itemName);

        if (item) {
          return Ok([item]);
        } else {
          errorStack.stack_push("error", `ls: cannot access '${target}': No such file or directory`);
          return Err();
        }
      }

      // Normal listing: show directory contents
      // Check cache first
      const listCache = listCache_get();
      const cached = listCache.cache_get(target);
      let items: ListingItem[];

      if (cached) {
        items = cached.data;
      } else {
        // Cache miss - fetch from API
        items = await files_list({
          path: target,
          sort: options.sort,
          reverse: options.reverse
        }, target);

        // Inject 'bin' virtual directory if listing root
        if (target === '/' || target === '') {
          items.push({
            name: 'bin',
            type: 'vfs', // Mark as virtual file system
            size: 0,
            owner: 'root',
            date: new Date().toISOString(),
          });
          // Re-sort to ensure bin appears in correct place
          items.sort((a: ListingItem, b: ListingItem) => a.name.localeCompare(b.name));
        }

        // Cache the results
        listCache.cache_set(target, items);
      }

      return Ok(items);

    } catch (error: unknown) {
      const errorMsg: string = error instanceof Error ? error.message : String(error);
      errorStack.stack_push("error", `Failed to list ${target}: ${errorMsg}`);
      return Err();
    }
  }
}

export const vfs = new VFS();
