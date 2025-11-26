#!/usr/bin/env node

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
import { Command } from 'commander';
import { REPL } from './core/repl.js';
import { session } from './session/index.js';
import { 
  builtin_cd, 
  builtin_ls, 
  builtin_pwd, 
  builtin_connect, 
  builtin_logout,
  builtin_chefs 
} from './builtins/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function chiliCommand_run(command: string, args: string[]): Promise<void> {
  const chiliPath = path.resolve(__dirname, '../../chili/dist/index.js');
  return new Promise((resolve) => {
    const child = spawn('node', [chiliPath, command, ...args], {
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

async function command_handle(line: string): Promise<void> {
  const trimmedLine = line.trim();
  if (!trimmedLine) return;

  const [command, ...args] = trimmedLine.split(/\s+/);

  switch (command) {
    case 'connect': await builtin_connect(args); break;
    case 'logout': await builtin_logout(); break;
    case 'cd': await builtin_cd(args); break;
    case 'ls': await builtin_ls(args); break;
    case 'pwd': await builtin_pwd(); break;
    case 'chefs': await builtin_chefs(args); break;
    case 'exit': process.exit(0); break;
    default: await chiliCommand_run(command, args); break;
  }
}

/**
 * Prompts the user for a password.
 *
 * @param user - The username.
 * @param url - The CUBE URL.
 * @returns A Promise resolving to the password string.
 */
async function password_prompt(user: string, url: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    // Simple prompt, visible text for MVP compatibility
    rl.question(`Password for ${user}@${url}: `, (password: string) => {
      rl.close();
      resolve(password);
    });
  });
}

/**
 * Starts the ChELL REPL.
 * Initializes connection and enters the command loop.
 */
export async function chell_start(): Promise<void> {
  console.log(figlet.textSync('ChELL', { horizontalLayout: 'full' }));
  console.log(chalk.cyan('ChELL Execution Logic Layer - The ChRIS Interactive Shell'));
  console.log(chalk.yellow('The Taco Chell, filled with chili, salsa, and cumin goodness! 🌮'));

  await session.init();

  const program = new Command();
  program
    .name('chell')
    .description('ChRIS Interactive Shell')
    .argument('[target]', 'Target CUBE (user@url or url)')
    .option('-u, --user <user>', 'Username')
    .option('-p, --password <password>', 'Password')
    .addHelpText('after', `
Interactive Commands:
  connect    Connect to a ChRIS CUBE
  logout     Log out from ChRIS
  cd         Change directory
  ls         List directory contents
  pwd        Print working directory
  chefs      Access ChRIS Experimental File System commands
  exit       Exit the shell
  <other>    Any other command is passed to chili
    `)
    .action(async (target, options) => {
        let user = options.user;
        let url = target;
        let password = options.password;

        if (url && url.includes('@')) {
            const parts = url.split('@');
            user = parts[0];
            url = parts[1];
        }

        if (url) {
            if (!user) {
                console.error(chalk.red('Error: Username required when connecting via CLI args.'));
                process.exit(1);
            }
            if (!password) {
                password = await password_prompt(user, url);
            }
            
            try {
                await session.connection.connection_connect({ user, password, url, debug: false });
                console.log(chalk.green('Successfully connected to ChRIS.'));
            } catch (error: any) {
                console.error(chalk.red(`Connection failed: ${error.message}`));
                process.exit(1);
            }
        }
    });

  // Parse args only if provided (and not just the default node/script args)
  if (process.argv.length > 2) {
      await program.parseAsync(process.argv);
      // If --help or -h was provided, commander will usually print help and exit.
      // If it doesn't exit, we manually check for it and return to avoid starting REPL.
      if (process.argv.includes('--help') || process.argv.includes('-h')) {
          return; 
      }
  }

  const repl = new REPL();
  await repl.start(command_handle);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  chell_start();
}