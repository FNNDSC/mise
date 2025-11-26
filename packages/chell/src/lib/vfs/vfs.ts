/**
 * @file Virtual File System Router.
 *
 * Handles path resolution and dispatching to appropriate file system providers
 * (native ChRIS or virtual overlays like /bin).
 *
 * @module
 */
import { plugins_fetchList } from '@fnndsc/chili/commands/plugins/list.js';
import { files_list } from '@fnndsc/chili/commands/fs/ls.js';
import { CLIoptions } from '@fnndsc/chili/utils/cli.js';
import { ResourceItem } from '@fnndsc/chili/commands/fs/ls.js';
import { session } from '../../session/index.js';
import chalk from 'chalk';
import * as path from 'path';

/**
 * Virtual File System Router.
 * Dispatches operations to Virtual or Native providers.
 */
export class VFS {
  /**
   * List contents of a directory (Virtual or Native).
   * @param targetPath - The path to list. If empty, uses CWD.
   */
  async list(targetPath?: string): Promise<void> {
    const effectivePath = targetPath || await session.getCWD();

    if (effectivePath === '/bin') {
      await this.listVirtualBin();
    } else {
      // If path starts with /bin/..., it might be virtual file?
      // For now, only exact /bin is virtual dir.
      await this.listNative(effectivePath);
    }
  }

  /**
   * Lists the contents of the virtual `/bin` directory (plugins).
   */
  private async listVirtualBin(): Promise<void> {
    try {
      const plugins = await plugins_fetchList({});
      if (plugins && plugins.tableData) {
        plugins.tableData.forEach((plugin: any) => console.log(plugin.name));
      } else {
        console.log(chalk.gray('No plugins found.'));
      }
    } catch (error: any) {
      console.error(chalk.red(`Failed to list plugins: ${error.message}`));
    }
  }

  /**
   * Lists the contents of a native ChRIS directory.
   *
   * @param target - The path to list.
   */
  private async listNative(target: string): Promise<void> {
    // `files_list` handles resolution.
    try {
      const lsItems = await files_list({} as CLIoptions, target);
      lsItems.forEach((item: ResourceItem) => console.log(item.name));
    } catch (error: any) {
      console.error(chalk.red(`Failed to list ${target}: ${error.message}`));
    }
  }
}

export const vfs = new VFS();
