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

  // Check for pipe operators
  const segments: string[] = pipes_parse(trimmedLine);
  if (segments.length > 1) {
    // Execute pipe chain
    try {
      await pipe_execute(segments);
    } catch (error: unknown) {
      const msg: string = error instanceof Error ? error.message : String(error);
      console.error(chalk.red(`Pipe error: ${msg}`));
    }
    return;
  }

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
 * Parses a command line for pipe operators and returns segments.
 *
 * @param line - The full command line.
 * @returns An array of command segments.
 */
function pipes_parse(line: string): string[] {
  const segments: string[] = [];
  let currentSegment: string = '';
  let inSingleQuote: boolean = false;
  let inDoubleQuote: boolean = false;

  for (let i = 0; i < line.length; i++) {
    const char: string = line[i];

    if (char === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      currentSegment += char;
    } else if (char === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      currentSegment += char;
    } else if (char === '|' && !inSingleQuote && !inDoubleQuote) {
      segments.push(currentSegment.trim());
      currentSegment = '';
    } else {
      currentSegment += char;
    }
  }

  if (currentSegment.trim()) {
    segments.push(currentSegment.trim());
  }

  return segments;
}

/**
 * Captures console output during command execution.
 *
 * @param fn - The function to execute while capturing output.
 * @returns The captured output as a string and buffer.
 */
async function output_capture(fn: () => Promise<void>): Promise<{ text: string; buffer: Buffer }> {
  const chunks: Buffer[] = [];
  const originalLog = console.log;
  const originalError = console.error;
  const originalStdoutWrite = process.stdout.write.bind(process.stdout);

  // Override console.log and console.error
  console.log = (...args: unknown[]): void => {
    const text: string = args.map(arg =>
      typeof arg === 'string' ? arg : JSON.stringify(arg)
    ).join(' ') + '\n';
    chunks.push(Buffer.from(text, 'utf-8'));
  };

  console.error = (...args: unknown[]): void => {
    const text: string = args.map(arg =>
      typeof arg === 'string' ? arg : JSON.stringify(arg)
    ).join(' ') + '\n';
    chunks.push(Buffer.from(text, 'utf-8'));
  };

  try {
    await fn();
  } finally {
    // Restore original console methods
    console.log = originalLog;
    console.error = originalError;
  }

  const buffer: Buffer = Buffer.concat(chunks);
  const text: string = buffer.toString('utf-8');

  return { text, buffer };
}

/**
 * Executes a chell command and captures its output.
 *
 * @param commandLine - The command line to execute.
 * @returns The captured output.
 */
async function chellCommand_executeAndCapture(commandLine: string): Promise<{ text: string; buffer: Buffer }> {
  const trimmedLine: string = commandLine.trim();
  if (!trimmedLine) return { text: '', buffer: Buffer.alloc(0) };

  let [command, ...args]: string[] = trimmedLine.split(/\s+/);

  // Expand wildcards for commands that support it
  if (shouldExpandWildcards(command)) {
    args = await wildcards_expandAll(args);
  }

  return output_capture(async () => {
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
      case 'exit':
        process.exit(0);
        break;
      default:
        console.log(chalk.yellow(`Unknown chell command '${command}' -- delegating to a spawned chili instance (slight delay expected)`));
        await chiliCommand_run(command, ['-s', ...args]);
        break;
    }
  });
}

/**
 * Executes a pipe chain by running the first command in chell and piping through local tools.
 *
 * @param segments - Array of command segments separated by pipes.
 * @returns A Promise that resolves when the pipe chain completes.
 */
async function pipe_execute(segments: string[]): Promise<void> {
  if (segments.length === 0) return;

  // Execute first segment in chell and capture output
  const firstCommand: string = segments[0];
  const { buffer } = await chellCommand_executeAndCapture(firstCommand);

  if (segments.length === 1) {
    // No pipes, just output the result
    process.stdout.write(buffer);
    return;
  }

  // Chain remaining segments as spawned processes
  let currentInput: Buffer = buffer;

  for (let i = 1; i < segments.length; i++) {
    const segment: string = segments[i];

    currentInput = await new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      // When using shell: true, pass the entire command as a single string
      const child: ChildProcess = spawn(segment, {
        stdio: ['pipe', 'pipe', 'inherit'],
        shell: true
      });

      child.stdout!.on('data', (chunk: Buffer) => {
        chunks.push(chunk);
      });

      child.on('close', (code: number | null) => {
        if (code !== 0 && code !== null) {
          reject(new Error(`Command '${segment}' exited with code ${code}`));
        } else {
          resolve(Buffer.concat(chunks));
        }
      });

      child.on('error', (err: Error) => {
        reject(err);
      });

      // Write input to child process
      if (currentInput.length > 0) {
        child.stdin!.write(currentInput);
      }
      child.stdin!.end();
    });
  }

  // Output final result
  process.stdout.write(currentInput);
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
          session.offline = true;
          console.log(chalk.gray(`    Use: connect --user ${currentContext.user} --password <pwd> ${currentContext.URL}`));
        }
      } catch (error: unknown) {
        const msg: string = error instanceof Error ? error.message : String(error);
        console.log(chalk.yellow('[!] Token expired or invalid'));
        console.log(chalk.gray(`    Error: ${msg}`));
        console.log(chalk.yellow('[!] Running in disconnected mode'));
        session.offline = true;
        console.log(chalk.gray(`    Use: connect --user ${currentContext.user} --password <pwd> ${currentContext.URL}`));
      }
    } else {
      console.log(chalk.yellow('[!] No token found'));
      console.log(chalk.yellow('[!] Running in disconnected mode'));
      session.offline = true;
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
  } else if ((!currentContext.user || !currentContext.URL) && !session.offline) {
    // Only show "disconnected mode" if there's truly no saved session
    // and we haven't already reported it.
    console.log(chalk.yellow('[!] Running in disconnected mode.'));
    session.offline = true;
  }

  console.log(border);
  console.log(chalk.yellow('Your Taco Chell, filled with chili, salsa, and cumin goodness is READY! 🌮'));
  console.log('');

  const repl: REPL = new REPL();
  await repl.start(command_handle);
}
