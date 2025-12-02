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
   *
   * @param targetPath - The path to list. If empty, uses CWD.
   * @param options - Listing options (long, human, sort, reverse, directory).
   */
  async list(targetPath?: string, options: { long?: boolean, human?: boolean, sort?: 'name' | 'size' | 'date' | 'owner', reverse?: boolean, directory?: boolean } = {}): Promise<void> {
    const result: Result<ListingItem[]> = await this.data_get(targetPath, options);

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
      const listCache = listCache_get();
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
        let parentItems: ListingItem[] | null = listCache.cache_get(parentPath);
        if (!parentItems) {
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
      // Fetch from shared logic - pass sort options to command layer
      const items: ListingItem[] = await files_list({
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
      const listCache = listCache_get();
      listCache.cache_set(target, items);

      return Ok(items);

    } catch (error: unknown) {
      const errorMsg: string = error instanceof Error ? error.message : String(error);
      errorStack.stack_push("error", `Failed to list ${target}: ${errorMsg}`);
      return Err();
    }
  }
}

export const vfs = new VFS();
