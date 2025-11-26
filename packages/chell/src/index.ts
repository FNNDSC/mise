/**
 * @file ChELL - ChRIS Execution Logic Layer
 *
 * This is the main entry point for the interactive shell.
 * It handles the REPL loop, command parsing, connection management,
 * and dispatching commands to either internal logic or the `chili` CLI.
 *
 * @module
 */
import * as readline from 'readline';
import chalk from 'chalk';
import figlet from 'figlet';
import { spawn } from 'child_process';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { chrisConnection, chrisContext, chrisConnection_init, NodeStorageProvider, Context, Client } from '@fnndsc/cumin';
import { connect_login } from '@fnndsc/chili/commands/connect/login.js';
import { connect_logout } from '@fnndsc/chili/commands/connect/logout.js';
import { files_list as chefs_ls_cmd } from '@fnndsc/chili/commands/fs/ls.js';
import { files_mkdir as chefs_mkdir_cmd } from '@fnndsc/chili/commands/fs/mkdir.js';
import { files_touch as chefs_touch_cmd } from '@fnndsc/chili/commands/fs/touch.js';
import { CLIoptions } from '@fnndsc/chili/utils/cli.js';
import { plugins_fetchList } from '@fnndsc/chili/commands/plugins/list.js';
import { ResourceItem } from '@fnndsc/chili/commands/fs/ls.js'; 

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: '> ',
});

let currentChrisFolder: string = '/';

/**
 * Updates the shell prompt with the current user, CUBE URL, and context path.
 */
async function prompt_update(): Promise<void> {
  const user = (await chrisConnection.authToken_get()) ? await chrisConnection.user_get() : 'disconnected';
  const uri = await chrisConnection.chrisURL_get();
  currentChrisFolder = await chrisContext.current_get(Context.ChRISfolder) || '/';
  
  const promptUser = user || 'disconnected';
  const promptUri = uri ? new URL(uri).hostname : 'no-cube';
  const promptPath = currentChrisFolder;

  rl.setPrompt(`${chalk.green(promptUser)}@${chalk.blue(promptUri)}:${chalk.yellow(promptPath)}$ `);
  rl.prompt();
}

/**
 * Handles a single line of input from the REPL.
 * Dispatches known commands to handlers or falls back to chili.
 *
 * @param line - The raw input line from the user.
 */
async function command_handle(line: string): Promise<void> {
  const trimmedLine = line.trim();
  if (!trimmedLine) return;

  const [command, ...args] = trimmedLine.split(/\s+/);

  switch (command) {
    case 'connect':
      // Basic parsing for connect command: connect --user <user> --password <pwd> <url>
      const connectArgs = commandArgs_process(args);
      const user = connectArgs.user as string;
      const password = connectArgs.password as string;
      const url = connectArgs._[0] as string;

      if (user && password && url) {
        try {
          // Use chrisConnection directly from chell's scope to ensure singleton state is updated here
          await chrisConnection.connection_connect({ user, password, url, debug: false });
          console.log(chalk.green('Successfully connected to ChRIS.'));
        } catch (error: any) {
          console.error(chalk.red(`Connection failed: ${error.message}`));
        }
      } else {
        console.log(chalk.red('Usage: connect --user <username> --password <password> <url>'));
      }
      break;
    
    case 'logout':
      try {
        await chrisConnection.connection_logout();
        console.log(chalk.green('Logged out from ChRIS.'));
      } catch (error: any) {
        console.error(chalk.red(`Logout failed: ${error.message}`));
      }
      break;

    case 'chefs':
      await chefsCommand_handle(args);
      break;

    case 'ls':
      await lsCommand_handle(args);
      break;

    case 'cd':
      const pathArg = args[0];
      if (!pathArg) {
        // Default to root if no path provided
        await chrisContext.current_set(Context.ChRISfolder, '/');
        break;
      }
      
      try {
        // Resolve target path
        let targetPath = pathArg.startsWith('/') 
          ? pathArg 
          : path.posix.resolve(currentChrisFolder, pathArg);
        
        // Normalize trailing slash (remove unless root)
        if (targetPath.length > 1 && targetPath.endsWith('/')) {
          targetPath = targetPath.slice(0, -1);
        }

        // Verify existence using API
        const client = await chrisConnection.client_get();
        if (!client) {
             console.error(chalk.red('Not connected to ChRIS.'));
             break;
        }
        
        // getFileBrowserFolderByPath throws if not found
        try {
            const folder = await client.getFileBrowserFolderByPath(targetPath);
            if (folder) {
                await chrisContext.current_set(Context.ChRISfolder, targetPath);
            } else {
                console.error(chalk.red(`cd: ${pathArg}: No such file or directory`));
            }
        } catch (apiError: any) {
             console.error(chalk.red(`cd: ${pathArg}: No such file or directory`));
        }

      } catch (error: any) {
         console.error(chalk.red(`Failed to cd: ${error.message}`));
      }
      break;

    case 'pwd':
      const pwd = await chrisContext.current_get(Context.ChRISfolder) || '/';
      console.log(pwd);
      break;

    case 'exit':
      rl.close();
      break;
      
    default:
      // Fallback: Pass command to chili
      await chiliCommand_run(command, args);
      break;
  }
  await prompt_update();
}

/**
 * Spawns the `chili` CLI as a child process to handle commands not natively implemented in `chell`.
 *
 * @param command - The command name (e.g., 'feeds').
 * @param args - The arguments for the command.
 */
async function chiliCommand_run(command: string, args: string[]): Promise<void> {
  // Resolve path to chili/dist/index.js relative to this file
  // We are in dist/index.js when running.
  const chiliPath = path.resolve(__dirname, '../../chili/dist/index.js');
  
  return new Promise((resolve) => {
    const child = spawn('node', [chiliPath, command, ...args], {
      stdio: 'inherit', 
      env: process.env
    });

    child.on('close', (code) => {
      resolve();
    });

    child.on('error', (err) => {
      console.error(chalk.red(`Failed to start chili: ${err.message}`));
      resolve();
    });
  });
}

/**
 * Handles subcommands under the `chefs` namespace.
 *
 * @param args - The arguments passed to `chefs` (e.g., ['ls', '/bin']).
 */
async function chefsCommand_handle(args: string[]): Promise<void> {
  const [subcommand, ...subArgs] = args;
  
  try {
    switch (subcommand) {
      case 'pwd':
        const pwdPath = await chrisContext.current_get(Context.ChRISfolder) || '/';
        console.log(pwdPath);
        break;
      case 'ls':
        await lsCommand_handle(subArgs); 
        break;
      case 'mkdir':
        if (subArgs[0]) {
          // Resolve absolute path for mkdir
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

/**
 * Handles the `ls` command, supporting both the `/bin` VFS and the native ChRIS filesystem.
 *
 * @param args - Arguments for `ls`, specifically the target path.
 */
async function lsCommand_handle(args: string[]): Promise<void> {
  const target = args[0];

  if (target === '/bin') {
    try {
      const plugins = await plugins_fetchList({}); 
      if (plugins && plugins.tableData) {
        plugins.tableData.forEach((plugin: any) => {
          console.log(plugin.name);
        });
      } else {
        console.log(chalk.gray('No plugins found.'));
      }
    } catch (error: any) {
      console.error(chalk.red(`Failed to list plugins: ${error.message}`));
    }
  } else {
    // List ChRIS filesystem
    const relativeTarget = target || '.';
    const lsPath = path.posix.resolve(currentChrisFolder, relativeTarget);
    
    try {
      const lsItems = await chefs_ls_cmd({} as CLIoptions, lsPath); 
      lsItems.forEach((item: ResourceItem) => console.log(item.name));
    } catch (error: any) {
      console.error(chalk.red(`Failed to list ${lsPath}: ${error.message}`));
    }
  }
}

interface ParsedArgs {
  _: string[];
  [key: string]: string | boolean | string[];
}

/**
 * Parses command line arguments into a dictionary.
 *
 * @param args - The array of argument strings.
 * @returns A record where keys are flags (without '--') and values are string values or booleans.
 *          Positional arguments are collected in the `_` array.
 */
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
 * Starts the ChELL REPL.
 * Initializes connection and enters the command loop.
 */
async function chell_start(): Promise<void> {
  console.log(figlet.textSync('ChELL', { horizontalLayout: 'full' }));
  console.log(chalk.cyan('ChELL Execution Logic Layer - The ChRIS Interactive Shell'));

  const nodeStorageProvider = new NodeStorageProvider();
  await chrisConnection_init(nodeStorageProvider);

  await prompt_update();

  rl.on('line', command_handle);
  rl.on('close', () => {
    console.log(chalk.cyan('Exiting chell. Goodbye!'));
    process.exit(0);
  });
}

chell_start();