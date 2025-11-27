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
  builtin_cat 
} from './builtins/index.js';

const __filename: string = fileURLToPath(import.meta.url);
const __dirname: string = path.dirname(__filename);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const packageJson: any = JSON.parse(readFileSync(path.resolve(__dirname, '../package.json'), 'utf-8'));

/**
 * Spawns the `chili` CLI as a child process.
 *
 * @param command - The command to run (e.g., "feeds").
 * @param args - The arguments to pass to the command.
 * @returns A Promise resolving when the child process exits.
 */
async function chiliCommand_run(command: string, args: string[]): Promise<void> {
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
 * Handles a command entered by the user.
 *
 * @param line - The input line.
 * @returns A Promise that resolves once the command has been processed.
 */
async function command_handle(line: string): Promise<void> {
  const trimmedLine: string = line.trim();
  if (!trimmedLine) return;

  const [command, ...args]: string[] = trimmedLine.split(/\s+/);

  switch (command) {
    case 'connect': await builtin_connect(args); break;
    case 'logout': await builtin_logout(); break;
    case 'cd': await builtin_cd(args); break;
    case 'ls': await builtin_ls(args); break;
    case 'pwd': await builtin_pwd(); break;
    case 'cat': await builtin_cat(args); break;
    case 'chefs': await builtin_chefs(args); break;
    case 'exit': process.exit(0); break;
    default: await chiliCommand_run(command, args); break;
  }
}

import { Writable } from 'stream';

// ... (existing imports)

/**
 * Prompts the user for a password without echoing input.
 *
 * @param user - The username.
 * @param url - The CUBE URL.
 * @returns A Promise resolving to the password string.
 */
async function password_prompt(user: string, url: string): Promise<string> {
  return new Promise((resolve) => {
    const mutableStdout = new Writable({
      write: function(chunk, encoding, callback) {
        if (!(this as any).muted)
          process.stdout.write(chunk, encoding);
        callback();
      }
    });
    
    const rl = readline.createInterface({
      input: process.stdin,
      output: mutableStdout,
      terminal: true
    });

    (mutableStdout as any).muted = false;
    process.stdout.write(`Password for ${user}@${url}: `);
    (mutableStdout as any).muted = true;

    rl.question('', (password: string) => {
      rl.close();
      console.log(''); // Add newline after entry
      resolve(password);
    });
  });
}

import * as os from 'os';

// ... (imports remain the same)

/**
 * Starts the ChELL REPL.
 * Initializes connection and enters the command loop.
 *
 * @returns A Promise that resolves when the shell exits.
 */
export async function chell_start(): Promise<void> {
  const program: Command = new Command();
  
  interface ConnectConfig {
    user?: string;
    password?: string;
    url?: string;
  }
  
  let connectConfig: ConnectConfig | null = null;

  program
    .name('chell')
    .version(packageJson.version)
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
    .action(async (target: string | undefined, options: { user?: string, password?: string }) => {
        let user: string | undefined = options.user;
        let url: string | undefined = target;
        let password: string | undefined = options.password;

        if (url && url.includes('@')) {
            const parts: string[] = url.split('@');
            user = parts[0];
            url = parts[1];
        }

        if (url) {
            if (!url.startsWith('http://') && !url.startsWith('https://')) {
                url = 'http://' + url;
            }

            if (!user) {
                console.error(chalk.red('Error: Username required when connecting via CLI args.'));
                process.exit(1);
            }
            if (!password) {
                password = await password_prompt(user, url);
            }
            connectConfig = { user, password, url };
        }
    });

  // Let commander handle args. If --version or --help is used, it will exit.
  await program.parseAsync(process.argv);

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

  console.log(chalk.blue('[-] Initializing session components...'));
  await session.init();
  console.log(chalk.green('[+] Session initialized.'));

  if (connectConfig) {
      const config = connectConfig as ConnectConfig;
      console.log(chalk.blue(`[-] Establishing uplink to ${config.url}...`));
      try {
          await session.connection.connection_connect({ 
              user: config.user!, 
              password: config.password!, 
              url: config.url!, 
              debug: false 
          });
          console.log(chalk.green('[+] Connection established.'));
      } catch (error: any) {
          console.error(chalk.red(`[!] Connection failed: ${error.message}`));
          process.exit(1);
      }
  } else {
      console.log(chalk.yellow('[!] No target specified. Running in disconnected mode.'));
  }
  
  console.log(border);
  console.log(chalk.yellow('The Taco Chell, filled with chili, salsa, and cumin goodness! 🌮'));
  console.log('');

  const repl: REPL = new REPL();
  await repl.start(command_handle);
}
