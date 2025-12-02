/**
 * @file Built-in Shell Commands.
 *
 * Implements core shell commands like cd, ls, pwd, connect, logout.
 *
 * @module
 */
import { session } from '../session/index.js';
import { vfs } from '../lib/vfs/vfs.js';
import { listCache_get } from '@fnndsc/cumin';
import { files_mkdir as chefs_mkdir_cmd } from '@fnndsc/chili/commands/fs/mkdir.js';
import { files_touch as chefs_touch_cmd } from '@fnndsc/chili/commands/fs/touch.js';
import { files_upload as chefs_upload_cmd } from '@fnndsc/chili/commands/fs/upload.js';
import { files_cat as chefs_cat_cmd } from '@fnndsc/chili/commands/fs/cat.js';
import { files_rm as chefs_rm_cmd, RmResult, RmOptions } from '@fnndsc/chili/commands/fs/rm.js';
import { connect_login } from '@fnndsc/chili/commands/connect/login.js';
import { connect_logout } from '@fnndsc/chili/commands/connect/logout.js';
import { mkdir_render, touch_render, upload_render, cat_render, rm_render } from '@fnndsc/chili/views/fs.js';
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

export {
  builtin_cd,
  builtin_pwd,
  builtin_ls,
  builtin_upload,
  builtin_connect,
  builtin_logout,
  builtin_chefs,
  builtin_cat,
  builtin_rm,
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
  const pathArg: string | undefined = args[0];
  
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
  const pathArgs: string[] = parsed._ as string[];

  // Parse sort option
  let sortBy: 'name' | 'size' | 'date' | 'owner' = 'name';
  if (parsed['sort']) {
    const sortValue = String(parsed['sort']);
    if (['name', 'size', 'date', 'owner'].includes(sortValue)) {
      sortBy = sortValue as 'name' | 'size' | 'date' | 'owner';
    }
  }

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

  console.log(`Uploading ${localPath} to ${targetRemote}...`);
  try {
    const success: boolean = await chefs_upload_cmd(localPath, targetRemote);
    console.log(upload_render(localPath, targetRemote, success));

    // Invalidate cache for target directory
    if (success) {
      const listCache = listCache_get();
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
            const parentDir: string = targetPath.substring(0, targetPath.lastIndexOf('/')) || '/';
            const listCache = listCache_get();
            listCache.cache_invalidate(parentDir);
          }
        } else {
          console.log(chalk.red('Usage: chefs mkdir <path>'));
        }
        break;
      case 'touch':
        if (subArgs[0]) {
          const targetPath: string = subArgs[0].startsWith('/')
            ? subArgs[0]
            : await path_resolve(subArgs[0]);
          const success: boolean = await chefs_touch_cmd(targetPath);
          console.log(touch_render(targetPath, success));

          // Invalidate cache for parent directory
          if (success) {
            const parentDir: string = targetPath.substring(0, targetPath.lastIndexOf('/')) || '/';
            const listCache = listCache_get();
            listCache.cache_invalidate(parentDir);
          }
        } else {
          console.log(chalk.red('Usage: chefs touch <path>'));
        }
        break;
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
  if (args.length === 0) {
    console.error(chalk.red('Usage: touch <file> [file...]'));
    return;
  }

  for (const pathArg of args) {
    try {
      const targetPath: string = await path_resolve(pathArg);
      const success: boolean = await chefs_touch_cmd(targetPath);
      console.log(touch_render(targetPath, success));

      // Invalidate cache for parent directory
      if (success) {
        const parentDir: string = targetPath.substring(0, targetPath.lastIndexOf('/')) || '/';
        const listCache = listCache_get();
        listCache.cache_invalidate(parentDir);
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

  for (const arg of args) {
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
        const parentDir: string = target.substring(0, target.lastIndexOf('/')) || '/';
        const listCache = listCache_get();
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