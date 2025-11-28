/**
 * @file Built-in Shell Commands.
 *
 * Implements core shell commands like cd, ls, pwd, connect, logout.
 *
 * @module
 */
import { session } from '../session/index.js';
import { vfs } from '../lib/vfs/vfs.js';
import { files_mkdir as chefs_mkdir_cmd } from '@fnndsc/chili/commands/fs/mkdir.js';
import { files_touch as chefs_touch_cmd } from '@fnndsc/chili/commands/fs/touch.js';
import { files_upload as chefs_upload_cmd } from '@fnndsc/chili/commands/fs/upload.js';
import { files_cat as chefs_cat_cmd } from '@fnndsc/chili/commands/fs/cat.js';
import { connect_login } from '@fnndsc/chili/commands/connect/login.js';
import { connect_logout } from '@fnndsc/chili/commands/connect/logout.js';
import { renderMkdir, renderTouch, renderUpload, renderCat } from '@fnndsc/chili/views/fs.js';
import { renderLogin, renderLogout } from '@fnndsc/chili/views/connect.js';
import { plugins_fetchList } from '@fnndsc/chili/commands/plugins/list.js';
import { plugin_execute } from '@fnndsc/chili/commands/plugin/run.js';
import { renderPluginList, renderPluginRun } from '@fnndsc/chili/views/plugin.js';
import { Plugin, PluginInstance } from '@fnndsc/chili/models/plugin.js';
import { feeds_fetchList } from '@fnndsc/chili/commands/feeds/list.js';
import { feed_create } from '@fnndsc/chili/commands/feed/create.js';
import { renderFeedList, renderFeedCreate } from '@fnndsc/chili/views/feed.js';
import { Feed } from '@fnndsc/chili/models/feed.js';
import { FeedListResult } from '@fnndsc/chili/commands/feeds/list.js';
import chalk from 'chalk';
import { commandArgs_process, ParsedArgs, path_resolve_pure } from './utils.js';

export { commandArgs_process };
export type { ParsedArgs };

/**
 * Resolves a path argument, handling `~` expansion and relative paths.
 * @param inputPath - The path to resolve.
 * @returns The absolute path.
 */
export async function path_resolve(inputPath: string): Promise<string> {
  const user: string | null = await session.connection.user_get();
  const cwd: string = await session.getCWD();
  return path_resolve_pure(inputPath, { user, cwd });
}

/**
 * Changes the current working directory in the ChRIS filesystem context.
 * Validates the existence of the target path before setting it.
 *
 * @param args - An array containing the target path as the first element.
 * @returns A Promise that resolves when the operation is complete.
 */
export async function builtin_cd(args: string[]): Promise<void> {
  const pathArg: string | undefined = args[0];
  
  // 'cd' with no args goes to home
  if (!pathArg) {
    const user: string | null = await session.connection.user_get();
    // Reuse logic by pretending arg is '~'
    return builtin_cd(['~']);
  }

  try {
    const targetPath: string = await path_resolve(pathArg);

    // Handle virtual directories
    if (targetPath === '/bin') {
      await session.setCWD('/bin');
      return;
    }

    const client = await session.connection.client_get();
    if (!client) {
      console.error(chalk.red('Not connected to ChRIS.'));
      return;
    }

    try {
      // Note: getFileBrowserFolderByPath returns generic object or null.
      // We treat it as unknown here as we only check existence.
      const folder: unknown = await client.getFileBrowserFolderByPath(targetPath);
      if (folder) {
        await session.setCWD(targetPath);
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
export async function builtin_pwd(): Promise<void> {
  console.log(await session.getCWD());
}

/**
 * Lists the contents of the current or specified directory in the ChRIS filesystem context.
 * Supports a virtual `/bin` directory for plugins.
 *
 * @param args - An array containing the target path as the first element (optional).
 * @returns A Promise that resolves when the directory contents are listed.
 */
export async function builtin_ls(args: string[]): Promise<void> {
  const parsed: ParsedArgs = commandArgs_process(args);
  const pathArgs: string[] = parsed._ as string[];
  let target: string | undefined = pathArgs[0];
  
  if (target) {
    target = await path_resolve(target);
  }
  
  const options: { long: boolean; human: boolean } = {
    long: !!parsed['l'],
    human: !!parsed['h']
  };
  
  await vfs.list(target, options);
}

/**
 * Uploads a local file or directory to ChRIS.
 *
 * @param args - [localPath, remotePath]
 */
export async function builtin_upload(args: string[]): Promise<void> {
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
    console.log(renderUpload(localPath, targetRemote, success));
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
export async function builtin_connect(args: string[]): Promise<void> {
  const parsed: ParsedArgs = commandArgs_process(args);
  const user: string = parsed.user as string;
  const password: string = parsed.password as string;
  const url: string = parsed._[0] as string;

  if (user && password && url) {
    try {
      const success: boolean = await connect_login({ user, password, url, debug: false });
      console.log(renderLogin(success, url, user));
    } catch (error: unknown) {
      const msg: string = error instanceof Error ? error.message : String(error);
      console.log(renderLogin(false, url, user));
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
export async function builtin_logout(): Promise<void> {
  try {
    await connect_logout();
    console.log(renderLogout(true));
  } catch (error: unknown) {
    console.log(renderLogout(false));
    const msg: string = error instanceof Error ? error.message : String(error);
    console.error(chalk.red(`Logout failed: ${msg}`));
  }
}

/**
 * Handles plugin commands.
 *
 * @param args - command arguments.
 */
export async function builtin_plugin(args: string[]): Promise<void> {
  const parsed: ParsedArgs = commandArgs_process(args);
  const subcommand = parsed._[0];
  
  if (!subcommand) {
     console.log(chalk.red("Usage: plugin <list|run> ..."));
     return;
  }

  try {
    if (subcommand === 'list') {
       const plugins: Plugin[] = await plugins_fetchList(parsed as any);
       console.log(renderPluginList(plugins));
    } else if (subcommand === 'run') {
       const searchable = parsed._[1];
       if (!searchable) {
          console.log(chalk.red("Usage: plugin run <plugin> [args...]"));
          return;
       }
       const params = args.slice(2).join(' ');
       const instance: PluginInstance | null = await plugin_execute(searchable, params);
       if (instance) {
          console.log(renderPluginRun(instance));
       } else {
          console.error(chalk.red("Plugin execution failed."));
       }
    } else {
       console.log(chalk.red(`Unknown plugin command: ${subcommand}`));
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
export async function builtin_feed(args: string[]): Promise<void> {
  const parsed: ParsedArgs = commandArgs_process(args);
  const subcommand = parsed._[0];
  
  if (!subcommand) {
     console.log(chalk.red("Usage: feed <list|create> ..."));
     return;
  }

  try {
    if (subcommand === 'list') {
       const { feeds, selectedFields }: FeedListResult = await feeds_fetchList(parsed as any);
       console.log(renderFeedList(feeds, selectedFields));
    } else if (subcommand === 'create') {
       // Requires --dirs and --params flag handling which parsed already has.
       // feed create --dirs ...
       const feed: Feed | null = await feed_create(parsed as any);
       if (feed) {
          console.log(renderFeedCreate(feed));
       }
    } else {
       console.log(chalk.red(`Unknown feed command: ${subcommand}`));
    }
  } catch (e: unknown) {
    const msg: string = e instanceof Error ? e.message : String(e);
    console.error(chalk.red(`Feed error: ${msg}`));
  }
}

/**
 * Handles `chefs` subcommands, providing a legacy wrapper for ChRIS Experimental File System primitives.
 *
 * @param args - An array containing the subcommand and its arguments.
 * @returns A Promise that resolves when the `chefs` command processing is complete.
 */
export async function builtin_chefs(args: string[]): Promise<void> {
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
          console.log(renderMkdir(targetPath, success));
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
          console.log(renderTouch(targetPath, success));
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
 * Displays the content of a file.
 *
 * @param args - Command line arguments (file path).
 */
export async function builtin_cat(args: string[]): Promise<void> {
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
     console.log(renderCat(content, pathArg));
  } catch (e: unknown) {
     const msg: string = e instanceof Error ? e.message : String(e);
     console.error(chalk.red(`cat: ${msg}`));
  }
}