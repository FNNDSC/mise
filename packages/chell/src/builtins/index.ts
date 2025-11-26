import { session } from '../session/index.js';
import { vfs } from '../lib/vfs/vfs.js';
import { files_mkdir as chefs_mkdir_cmd } from '@fnndsc/chili/commands/fs/mkdir.js';
import { files_touch as chefs_touch_cmd } from '@fnndsc/chili/commands/fs/touch.js';
import { files_list as chefs_ls_cmd } from '@fnndsc/chili/commands/fs/ls.js';
import { ResourceItem } from '@fnndsc/chili/commands/fs/ls.js';
import chalk from 'chalk';
import * as path from 'path';
import { CLIoptions } from '@fnndsc/chili/utils/cli.js';

interface ParsedArgs {
  _: string[];
  [key: string]: string | boolean | string[];
}

function commandArgs_process(args: string[]): ParsedArgs {
  const result: ParsedArgs = { _: [] };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const key = arg.substring(2);
      if (args[i+1] && !args[i+1].startsWith('--')) {
        result[key] = args[i+1];
        i++;
      } else {
        result[key] = true;
      }
    } else {
      result._.push(arg);
    }
  }
  return result;
}

/**
 * Change Directory.
 */
export async function builtin_cd(args: string[]): Promise<void> {
  const pathArg = args[0];
  if (!pathArg) {
    await session.setCWD('/');
    return;
  }
  
  try {
    const currentChrisFolder = await session.getCWD();
    let targetPath = pathArg.startsWith('/') 
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
 * Print Working Directory.
 */
export async function builtin_pwd(): Promise<void> {
  console.log(await session.getCWD());
}

/**
 * List Directory.
 */
export async function builtin_ls(args: string[]): Promise<void> {
  await vfs.list(args[0]);
}

/**
 * Connect to CUBE.
 */
export async function builtin_connect(args: string[]): Promise<void> {
  const parsed = commandArgs_process(args);
  const user = parsed.user as string;
  const password = parsed.password as string;
  const url = parsed._[0] as string;

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
 * Logout.
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
 * Chefs commands (legacy/wrapper).
 */
export async function builtin_chefs(args: string[]): Promise<void> {
  const [subcommand, ...subArgs] = args;
  const currentChrisFolder = await session.getCWD();

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
          const targetPath = subArgs[0].startsWith('/') 
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
           const targetPath = subArgs[0].startsWith('/') 
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
