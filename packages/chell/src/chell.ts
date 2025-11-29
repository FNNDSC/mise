/**
 * @file ChELL - ChRIS Execution Logic Layer
 *
 * This contains the core logic for the interactive shell.
 *
 * @module
 */
import * as readline from 'readline';
import chalk from 'chalk';
import figlet from 'figlet';
import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { Command } from 'commander';
import { REPL } from './core/repl.js';
import { session } from './session/index.js';
import {
  builtin_cd,
  builtin_ls,
  builtin_pwd,
  builtin_connect,
  builtin_logout,
  builtin_chefs,
  builtin_cat,
  builtin_upload,
  builtin_rm,
  builtin_plugin,
  builtin_feed,
  builtin_files,
  builtin_links,
  builtin_dirs,
  builtin_context
} from './builtins/index.js';
import { wildcards_expandAll } from './builtins/wildcard.js';
import { help_show, hasHelpFlag } from './builtins/help.js';

/**
 * Interface for package.json structure.
 */
interface PackageJson {
  name: string;
  version: string;
  description?: string;
  [key: string]: unknown;
}

const __filename: string = fileURLToPath(import.meta.url);
const __dirname: string = path.dirname(__filename);
const packageJson: PackageJson = JSON.parse(readFileSync(path.resolve(__dirname, '../package.json'), 'utf-8'));

/**
 * Spawns the `chili` CLI as a child process.
 *
 * @param command - The command to run (e.g., "feeds").
 * @param args - The arguments to pass to the command.
 * @returns A Promise resolving when the child process exits.
 */
export async function chiliCommand_run(command: string, args: string[]): Promise<void> {
  const chiliPath: string = path.resolve(__dirname, '../../chili/dist/index.js');
  return new Promise((resolve) => {
    const child: ChildProcess = spawn('node', [chiliPath, command, ...args], {
      stdio: 'inherit',
      env: process.env
    });
    child.on('close', () => resolve());
    child.on('error', (err) => {
      console.error(chalk.red(`Failed to start chili: ${err.message}`));
      resolve();
    });
  });
}

/**
 * Determines if a command should have its arguments expanded for wildcards.
 *
 * @param command - The command name.
 * @returns True if wildcards should be expanded.
 */
function shouldExpandWildcards(command: string): boolean {
  // Commands that benefit from wildcard expansion
  const expandCommands: string[] = ['ls', 'rm', 'cat'];
  return expandCommands.includes(command);
}

/**
 * Handles a command entered by the user.
 *
 * @param line - The input line.
 * @returns A Promise that resolves once the command has been processed.
 */
async function command_handle(line: string): Promise<void> {
  const trimmedLine: string = line.trim();
  if (!trimmedLine) return;

  let [command, ...args]: string[] = trimmedLine.split(/\s+/);

  // Check for --help flag before any processing
  if (hasHelpFlag(args)) {
    help_show(command);
    return;
  }

  // Expand wildcards for commands that support it
  if (shouldExpandWildcards(command)) {
    args = await wildcards_expandAll(args);
  }

  switch (command) {
    case 'connect': await builtin_connect(args); break;
    case 'logout': await builtin_logout(); break;
    case 'cd': await builtin_cd(args); break;
    case 'ls': await builtin_ls(args); break;
    case 'pwd': await builtin_pwd(); break;
    case 'cat': await builtin_cat(args); break;
    case 'rm': await builtin_rm(args); break;
    case 'chefs': await builtin_chefs(args); break;
    case 'upload': await builtin_upload(args); break;
    case 'context': await builtin_context(args); break;
    case 'plugin':
    case 'plugins':
      await builtin_plugin(args);
      break;
    case 'feed':
    case 'feeds':
      await builtin_feed(args);
      break;
    case 'files':
      await builtin_files(args);
      break;
    case 'links':
      await builtin_links(args);
      break;
    case 'dirs':
      await builtin_dirs(args);
      break;
    case 'exit': process.exit(0); break;
    default:
      console.log(chalk.yellow(`Unknown chell command '${command}' -- delegating to a spawned chili instance (slight delay expected)`));
      await chiliCommand_run(command, ['-s', ...args]);
      break;
  }
}

import { Writable } from 'stream';

/**
 * Extended Writable stream with muted property for password input.
 */
interface MutableWritable extends Writable {
  muted?: boolean;
}

/**
 * Prompts the user for a password without echoing input.
 *
 * @param user - The username.
 * @param url - The CUBE URL.
 * @returns A Promise resolving to the password string.
 */
async function password_prompt(user: string, url: string): Promise<string> {
  return new Promise((resolve) => {
    const mutableStdout: MutableWritable = new Writable({
      write: function(chunk, encoding, callback) {
        if (!(this as MutableWritable).muted)
          process.stdout.write(chunk, encoding);
        callback();
      }
    });

    const rl = readline.createInterface({
      input: process.stdin,
      output: mutableStdout,
      terminal: true
    });

    mutableStdout.muted = false;
    process.stdout.write(`Password for ${user}@${url}: `);
    mutableStdout.muted = true;

    rl.question('', (password: string) => {
      rl.close();
      console.log(''); // Add newline after entry
      resolve(password);
    });
  });
}

import * as os from 'os';
import { cli_parse, ChellCLIConfig } from './core/cli.js';
import { context_getSingle } from '@fnndsc/salsa';
import { chrisContext } from '@fnndsc/cumin';

// ... (imports remain the same)

/**
 * Starts the ChELL REPL.
 * Initializes connection and enters the command loop.
 *
 * @returns A Promise that resolves when the shell exits.
 */
export async function chell_start(): Promise<void> {
  const config: ChellCLIConfig = await cli_parse(process.argv, packageJson.version);

  if (config.mode === 'help' || config.mode === 'version') {
    if (config.output) console.log(config.output);
    return;
  }

  // If we are still here, start the shell interface
  console.log(figlet.textSync('ChELL', { horizontalLayout: 'full' }));

  const border = chalk.gray('----------------------------------------------------------------');
  console.log(border);
  console.log(` ${chalk.cyan.bold('ChELL')} - ChRIS Execution Logic Layer`);
  console.log(` ${chalk.gray('Version:')} ${chalk.yellow(packageJson.version)}`);
  console.log(` ${chalk.gray('System :')} ${os.platform()} ${os.release()} (${os.arch()})`);
  console.log(` ${chalk.gray('User   :')} ${os.userInfo().username}`);
  console.log(` ${chalk.gray('Time   :')} ${new Date().toISOString()}`);
  console.log(border);

  console.log(chalk.cyan('[-] Initializing session components...'));
  await session.init();
  console.log(chalk.green('[+] Session initialized.'));

  // Check if we have a saved session from a previous run
  console.log(chalk.cyan('[-] Checking for previous context...'));
  await chrisContext.currentContext_update();
  const currentContext = context_getSingle();

  if (currentContext.user && currentContext.URL) {
    console.log(chalk.green('[+] Previous context detected'));
    console.log(chalk.gray(`    User: ${chalk.cyan(currentContext.user)}`));
    console.log(chalk.gray(`    URL:  ${chalk.cyan(currentContext.URL)}`));

    // Check for existing token
    console.log(chalk.cyan('[-] Validating existing token...'));
    const token = await session.connection.authToken_get(true);
    if (token) {
      // Token exists on disk, now validate it with the server
      console.log(chalk.cyan(`[-] Testing connection to ${currentContext.URL}`));
      try {
        const client = await session.connection.client_get();
        if (client) {
          // Make a simple API call to validate the token
          await client.getUser();
          console.log(chalk.green('[+] Token validated with server'));
          console.log(chalk.green('[+] Session restored'));
        } else {
          console.log(chalk.yellow('[!] Failed to create client'));
          console.log(chalk.yellow('[!] Running in disconnected mode'));
          console.log(chalk.gray(`    Use: connect --user ${currentContext.user} --password <pwd> ${currentContext.URL}`));
        }
      } catch (error: unknown) {
        const msg: string = error instanceof Error ? error.message : String(error);
        console.log(chalk.yellow('[!] Token expired or invalid'));
        console.log(chalk.gray(`    Error: ${msg}`));
        console.log(chalk.yellow('[!] Running in disconnected mode'));
        console.log(chalk.gray(`    Use: connect --user ${currentContext.user} --password <pwd> ${currentContext.URL}`));
      }
    } else {
      console.log(chalk.yellow('[!] No token found'));
      console.log(chalk.yellow('[!] Running in disconnected mode'));
      console.log(chalk.gray(`    Use: connect --user ${currentContext.user} --password <pwd> ${currentContext.URL}`));
    }
  } else {
    console.log(chalk.yellow('[!] No previous context found'));
  }

  if (config.mode === 'connect' && config.connectConfig) {
    let { user, password, url } = config.connectConfig;

    if (!user) {
      console.error(chalk.red('Error: Username required when connecting via CLI args.'));
      process.exit(1);
    }
    if (!password && url) {
      password = await password_prompt(user, url);
    }

    if (url && password) {
      console.log(chalk.cyan(`[-] Establishing uplink to ${url}...`));
      try {
        await session.connection.connection_connect({
          user: user!,
          password: password,
          url: url,
          debug: false
        });
        console.log(chalk.green('[+] Connection established.'));
      } catch (error: unknown) {
        const errorMessage: string = error instanceof Error ? error.message : String(error);
        console.error(chalk.red(`[!] Connection failed: ${errorMessage}`));
        process.exit(1);
      }
    }
  } else if (!currentContext.user || !currentContext.URL) {
    // Only show "disconnected mode" if there's truly no saved session
    console.log(chalk.yellow('[!] Running in disconnected mode.'));
  }

  console.log(border);
  console.log(chalk.yellow('Your Taco Chell, filled with chili, salsa, and cumin goodness is READY! 🌮'));
  console.log('');

  const repl: REPL = new REPL();
  await repl.start(command_handle);
}
