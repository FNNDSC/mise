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
import { files_list as chefs_ls_cmd } from '@fnndsc/chili/commands/fs/ls.js';
import { ResourceItem } from '@fnndsc/chili/commands/fs/ls.js';
import chalk from 'chalk';
import * as path from 'path';
import { CLIoptions } from '@fnndsc/chili/utils/cli.js';

/**
 * Structure for parsed command line arguments.
 */
interface ParsedArgs {
  _: string[];
  [key: string]: string | boolean | string[];
}

/**
 * Parses raw argument strings into a structured object.
 * Flags starting with `--` are parsed as key-value pairs or boolean flags.
 * Positional arguments are collected in the `_` array.
 *
 * @param args - The array of raw argument strings to parse.
 * @returns An object containing parsed flags and positional arguments.
 */
function commandArgs_process(args: string[]): ParsedArgs {
  const result: ParsedArgs = { _: [] };
  for (let i = 0; i < args.length; i++) {
    const arg: string = args[i];
    if (arg.startsWith('--')) {
      const key: string = arg.substring(2);
      if (args[i + 1] && !args[i + 1].startsWith('--')) {
        result[key] = args[i + 1];
        i++;
      } else {
        result[key] = true;
      }
    } else {
      (result._ as string[]).push(arg);
    }
  }
  return result;
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
  if (!pathArg) {
    await session.setCWD('/');
    return;
  }

  try {
    const currentChrisFolder: string = await session.getCWD();
    let targetPath: string = pathArg.startsWith('/')
      ? pathArg
      : path.posix.resolve(currentChrisFolder, pathArg);

    if (targetPath.length > 1 && targetPath.endsWith('/')) {
      targetPath = targetPath.slice(0, -1);
    }

    const client = await session.connection.client_get();
    if (!client) {
      console.error(chalk.red('Not connected to ChRIS.'));
      return;
    }

    try {
      const folder = await client.getFileBrowserFolderByPath(targetPath);
      if (folder) {
        await session.setCWD(targetPath);
      } else {
        console.error(chalk.red(`cd: ${pathArg}: No such file or directory`));
      }
    } catch (apiError: any) {
      console.error(chalk.red(`cd: ${pathArg}: No such file or directory`));
    }

  } catch (error: any) {
    console.error(chalk.red(`Failed to cd: ${error.message}`));
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
  await vfs.list(args[0]);
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
      await session.connection.connection_connect({ user, password, url, debug: false });
      console.log(chalk.green('Successfully connected to ChRIS.'));
    } catch (error: any) {
      console.error(chalk.red(`Connection failed: ${error.message}`));
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
    await session.connection.connection_logout();
    console.log(chalk.green('Logged out from ChRIS.'));
  } catch (error: any) {
    console.error(chalk.red(`Logout failed: ${error.message}`));
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
            : path.posix.resolve(currentChrisFolder, subArgs[0]);
          await chefs_mkdir_cmd(targetPath);
          console.log(chalk.green(`Directory ${targetPath} created.`));
        } else {
          console.log(chalk.red('Usage: chefs mkdir <path>'));
        }
        break;
      case 'touch':
        if (subArgs[0]) {
          const targetPath: string = subArgs[0].startsWith('/')
            ? subArgs[0]
            : path.posix.resolve(currentChrisFolder, subArgs[0]);
          await chefs_touch_cmd(targetPath);
          console.log(chalk.green(`File ${targetPath} created.`));
        } else {
          console.log(chalk.red('Usage: chefs touch <path>'));
        }
        break;
      default:
        console.log(chalk.red(`Unknown chefs subcommand: ${subcommand}`));
        break;
    }
  } catch (error: any) {
    console.error(chalk.red(`Chefs command failed: ${error.message}`));
  }
}