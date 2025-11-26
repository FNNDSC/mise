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

  private async listNative(target: string): Promise<void> {
    // Target is already absolute or relative? 
    // The caller passes what user typed? Or resolved?
    // In list(), I set effectivePath.
    // But files_list in chili expects raw path and resolves it? 
    // Wait, my fix in chili `files_list` calls `path_resolveChrisFs(pathStr, {})`.
    // `path_resolveChrisFs` uses `chrisContext.current_get` if path is relative.
    // So I can pass `target` directly if it's raw.
    
    // However, `session.getCWD()` returns absolute path.
    // If user typed nothing, I pass CWD. Absolute.
    // If user typed relative, I pass relative.
    
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
