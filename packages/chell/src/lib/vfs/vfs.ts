/**
 * @file Virtual File System Router.
 *
 * Handles path resolution and dispatching to appropriate file system providers
 * (native ChRIS or virtual overlays like /bin).
 *
 * @module
 */
import { plugins_listAll, files_listAll } from '@fnndsc/salsa';
import { CLIoptions } from '@fnndsc/chili/utils/cli.js';
import { session } from '../../session/index.js';
import chalk from 'chalk';
import * as path from 'path';

/**
 * Formats bytes into human-readable string.
 */
function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

/**
 * Virtual File System Router.
 * Dispatches operations to Virtual or Native providers.
 */
export class VFS {
  /**
   * List contents of a directory (Virtual or Native).
   * @param targetPath - The path to list. If empty, uses CWD.
   * @param options - Listing options (long, human).
   */
  async list(targetPath?: string, options: { long?: boolean, human?: boolean } = {}): Promise<void> {
    const cwd = await session.getCWD();
    // If targetPath is absolute (from path_resolve), resolve handles it correctly.
    // If it's relative (unlikely from builtin_ls but possible from other callers), it resolves against cwd.
    const effectivePath = targetPath 
      ? path.posix.resolve(cwd, targetPath) 
      : cwd;

    if (effectivePath === '/bin') {
      await this.listVirtualBin(options);
    } else {
      // If path starts with /bin/..., it might be virtual file?
      // For now, only exact /bin is virtual dir.
      await this.listNative(effectivePath, options);
      
      // Inject 'bin' virtual directory if listing root
      if (effectivePath === '/' || effectivePath === '') {
        if (options.long) {
           console.log(`d ${'root'.padEnd(10)} ${'0'.padEnd(8)} ${new Date().toISOString().slice(0, 10)} ${chalk.cyan('bin')}`);
        } else {
           console.log(chalk.cyan('bin'));
        }
      }
    }
  }

  /**
   * Lists the contents of the virtual `/bin` directory (plugins).
   */
  private async listVirtualBin(options: { long?: boolean } = {}): Promise<void> {
    try {
      const plugins = await plugins_listAll({});
      
      if (plugins && plugins.tableData && plugins.tableData.length > 0) {
        plugins.tableData.forEach((plugin: any) => {
          const version = plugin.version ? ` (${plugin.version})` : '';
          if (options.long) {
             const date = plugin.creation_date ? plugin.creation_date.replace('T', ' ').slice(0, 19) : '----';
             // Type, Owner, Size, Date, Name
             // Plugins don't have file size in standard list?
             console.log(`p ${'system'.padEnd(10)} ${'-'.padEnd(8)} ${date} ${plugin.name}${version}`);
          } else {
             console.log(`${plugin.name}${version}`);
          }
        });
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
  private async listNative(target: string, options: { long?: boolean, human?: boolean }): Promise<void> {
    try {
      const opts = { limit: 100, offset: 0 }; // listAll handles loops, but we pass starting options
      
      const [dirs, files, links] = await Promise.all([
        files_listAll(opts, 'dirs', target),
        files_listAll(opts, 'files', target),
        files_listAll(opts, 'links', target)
      ]);

      const items: any[] = [];

      if (dirs && dirs.tableData) {
        dirs.tableData.forEach(d => items.push({ ...d, type: 'd' }));
      }
      if (files && files.tableData) {
        files.tableData.forEach(f => items.push({ ...f, type: 'f' }));
      }
      if (links && links.tableData) {
        links.tableData.forEach(l => items.push({ ...l, type: 'l' }));
      }

      items.sort((a, b) => {
         const nameA = a.fname || a.path || '';
         const nameB = b.fname || b.path || '';
         return nameA.localeCompare(nameB);
      });

      items.forEach(item => {
         let name = item.fname || item.path || '';
         const rawPath = item.path; // Preserve raw path for link target
         
         // Extract basename
         if (name.includes('/')) name = name.split('/').pop();
         
         let colorizedName = name;
         if (item.type === 'd') colorizedName = chalk.blueBright(name);
         else if (item.type === 'l') colorizedName = chalk.cyanBright(name);
         
         if (options.long) {
            const type = item.type;
            const owner = (item.owner_username || 'unknown').padEnd(10);
            let size = item.fsize || 0;
            
            if (options.human) {
               size = formatSize(size).padEnd(8);
            } else {
               size = size.toString().padEnd(8);
            }
            
            const date = item.creation_date ? item.creation_date.replace('T', ' ').slice(0, 19) : '-------------------';
            
            let output = `${type} ${owner} ${size} ${date} ${colorizedName}`;
            
            if (type === 'l' && rawPath) {
                output += ` -> ${rawPath}`;
            }
            
            console.log(output);
         } else {
            console.log(colorizedName);
         }
      });

    } catch (error: any) {
      console.error(chalk.red(`Failed to list ${target}: ${error.message}`));
    }
  }
}

export const vfs = new VFS();
