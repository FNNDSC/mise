/**
 * @file Built-in Shell Commands.
 *
 * Implements core shell commands like cd, ls, pwd, connect, logout.
 *
 * @module
 */
import { session } from '../session/index.js';
import { vfs } from '../lib/vfs/vfs.js';
import { listCache_get, errorStack } from '@fnndsc/cumin';
import { files_mkdir as chefs_mkdir_cmd } from '@fnndsc/chili/commands/fs/mkdir.js';
import { files_touch as chefs_touch_cmd, TouchOptions } from '@fnndsc/chili/commands/fs/touch.js';
import { files_uploadWithProgress as chefs_upload_cmd, UploadSummary, bytes_format } from '@fnndsc/chili/commands/fs/upload.js';
import { files_cat as chefs_cat_cmd } from '@fnndsc/chili/commands/fs/cat.js';
import { files_rm as chefs_rm_cmd, RmResult, RmOptions } from '@fnndsc/chili/commands/fs/rm.js';
import { files_cp as chefs_cp_cmd, CpOptions } from '@fnndsc/chili/commands/fs/cp.js';
import { files_mv as chefs_mv_cmd } from '@fnndsc/chili/commands/fs/mv.js';
import { connect_login } from '@fnndsc/chili/commands/connect/login.js';
import { connect_logout } from '@fnndsc/chili/commands/connect/logout.js';
import { mkdir_render, touch_render, upload_render, cat_render, rm_render, cp_render, mv_render } from '@fnndsc/chili/views/fs.js';
import { login_render, logout_render } from '@fnndsc/chili/views/connect.js';
import { plugins_fetchList, PluginListResult } from '@fnndsc/chili/commands/plugins/list.js';
import { plugin_execute } from '@fnndsc/chili/commands/plugin/run.js';
import { pluginList_render, pluginRun_render } from '@fnndsc/chili/views/plugin.js';
import { Plugin, PluginInstance } from '@fnndsc/chili/models/plugin.js';
import { feeds_fetchList } from '@fnndsc/chili/commands/feeds/list.js';
import { feed_create } from '@fnndsc/chili/commands/feed/create.js';
import { feedList_render, feedCreate_render } from '@fnndsc/chili/views/feed.js';
import { Feed } from '@fnndsc/chili/models/feed.js';
import { FeedListResult } from '@fnndsc/chili/commands/feeds/list.js';
import { files_fetchList } from '@fnndsc/chili/commands/files/list.js';
import { fileFields_fetch } from '@fnndsc/chili/commands/files/fields.js';
import { table_display } from '@fnndsc/chili/screen/screen.js';
import { FilteredResourceData, SingleContext } from '@fnndsc/cumin';
import { context_getSingle } from '@fnndsc/salsa';
import { ListingItem } from '@fnndsc/chili/models/listing.js';
import chalk from 'chalk';
import { commandArgs_process, ParsedArgs, path_resolve_pure } from './utils.js';
import { chiliCommand_run } from '../chell.js';
import * as readline from 'readline';
import { builtin_parametersofplugin } from './parametersofplugin.js';
import { builtin_help } from './help.js';
import { builtin_debug } from './debug.js';
import { spinner } from '../lib/spinner.js';
import path from 'path';
import { scan_do, archyTree_create, type CLIscan, type ScanRecord } from '@fnndsc/chili/path/pathCommand.js';

export {
  builtin_cd,
  builtin_pwd,
  builtin_ls,
  builtin_cp,
  builtin_upload,
  builtin_connect,
  builtin_logout,
  builtin_chefs,
  builtin_cat,
  builtin_rm,
  builtin_mv,
  builtin_touch,
  builtin_mkdir,
  builtin_plugin,
  builtin_feed,
  builtin_files,
  builtin_links,
  builtin_dirs,
  builtin_context,
  builtin_parametersofplugin,
  builtin_physicalmode,
  builtin_timing,
  builtin_debug,
  builtin_help,
  builtin_tree,
  builtin_du,
};
export type { ParsedArgs };

/**
 * Prompts the user for confirmation.
 *
 * @param message - The prompt message.
 * @returns A Promise resolving to true if user confirms (y/Y), false otherwise.
 */
async function prompt_confirm(message: string): Promise<boolean> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    rl.question(message, (answer: string) => {
      rl.close();
      const confirmed: boolean = answer.trim().toLowerCase() === 'y';
      resolve(confirmed);
    });
  });
}

/**
 * Resolves a path argument, handling `~` expansion and relative paths.
 * @param inputPath - The path to resolve.
 * @returns The absolute path.
 */
export async function path_resolve(inputPath: string): Promise<string> {
  const context = context_getSingle();
  const user: string | null = context.user;
  const cwd: string = await session.getCWD();
  return path_resolve_pure(inputPath, { user, cwd });
}

/**
 * Resolves links in a path without using PathMapper (for physical mode).
 * Checks each component to see if it's a link and follows it.
 *
 * @param targetPath - The path to resolve.
 * @returns The resolved path with links followed.
 */
async function path_resolveLinks(targetPath: string): Promise<string> {
  const { files_list } = await import('@fnndsc/chili/commands/fs/ls.js');

  const components: string[] = targetPath.split('/').filter(c => c);
  let currentPath: string = '';

  for (const component of components) {
    const parentPath: string = currentPath || '/';
    currentPath = `${currentPath}/${component}`;

    try {
      // List parent directory to check if component is a link
      const items: ListingItem[] = await files_list({ path: parentPath }, parentPath);

      // Find the component in the listing
      const item = items.find((i: ListingItem) => i.name === component);

      if (item && item.type === 'link' && item.target) {
        // Component is a link - resolve it
        if (item.target.startsWith('/')) {
          // Absolute link target
          currentPath = item.target;
        } else {
          // Relative link target
          currentPath = `${parentPath}/${item.target}`.replace('//', '/');
        }
      }
    } catch (error) {
      // If we can't list the directory, continue with the current path
      continue;
    }
  }

  return currentPath || '/';
}

/**
 * Changes the current working directory in the ChRIS filesystem context.
 * Validates the existence of the target path before setting it.
 *
 * @param args - An array containing the target path as the first element.
 * @returns A Promise that resolves when the operation is complete.
 */
async function builtin_cd(args: string[]): Promise<void> {
  const pathArg: string | undefined = args.length > 0 ? args.join(' ') : undefined;
  
  // 'cd' with no args goes to home
  if (!pathArg) {
    const user: string | null = await session.connection.user_get();
    // Reuse logic by pretending arg is '~'
    return builtin_cd(['~']);
  }

  try {
    const logicalPath: string = await path_resolve(pathArg);

    // Handle virtual directories
    if (logicalPath === '/bin') {
      await session.setCWD('/bin');
      return;
    }

    const client = await session.connection.client_get();
    if (!client) {
      console.error(chalk.red('Not connected to ChRIS.'));
      return;
    }

    // Determine path for validation
    let validationPath: string;

    if (session.physicalMode_get()) {
      // Physical mode: resolve links but don't use PathMapper
      validationPath = await path_resolveLinks(logicalPath);
    } else {
      // Logical mode: resolve logical path to physical path for validation
      const { logical_toPhysical } = await import('@fnndsc/chili/utils');
      const physicalResult = await logical_toPhysical(logicalPath);

      if (!physicalResult.ok) {
        console.error(chalk.red(`cd: ${pathArg}: Invalid path`));
        return;
      }

      validationPath = physicalResult.value;
    }

    try {
      // Validate that the target exists
      const folder: unknown = await client.getFileBrowserFolderByPath(validationPath);
      if (folder) {
        // Set CWD based on mode:
        // - Logical mode: preserves *nix behavior where cd into a symlink keeps the logical path
        // - Physical mode: uses the resolved physical path (follows links)
        const cwdPath: string = session.physicalMode_get() ? validationPath : logicalPath;
        await session.setCWD(cwdPath);
      } else {
        console.error(chalk.red(`cd: ${pathArg}: No such file or directory`));
      }
    } catch (apiError: unknown) {
      console.error(chalk.red(`cd: ${pathArg}: No such file or directory`));
    }

  } catch (error: unknown) {
    const msg: string = error instanceof Error ? error.message : String(error);
    console.error(chalk.red(`Failed to cd: ${msg}`));
  }
}

/**
 * Prints the current working directory in the ChRIS filesystem context.
 *
 * @returns A Promise that resolves when the directory is printed.
 */
async function builtin_pwd(): Promise<void> {
  console.log(await session.getCWD());
}

/**
 * Lists the contents of the current or specified directory/files in the ChRIS filesystem context.
 * Supports a virtual `/bin` directory for plugins and multiple paths (e.g., from wildcard expansion).
 *
 * @param args - An array containing target paths (optional).
 * @returns A Promise that resolves when the directory contents are listed.
 */
async function builtin_ls(args: string[]): Promise<void> {
  const parsed: ParsedArgs = commandArgs_process(args);
  const pathArgsRaw: string[] = parsed._ as string[];

  // Parse sort option
  let sortBy: 'name' | 'size' | 'date' | 'owner' = 'name';
  if (parsed['sort']) {
    const sortValue = String(parsed['sort']);
    if (['name', 'size', 'date', 'owner'].includes(sortValue)) {
      sortBy = sortValue as 'name' | 'size' | 'date' | 'owner';
    }
  }

  let pathArgs: string[] = pathArgsRaw;

  // Check for refresh flag to invalidate cache
  const shouldRefresh = !!parsed['refresh'] || !!parsed['f'];

  const options: {
    long: boolean;
    human: boolean;
    sort: 'name' | 'size' | 'date' | 'owner';
    reverse: boolean;
    directory: boolean;
  } = {
    long: !!parsed['l'],
    human: !!parsed['h'],
    sort: sortBy,
    reverse: !!parsed['reverse'] || !!parsed['r'],
    directory: !!parsed['d']
  };

  // If user provided multiple tokens without options or wildcards, try treating them as a single path first.
  const hasOptions: boolean = Object.keys(parsed).some((key: string) => key !== '_');
  const hasWildcard: boolean = pathArgsRaw.some((p: string) => p.includes('*'));
  if (!hasOptions && !hasWildcard && pathArgsRaw.length > 1 && typeof (vfs as any).data_get === 'function') {
    const joinedPath: string = pathArgsRaw.join(' ');
    const probe = await vfs.data_get(joinedPath, {
      sort: sortBy,
      reverse: options.reverse,
      directory: options.directory
    });
    if (probe.ok) {
      await vfs.list(joinedPath, options);
      return;
    } else {
      // Suppress the probe error to avoid leaking to the user when we fallback
      errorStack.stack_pop();
    }
  }

  // If refresh flag is set, aggressively invalidate cache for the target path(s)
  if (shouldRefresh) {
    const listCache = listCache_get();
    if (pathArgs.length === 0) {
      const cwd = await session.getCWD();
      console.log(chalk.gray(`[Cache] Invalidating: ${cwd}`));
      listCache.cache_invalidate(cwd);
      // Also clear entire cache to be extra sure
      listCache.cache_invalidate();
    } else {
      for (const pathArg of pathArgs) {
        const resolvedPath = await path_resolve(pathArg);
        console.log(chalk.gray(`[Cache] Invalidating: ${resolvedPath}`));
        listCache.cache_invalidate(resolvedPath);
      }
      // Also clear entire cache when using -f on specific paths
      listCache.cache_invalidate();
    }
  }

  // If no paths specified, list current directory
  if (pathArgs.length === 0) {
    await vfs.list(undefined, options);
    return;
  }

  // If single path, list it directly (could be file or directory)
  if (pathArgs.length === 1) {
    const target: string = await path_resolve(pathArgs[0]);
    await vfs.list(target, options);
    return;
  }

  // Multiple paths - likely from wildcard expansion
  // List them as individual files (not directory contents)
  // This matches Unix behavior: ls *.txt shows the files themselves
  if (options.long) {
    // For -l, we'd need to fetch file metadata
    // For now, just show paths (can enhance later)
    for (const pathArg of pathArgs) {
      const target: string = await path_resolve(pathArg);
      console.log(target);
    }
  } else {
    // Grid format - just show basenames
    const basenames: string[] = pathArgs.map((p: string) => {
      const parts: string[] = p.split('/');
      return parts[parts.length - 1] || p;
    });
    console.log(basenames.join('  '));
  }
}

/**
 * Copies a file or directory.
 * Supports multiple sources when destination is a directory.
 *
 * @param args - [flags, src1, src2, ..., dest]
 */
async function builtin_cp(args: string[]): Promise<void> {
  const parsed = commandArgs_process(args);
  const pathArgs = parsed._ as string[];

  if (pathArgs.length < 2) {
    console.log(chalk.red('Usage: cp [-r] <source...> <dest>'));
    return;
  }

  const recursive: boolean = !!parsed['r'] || !!parsed['recursive'];

  // Last arg is destination, all others are sources
  const dest: string = pathArgs[pathArgs.length - 1];
  const sources: string[] = pathArgs.slice(0, -1);

  const destPath: string = await path_resolve(dest);
  const listCache = listCache_get();
  let successCount: number = 0;
  let failCount: number = 0;

  for (const src of sources) {
    try {
      const srcPath: string = await path_resolve(src);

      // For multiple sources, show which file we're copying
      if (sources.length > 1) {
        console.log(chalk.gray(`Copying ${srcPath}...`));
      } else {
        console.log(`Copying ${srcPath} to ${destPath}...`);
      }

      const success: boolean = await chefs_cp_cmd(srcPath, destPath, { recursive });

      if (sources.length === 1) {
        console.log(cp_render(srcPath, destPath, success));
      }

      if (success) {
        successCount++;
      } else {
        failCount++;
      }
    } catch (e: unknown) {
      const msg: string = e instanceof Error ? e.message : String(e);
      console.error(chalk.red(`cp: ${src}: ${msg}`));
      failCount++;
    }
  }

  // Invalidate destination directory (always, since files copied into it)
  listCache.cache_invalidate(destPath);
  const destParent: string = path.posix.dirname(destPath);
  listCache.cache_invalidate(destParent);

  // Summary for multiple files
  if (sources.length > 1) {
    if (failCount === 0) {
      console.log(chalk.green(`✓ Copied ${successCount} file(s) to ${destPath}`));
    } else {
      console.log(chalk.yellow(`⚠ Copied ${successCount} file(s), ${failCount} failed`));
    }
  }
}

/**
 * Moves or renames a file or directory.
 * Supports multiple sources when destination is a directory.
 *
 * @param args - [src1, src2, ..., dest] or [src, dest]
 */
async function builtin_mv(args: string[]): Promise<void> {
  const parsed = commandArgs_process(args);
  const pathArgs = parsed._ as string[];

  if (pathArgs.length < 2) {
    console.log(chalk.red('Usage: mv <source...> <dest>'));
    return;
  }

  // Last arg is destination, all others are sources
  const dest: string = pathArgs[pathArgs.length - 1];
  const sources: string[] = pathArgs.slice(0, -1);

  const destPath: string = await path_resolve(dest);
  const listCache = listCache_get();
  let successCount: number = 0;
  let failCount: number = 0;

  for (const src of sources) {
    try {
      const srcPath: string = await path_resolve(src);

      // For multiple sources, show which file we're moving
      if (sources.length > 1) {
        console.log(chalk.gray(`Moving ${srcPath}...`));
      } else {
        console.log(`Moving ${srcPath} to ${destPath}...`);
      }

      const success: boolean = await chefs_mv_cmd(srcPath, destPath);

      if (sources.length === 1) {
        console.log(mv_render(srcPath, destPath, success));
      }

      if (success) {
        successCount++;
        // Invalidate source directory
        const srcDir: string = path.posix.dirname(srcPath);
        listCache.cache_invalidate(srcDir);
      } else {
        failCount++;
      }
    } catch (e: unknown) {
      const msg: string = e instanceof Error ? e.message : String(e);
      console.error(chalk.red(`mv: ${src}: ${msg}`));
      failCount++;
    }
  }

  // Invalidate destination directory (always, since files moved into it)
  listCache.cache_invalidate(destPath);
  const destParent: string = path.posix.dirname(destPath);
  listCache.cache_invalidate(destParent);

  // Summary for multiple files
  if (sources.length > 1) {
    if (failCount === 0) {
      console.log(chalk.green(`✓ Moved ${successCount} file(s) to ${destPath}`));
    } else {
      console.log(chalk.yellow(`⚠ Moved ${successCount} file(s), ${failCount} failed`));
    }
  }
}

/**
 * Uploads a local file or directory to ChRIS.
 *
 * @param args - [localPath, remotePath]
 */
async function builtin_upload(args: string[]): Promise<void> {
  if (args.length < 2) {
    console.log(chalk.red('Usage: upload <local_path> <remote_path>'));
    return;
  }
  const localPath: string = args[0];
  const remotePath: string = args[1];

  const targetRemote: string = await path_resolve(remotePath);

  try {
    const summary: UploadSummary = await chefs_upload_cmd(localPath, targetRemote);

    console.log('');
    if (summary.failedCount === 0) {
      console.log(chalk.green(`✓ Successfully uploaded ${summary.transferredCount} file(s)`));
    } else {
      console.log(chalk.yellow(`⚠ Uploaded ${summary.transferredCount} file(s), ${summary.failedCount} failed`));
    }
    console.log(chalk.gray(`  Total: ${bytes_format(summary.transferSize)} in ${summary.duration.toFixed(1)}s (${bytes_format(summary.speed)}/s)`));

    // Invalidate cache for actual target directory where files were uploaded
    if (summary.transferredCount > 0) {
      const listCache = listCache_get();
      listCache.cache_invalidate(summary.actualTargetPath);
      // Also invalidate parent to refresh its listing
      listCache.cache_invalidate(targetRemote);
    }
  } catch (e: unknown) {
    const msg: string = e instanceof Error ? e.message : String(e);
    console.error(chalk.red(`Upload error: ${msg}`));
  }
}

/**
 * Connects to a ChRIS CUBE instance using provided credentials.
 *
 * @param args - An array of arguments containing user, password, and URL.
 * @returns A Promise that resolves when the connection attempt is complete.
 */
async function builtin_connect(args: string[]): Promise<void> {
  const parsed: ParsedArgs = commandArgs_process(args);
  const user: string = parsed.user as string;
  const password: string = parsed.password as string;
  const url: string = parsed._[0] as string;

  if (user && password && url) {
    try {
      const success: boolean = await connect_login({ user, password, url, debug: false });
      if (success) {
        session.offline = false;
      }
      console.log(login_render(success, url, user));
    } catch (error: unknown) {
      const msg: string = error instanceof Error ? error.message : String(error);
      console.log(login_render(false, url, user));
      console.error(chalk.red(`Connection failed: ${msg}`));
    }
  } else {
    console.log(chalk.red('Usage: connect --user <username> --password <password> <url>'));
  }
}

/**
 * Logs out from the current ChRIS CUBE session.
 *
 * @returns A Promise that resolves when the logout operation is complete.
 */
async function builtin_logout(): Promise<void> {
  try {
    await connect_logout();
    console.log(logout_render(true));
  } catch (error: unknown) {
    console.log(logout_render(false));
    const msg: string = error instanceof Error ? error.message : String(error);
    console.error(chalk.red(`Logout failed: ${msg}`));
  }
}

/**
 * Handles plugin commands.
 *
 * @param args - command arguments.
 */
async function builtin_plugin(args: string[]): Promise<void> {
  const parsed: ParsedArgs = commandArgs_process(args);
  const subcommand = parsed._[0];
  
  if (!subcommand) {
     console.log(chalk.red("Usage: plugin <list|run> ..."));
     return;
  }

  try {
    if (subcommand === 'list') {
       const { plugins, selectedFields } = await plugins_fetchList(parsed as any);
       console.log(pluginList_render(plugins, selectedFields, { table: !!parsed.table, csv: !!parsed.csv }));
    } else if (subcommand === 'run') {
       const searchable = parsed._[1];
       if (!searchable) {
          console.log(chalk.red("Usage: plugin run <plugin> [args...]"));
          return;
       }
       const params = args.slice(2).join(' ');
       const instance: PluginInstance | null = await plugin_execute(searchable, params);
       if (instance) {
          console.log(pluginRun_render(instance));
       } else {
          console.error(chalk.red("Plugin execution failed."));
       }
    } else {
       console.log(chalk.yellow('Directive not handled by chell... spawning chili directly'));
       await chiliCommand_run('plugins', ['-s', ...args]);
    }
  } catch (e: unknown) {
    const msg: string = e instanceof Error ? e.message : String(e);
    console.error(chalk.red(`Plugin error: ${msg}`));
  }
}

/**
 * Handles feed commands.
 *
 * @param args - command arguments.
 */
async function builtin_feed(args: string[]): Promise<void> {
  const parsed: ParsedArgs = commandArgs_process(args);
  const subcommand = parsed._[0];
  
  if (!subcommand) {
     console.log(chalk.red("Usage: feed <list|create> ..."));
     return;
  }

  try {
    if (subcommand === 'list') {
       const { feeds, selectedFields }: FeedListResult = await feeds_fetchList(parsed as any);
       console.log(feedList_render(feeds, selectedFields, { table: !!parsed.table, csv: !!parsed.csv }));
    } else if (subcommand === 'create') {
       // Requires --dirs and --params flag handling which parsed already has.
       // feed create --dirs ...
       const feed: Feed | null = await feed_create(parsed as any);
       if (feed) {
          console.log(feedCreate_render(feed));
       }
    } else {
       console.log(chalk.yellow('Directive not handled by chell... spawning chili directly'));
       await chiliCommand_run('feeds', ['-s', ...args]);
    }
  } catch (e: unknown) {
    const msg: string = e instanceof Error ? e.message : String(e);
    console.error(chalk.red(`Feed error: ${msg}`));
  }
}

/**
 * Generic handler for file group commands (files, links, dirs).
 *
 * @param args - command arguments.
 * @param assetName - the asset type ('files', 'links', 'dirs').
 */
async function builtin_fileGroup(args: string[], assetName: string): Promise<void> {
  const parsed: ParsedArgs = commandArgs_process(args);
  const subcommand = parsed._[0];

  if (!subcommand) {
     console.log(chalk.red(`Usage: ${assetName} <list|fieldslist|delete|share> ...`));
     return;
  }

  try {
    if (subcommand === 'list') {
       const path = parsed._[1] as string | undefined;
       const results: FilteredResourceData | null = await files_fetchList(parsed as any, assetName, path);

       if (!results) {
          console.error(`No ${assetName} resources found. Perhaps check your current context?`);
          return;
       }

       if (results.tableData.length === 0) {
          console.log(`No ${assetName} found matching the criteria.`);
       } else {
          table_display(
             results.tableData,
             results.selectedFields,
             { title: { title: assetName, justification: "center" } }
          );
       }
    } else if (subcommand === 'fieldslist') {
       const fields: string[] | null = await fileFields_fetch(assetName);
       if (fields && fields.length > 0) {
          table_display(fields.map(f => ({ fields: f })), ["fields"]);
       } else {
          console.log(`No resource fields found for ${assetName}.`);
       }
    } else {
       console.log(chalk.yellow('Directive not handled by chell... spawning chili directly'));
       await chiliCommand_run(assetName, ['-s', ...args]);
    }
  } catch (e: unknown) {
    const msg: string = e instanceof Error ? e.message : String(e);
    console.error(chalk.red(`${assetName} error: ${msg}`));
  }
}

/**
 * Handles files commands.
 *
 * @param args - command arguments.
 */
async function builtin_files(args: string[]): Promise<void> {
  await builtin_fileGroup(args, 'files');
}

/**
 * Handles links commands.
 *
 * @param args - command arguments.
 */
async function builtin_links(args: string[]): Promise<void> {
  await builtin_fileGroup(args, 'links');
}

/**
 * Handles dirs commands.
 *
 * @param args - command arguments.
 */
async function builtin_dirs(args: string[]): Promise<void> {
  await builtin_fileGroup(args, 'dirs');
}

/**
 * Handles `chefs` subcommands, providing a legacy wrapper for ChRIS Experimental File System primitives.
 *
 * @param args - An array containing the subcommand and its arguments.
 * @returns A Promise that resolves when the `chefs` command processing is complete.
 */
async function builtin_chefs(args: string[]): Promise<void> {
  const [subcommand, ...subArgs]: string[] = args;
  const currentChrisFolder: string = await session.getCWD();

  try {
    switch (subcommand) {
      case 'pwd':
        console.log(currentChrisFolder);
        break;
      case 'ls':
        await builtin_ls(subArgs);
        break;
      case 'mkdir':
        if (subArgs[0]) {
          const targetPath: string = subArgs[0].startsWith('/')
            ? subArgs[0]
            : await path_resolve(subArgs[0]);
          const success: boolean = await chefs_mkdir_cmd(targetPath);
          console.log(mkdir_render(targetPath, success));

          // Invalidate cache for parent directory
          if (success) {
            const listCache = listCache_get();
            const parentDir: string = path.posix.dirname(targetPath);
            listCache.cache_invalidate(parentDir);
          }
        } else {
          console.log(chalk.red('Usage: chefs mkdir <path>'));
        }
        break;
      case 'touch': {
        const parsed = commandArgs_process(subArgs);
        const pathArgs = parsed._ as string[];

        if (pathArgs.length === 0) {
          console.log(chalk.red('Usage: chefs touch [--withContents <string>] [--withContentsFromFile <file>] <path>'));
          break;
        }

        const targetPath: string = pathArgs[0].startsWith('/')
          ? pathArgs[0]
          : await path_resolve(pathArgs[0]);

        const options: TouchOptions = {};
        if (parsed['withContents']) {
          options.withContents = String(parsed['withContents']);
        }
        if (parsed['withContentsFromFile']) {
          options.withContentsFromFile = String(parsed['withContentsFromFile']);
        }

        const success: boolean = Object.keys(options).length > 0
          ? await chefs_touch_cmd(targetPath, options)
          : await chefs_touch_cmd(targetPath);

        if (success) {
          console.log(touch_render(targetPath, success));

          // Invalidate cache for parent directory
          const listCache = listCache_get();
          const parentDir: string = path.posix.dirname(targetPath);
          listCache.cache_invalidate(parentDir);
        } else {
          // Touch failed, display error from errorStack
          const lastError = errorStack.stack_pop();
          if (lastError) {
            console.error(chalk.red(`Failed to create file: ${targetPath}`));
            console.error(chalk.gray(`  ${lastError.message}`));
          } else {
            console.error(chalk.red(`Failed to create file: ${targetPath}`));
          }
        }
        break;
      }
      case 'upload':
        await builtin_upload(subArgs);
        break;
      default:
        console.log(chalk.red(`Unknown chefs subcommand: ${subcommand}`));
        break;
    }
  } catch (error: unknown) {
    const msg: string = error instanceof Error ? error.message : String(error);
    console.error(chalk.red(`Chefs command failed: ${msg}`));
  }
}

/**
 * Creates empty files or updates timestamps.
 *
 * @param args - Command line arguments (file paths).
 */
async function builtin_touch(args: string[]): Promise<void> {
  const parsed = commandArgs_process(args);
  const pathArgs = parsed._ as string[];

  if (pathArgs.length === 0) {
    console.error(chalk.red('Usage: touch [--withContents <string>] [--withContentsFromFile <file>] <file>'));
    return;
  }

  // Build options from parsed flags
  const options: TouchOptions = {};
  if (parsed['withContents']) {
    options.withContents = String(parsed['withContents']);
  }
  if (parsed['withContentsFromFile']) {
    options.withContentsFromFile = String(parsed['withContentsFromFile']);
  }

  // Only process the first file argument when using content options
  const filesToTouch: string[] = (options.withContents || options.withContentsFromFile)
    ? [pathArgs[0]]  // Only one file when injecting content
    : pathArgs;      // Multiple files allowed for empty touch

  for (const pathArg of filesToTouch) {
    try {
      const targetPath: string = await path_resolve(pathArg);
      const success: boolean = await chefs_touch_cmd(targetPath, options);

      if (success) {
        console.log(touch_render(targetPath, success));

        // Invalidate cache for parent directory
        const listCache = listCache_get();
        const parentDir: string = path.posix.dirname(targetPath);
        listCache.cache_invalidate(parentDir);
      } else {
        // Touch failed, display error from errorStack
        const lastError = errorStack.stack_pop();
        if (lastError) {
          console.error(chalk.red(`Failed to create file: ${targetPath}`));
          console.error(chalk.gray(`  ${lastError.message}`));
        } else {
          console.error(chalk.red(`Failed to create file: ${targetPath}`));
        }
      }
    } catch (e: unknown) {
      const msg: string = e instanceof Error ? e.message : String(e);
      console.error(chalk.red(`touch: ${pathArg}: ${msg}`));
    }
  }
}

/**
 * Creates directories.
 *
 * @param args - Command line arguments (directory paths).
 */
async function builtin_mkdir(args: string[]): Promise<void> {
  if (args.length === 0) {
    console.error(chalk.red('Usage: mkdir <directory> [directory...]'));
    return;
  }

  for (const pathArg of args) {
    try {
      const targetPath: string = await path_resolve(pathArg);
      const success: boolean = await chefs_mkdir_cmd(targetPath);
      console.log(mkdir_render(targetPath, success));

      // Invalidate cache for parent directory
      if (success) {
        const parentDir: string = targetPath.substring(0, targetPath.lastIndexOf('/')) || '/';
        const listCache = listCache_get();
        listCache.cache_invalidate(parentDir);
      }
    } catch (e: unknown) {
      const msg: string = e instanceof Error ? e.message : String(e);
      console.error(chalk.red(`mkdir: ${pathArg}: ${msg}`));
    }
  }
}

/**
 * Displays the content of a file.
 *
 * @param args - Command line arguments (file path).
 */
async function builtin_cat(args: string[]): Promise<void> {
  const pathArg: string | undefined = args[0];
  if (!pathArg) {
     console.error(chalk.red('Usage: cat <file>'));
     return;
  }

  const target: string = await path_resolve(pathArg);

  if (target.startsWith('/bin/')) {
     console.error(chalk.red('Cannot cat plugins yet.'));
     return;
  }

  try {
     const content: string | null = await chefs_cat_cmd(target);
     console.log(cat_render(content, pathArg));
  } catch (e: unknown) {
     const msg: string = e instanceof Error ? e.message : String(e);
     console.error(chalk.red(`cat: ${msg}`));
  }
}

/**
 * Removes one or more files or directories.
 *
 * @param args - Command line arguments (flags and paths).
 */
async function builtin_rm(args: string[]): Promise<void> {
  // Parse flags and paths
  let recursive: boolean = false;
  let force: boolean = false;
  let interactive: boolean = false;
  const pathArgs: string[] = [];
  let endOfOptions: boolean = false;

  for (const arg of args) {
    // Handle -- (end of options)
    if (arg === '--') {
      endOfOptions = true;
      continue;
    }

    // After --, everything is a path
    if (endOfOptions) {
      pathArgs.push(arg);
      continue;
    }

    // Parse flags
    if (arg === '-r' || arg === '-R') {
      recursive = true;
    } else if (arg === '-f') {
      force = true;
    } else if (arg === '-i') {
      interactive = true;
    } else if (arg === '-rf' || arg === '-fr' || arg === '-Rf' || arg === '-fR') {
      recursive = true;
      force = true;
    } else if (arg === '-ri' || arg === '-ir' || arg === '-Ri' || arg === '-iR') {
      recursive = true;
      interactive = true;
    } else if (arg === '-fi' || arg === '-if') {
      force = true;
      interactive = true;
    } else if (arg === '-rfi' || arg === '-rif' || arg === '-fri' || arg === '-fir' || arg === '-irf' || arg === '-ifr') {
      recursive = true;
      force = true;
      interactive = true;
    } else if (!arg.startsWith('-')) {
      pathArgs.push(arg);
    }
  }

  if (pathArgs.length === 0) {
    console.error(chalk.red('Usage: rm [-rf] <path> [path...]'));
    return;
  }

  const options: RmOptions = { recursive, force };
  let successCount: number = 0;
  let failCount: number = 0;

  // Process each path
  for (const pathArg of pathArgs) {
    try {
      const target: string = await path_resolve(pathArg);

      if (target.startsWith('/bin/')) {
        console.error(chalk.red(`rm: cannot remove '${pathArg}': virtual /bin directory`));
        failCount++;
        continue;
      }

      // Interactive prompt
      if (interactive) {
        const confirmed: boolean = await prompt_confirm(`rm: remove '${pathArg}'? (y/n): `);
        if (!confirmed) {
          console.log(chalk.gray(`skipped '${pathArg}'`));
          continue; // Skip this file
        }
      }

      const result: RmResult = await chefs_rm_cmd(target, options);

      if (result.success) {
        // Show success for each file when multiple files
        if (pathArgs.length > 1) {
          console.log(chalk.gray(`removed '${pathArg}'`));
        } else {
          console.log(rm_render(result));
        }
        successCount++;

        // Invalidate cache for parent directory
        const listCache = listCache_get();
        const parentDir: string = path.posix.dirname(target);
        listCache.cache_invalidate(parentDir);
      } else {
        // Always show errors
        console.error(chalk.red(`rm: cannot remove '${pathArg}': ${result.error || 'unknown error'}`));
        failCount++;
      }
    } catch (e: unknown) {
      const msg: string = e instanceof Error ? e.message : String(e);
      console.error(chalk.red(`rm: cannot remove '${pathArg}': ${msg}`));
      failCount++;
    }
  }

  // Print summary only if multiple files
  if (pathArgs.length > 1 && (successCount > 0 || failCount > 0)) {
    console.log('');
    if (successCount > 0 && failCount === 0) {
      console.log(chalk.green(`Successfully removed ${successCount} item${successCount !== 1 ? 's' : ''}`));
    } else if (successCount > 0 && failCount > 0) {
      console.log(chalk.yellow(`Removed ${successCount} item${successCount !== 1 ? 's' : ''}, failed ${failCount}`));
    } else if (failCount > 0) {
      console.log(chalk.red(`Failed to remove ${failCount} item${failCount !== 1 ? 's' : ''}`));
    }
  }
}

/**
 * Displays the current ChRIS context.
 *
 * @param args - Command line arguments (optional flags).
 */
async function builtin_context(args: string[]): Promise<void> {
  const context: SingleContext = context_getSingle();

  const tableData = [
    {
      Context: 'ChRIS User',
      Value: context.user || chalk.gray('Not set'),
    },
    {
      Context: 'ChRIS URL',
      Value: context.URL || chalk.gray('Not set'),
    },
    {
      Context: 'ChRIS Folder',
      Value: context.folder || chalk.gray('Not set'),
    },
    {
      Context: 'ChRIS Feed',
      Value: context.feed || chalk.gray('Not set'),
    },
    {
      Context: 'ChRIS Plugin',
      Value: context.plugin || chalk.gray('Not set'),
    },
    {
      Context: 'Physical Mode',
      Value: session.physicalMode_get() ? chalk.magenta('Enabled') : chalk.gray('Disabled'),
    },
  ];

  table_display(
    tableData,
    ['Context', 'Value'],
    {
      title: { title: 'ChRIS Context', justification: 'center' },
    }
  );
}

/**
 * Toggles or displays physical filesystem mode.
 *
 * @param args - Command line arguments: 'on', 'off', or empty to display status.
 */
async function builtin_physicalmode(args: string[]): Promise<void> {
  const subcommand: string | undefined = args[0];

  if (!subcommand) {
    // Display current status
    const status: string = session.physicalMode_get() ? 'enabled' : 'disabled';
    console.log(`Physical filesystem mode: ${chalk.yellow(status)}`);
    if (session.physicalMode_get()) {
      console.log(chalk.gray('  Paths are used directly without logical-to-physical mapping.'));
    } else {
      console.log(chalk.gray('  Paths are resolved through logical-to-physical mapping.'));
    }
    console.log(chalk.gray('\nUsage: physicalmode [on|off]'));
    return;
  }

  if (subcommand === 'on') {
    session.physicalMode_set(true);
    console.log(chalk.yellow('[!] Physical filesystem mode enabled'));
    console.log(chalk.gray('    Paths will be used directly without logical-to-physical mapping.'));
  } else if (subcommand === 'off') {
    session.physicalMode_set(false);
    console.log(chalk.green('[+] Physical filesystem mode disabled'));
    console.log(chalk.gray('    Paths will be resolved through logical-to-physical mapping.'));
  } else {
    console.log(chalk.red(`Unknown argument: ${subcommand}`));
    console.log(chalk.gray('Usage: physicalmode [on|off]'));
  }
}

/**
 * Toggles or displays command timing mode.
 *
 * @param args - Command line arguments: 'on', 'off', or empty to display status.
 */
async function builtin_timing(args: string[]): Promise<void> {
  const subcommand: string | undefined = args[0];

  if (!subcommand) {
    // Display current status
    const status: string = session.timingEnabled_get() ? 'enabled' : 'disabled';
    console.log(`Command timing: ${chalk.yellow(status)}`);
    if (session.timingEnabled_get()) {
      console.log(chalk.gray('  Execution times will be displayed after each command.'));
    } else {
      console.log(chalk.gray('  Execution times are hidden.'));
    }
    console.log(chalk.gray('\nUsage: timing [on|off]'));
    return;
  }

  if (subcommand === 'on') {
    session.timingEnabled_set(true);
    console.log(chalk.green('[+] Command timing enabled'));
    console.log(chalk.gray('    Execution times will be displayed after each command.'));
  } else if (subcommand === 'off') {
    session.timingEnabled_set(false);
    console.log(chalk.gray('[-] Command timing disabled'));
    console.log(chalk.gray('    Execution times will no longer be displayed.'));
  } else {
    console.log(chalk.red(`Unknown argument: ${subcommand}`));
    console.log(chalk.gray('Usage: timing [on|off]'));
  }
}

/**
 * Displays a directory tree of the ChRIS filesystem.
 * Uses chili's scan_do machinery for recursive filesystem traversal.
 *
 * @param args - Command line arguments (optional path and flags).
 * @returns A Promise that resolves when the tree is displayed.
 *
 * @example
 * ```
 * tree                    # Tree of current directory
 * tree /home/user/data    # Tree of specific path
 * tree --follow           # Follow symbolic links
 * ```
 */
async function builtin_tree(args: string[]): Promise<void> {
  const parsed: ParsedArgs = commandArgs_process(args);
  const pathArgs: string[] = parsed._ as string[];

  // Determine target path
  let targetPath: string | undefined;
  if (pathArgs.length > 0) {
    targetPath = await path_resolve(pathArgs[0]);
  }

  // Build scan options
  const scanOptions: CLIscan = {
    silent: true,
    tree: false,  // We'll format it ourselves
    follow: !!parsed['follow'],
    dirsOnly: false,
  };

  // If path specified, temporarily set context
  const originalFolder: string = await session.getCWD();
  if (targetPath) {
    await session.setCWD(targetPath);
  }

  try {
    const scanResult: ScanRecord | null = await scan_do(scanOptions);

    if (!scanResult) {
      const lastError = errorStack.stack_pop();
      if (lastError) {
        console.error(chalk.red(lastError.message));
      } else {
        console.error(chalk.red('Failed to scan directory tree.'));
      }
      return;
    }

    // Display the tree
    const treeOutput: string = archyTree_create(scanResult.fileInfo);
    console.log(treeOutput);

    // Display summary
    console.log(chalk.green(`Total size: ${bytes_format(scanResult.totalSize)}`));
    console.log(chalk.gray(`${scanResult.fileInfo.length} items`));

  } finally {
    // Restore original path
    if (targetPath) {
      await session.setCWD(originalFolder);
    }
  }
}

/**
 * Displays disk usage statistics for ChRIS filesystem directories.
 * Mimics standard Linux du command behavior and flags.
 * Uses chili's scan_do machinery for recursive filesystem traversal.
 *
 * @param args - Command line arguments (optional path and flags).
 * @returns A Promise that resolves when disk usage is displayed.
 *
 * @example
 * ```
 * du                      # Disk usage of current directory
 * du -h                   # Human-readable sizes
 * du -s /home/user/data   # Summary only
 * du -a                   # Show all files, not just directories
 * du -c                   # Show grand total
 * du -d 2                 # Max depth of 2 levels
 * ```
 */
async function builtin_du(args: string[]): Promise<void> {
  const parsed: ParsedArgs = commandArgs_process(args);
  const pathArgs: string[] = parsed._ as string[];

  // Parse flags
  const humanReadable: boolean = !!parsed['h'] || !!parsed['human-readable'];
  const summarize: boolean = !!parsed['s'] || !!parsed['summarize'];
  const showAll: boolean = !!parsed['a'] || !!parsed['all'];
  const showTotal: boolean = !!parsed['c'] || !!parsed['total'];
  const separateDirs: boolean = !!parsed['S'] || !!parsed['separate-dirs'];
  const maxDepth: number | undefined = parsed['d'] ? parseInt(String(parsed['d']), 10) :
                                        parsed['max-depth'] ? parseInt(String(parsed['max-depth']), 10) : undefined;

  // Determine target path
  let targetPath: string | undefined;
  if (pathArgs.length > 0) {
    targetPath = await path_resolve(pathArgs[0]);
  }

  // Build scan options
  const scanOptions: CLIscan = {
    silent: true,
    tree: false,
    follow: false,
    dirsOnly: false,
  };

  // If path specified, temporarily set context
  const originalFolder: string = await session.getCWD();
  const basePath: string = targetPath || originalFolder;
  if (targetPath) {
    await session.setCWD(targetPath);
  }

  try {
    const scanResult: ScanRecord | null = await scan_do(scanOptions);

    if (!scanResult) {
      const lastError = errorStack.stack_pop();
      if (lastError) {
        console.error(chalk.red(lastError.message));
      } else {
        console.error(chalk.red('Failed to scan directory for disk usage.'));
      }
      return;
    }

    // Build directory size map
    const dirSizes: Map<string, number> = new Map<string, number>();

    // Calculate depth of each path relative to base
    const depth_calculate = (filePath: string): number => {
      const relativePath: string = path.posix.relative(basePath, filePath);
      if (!relativePath || relativePath === '.') return 0;
      return relativePath.split('/').filter((part: string) => part.length > 0).length;
    };

    // Aggregate sizes
    scanResult.fileInfo.forEach((fileInfo: any) => {
      const filePath: string = fileInfo.chrisPath;
      const fileSize: number = fileInfo.size;

      if (fileInfo.isDirectory) {
        // Initialize directory if not exists
        if (!dirSizes.has(filePath)) {
          dirSizes.set(filePath, 0);
        }
      } else {
        // File: add to its parent directory and all ancestor directories
        let currentPath: string = path.posix.dirname(filePath);

        while (currentPath && currentPath !== '/' && currentPath.startsWith(basePath)) {
          const currentSize: number = dirSizes.get(currentPath) || 0;
          dirSizes.set(currentPath, currentSize + fileSize);

          if (separateDirs) break; // Don't propagate to parent dirs
          currentPath = path.posix.dirname(currentPath);
        }
      }
    });

    // Add base path if not present
    if (!dirSizes.has(basePath)) {
      dirSizes.set(basePath, 0);
    }

    // Format size for display
    const size_format = (bytes: number): string => {
      if (humanReadable) {
        return bytes_format(bytes);
      } else {
        // KB (1024 bytes per block, like du)
        return Math.ceil(bytes / 1024).toString();
      }
    };

    // Filter and sort entries
    let entries: Array<[string, number]> = Array.from(dirSizes.entries());

    // Apply max depth filter
    if (maxDepth !== undefined) {
      entries = entries.filter(([dirPath]) => {
        const depth: number = depth_calculate(dirPath);
        return depth <= maxDepth;
      });
    }

    // Sort by path
    entries.sort((a, b) => a[0].localeCompare(b[0]));

    // Display results
    if (summarize) {
      // Only show the base path total
      const totalSize: number = dirSizes.get(basePath) || 0;
      console.log(`${size_format(totalSize)}\t${basePath}`);
    } else {
      // Show all directories (and files if -a)
      for (const [dirPath, dirSize] of entries) {
        // Skip if showing only directories and this is a file
        if (!showAll && dirPath !== basePath) {
          const isDir: boolean = scanResult.fileInfo.some(
            (fi: any) => fi.isDirectory && fi.chrisPath === dirPath
          );
          if (!isDir) continue;
        }

        console.log(`${size_format(dirSize)}\t${dirPath}`);
      }
    }

    // Show grand total if requested
    if (showTotal) {
      const grandTotal: number = dirSizes.get(basePath) || 0;
      console.log(`${size_format(grandTotal)}\ttotal`);
    }

  } finally {
    // Restore original path
    if (targetPath) {
      await session.setCWD(originalFolder);
    }
  }
}
