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

/**
 * Virtual File System Router.
 * Dispatches operations to Virtual or Native providers.
 */
export class VFS {
  /**
   * List contents of a directory (Virtual or Native).
   * @param targetPath - The path to list. If empty, uses CWD.
   * @param options - Listing options (long, human, sort, reverse).
   */
  async list(targetPath?: string, options: { long?: boolean, human?: boolean, sort?: 'name' | 'size' | 'date' | 'owner', reverse?: boolean } = {}): Promise<void> {
    const cwd: string = await session.getCWD();
    const effectivePath: string = targetPath 
      ? path.posix.resolve(cwd, targetPath) 
      : cwd;

    if (effectivePath === '/bin') {
      await this.listVirtualBin(options);
    } else {
      await this.listNative(effectivePath, options);
    }
  }

  /**
   * Lists the contents of the virtual `/bin` directory (plugins).
   */
  private async listVirtualBin(options: { long?: boolean, human?: boolean, sort?: 'name' | 'size' | 'date' | 'owner', reverse?: boolean } = {}): Promise<void> {
    try {
      const plugins = await plugins_listAll({});
      const items: ListingItem[] = [];

      if (plugins && plugins.tableData) {
        plugins.tableData.forEach((plugin: Record<string, any>) => {
          // Format as single string: pl-name-v1.0.5
          const displayName: string = plugin.version
            ? `${plugin.name}-v${plugin.version}`
            : plugin.name;

          items.push({
            name: displayName,
            type: 'plugin',
            size: 0,
            owner: 'system',
            date: plugin.creation_date || '',
          });
        });
      }

      if (items.length === 0) {
        console.log(chalk.gray('No plugins found.'));
        return;
      }

      // Apply sorting (default to name if not specified)
      const sortField = options.sort || 'name';
      const sortedItems = list_applySort(items, sortField, options.reverse);

      // Use shared view (sorting is handled by the data layer, not view layer)
      if (options.long) {
        console.log(long_render(sortedItems, { human: !!options.human }));
      } else {
        console.log(grid_render(sortedItems));
      }

    } catch (error: unknown) {
      const msg: string = error instanceof Error ? error.message : String(error);
      console.error(chalk.red(`Failed to list plugins: ${msg}`));
    }
  }

  /**
   * Lists the contents of a native ChRIS directory.
   *
   * @param target - The path to list.
   */
  private async listNative(target: string, options: { long?: boolean, human?: boolean, sort?: 'name' | 'size' | 'date' | 'owner', reverse?: boolean }): Promise<void> {
    try {
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

      if (items.length === 0) return;

      // Use shared view (sorting is handled by the data layer, not view layer)
      if (options.long) {
        console.log(long_render(items, { human: !!options.human }));
      } else {
        console.log(grid_render(items));
      }

    } catch (error: unknown) {
      const msg: string = error instanceof Error ? error.message : String(error);
      console.error(chalk.red(`Failed to list ${target}: ${msg}`));
    }
  }
}

export const vfs = new VFS();
