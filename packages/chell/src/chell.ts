/**
 * @file ChELL - ChELL Executes Logic Layers
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
import { readFileSync, writeFileSync, appendFileSync, statSync, existsSync } from 'fs';
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
  builtin_cp,
  builtin_mv,
  builtin_upload,
  builtin_rm,
  builtin_touch,
  builtin_mkdir,
  builtin_plugin,
  builtin_feed,
  builtin_download,
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
  builtin_store
} from './builtins/index.js';
import { builtin_executePlugin } from './builtins/pluginExecute.js';
import { wildcards_expandAll } from './builtins/wildcard.js';
import { help_show, hasHelpFlag } from './builtins/help.js';
import { pluginExecutable_handle } from './builtins/executable.js';
import { Result, errorStack } from '@fnndsc/cumin';
import { vfs } from './lib/vfs/vfs.js';
import { spinner } from './lib/spinner.js';
import { args_tokenize } from './lib/parser.js';
import { semicolons_parse } from './lib/semicolonParser.js';

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

type BootStatus = 'ok' | 'skip' | 'fail' | 'info';

/**
 * Creates a simple boot logger with optional ASCII-only output.
 */
function bootLogger_create(title: string, useAscii: boolean) {
  const horiz: string = useAscii ? '-' : '─';
  const cornerTL: string = useAscii ? '+' : '┌';
  const cornerTR: string = useAscii ? '+' : '┐';
  const cornerBL: string = useAscii ? '+' : '└';
  const cornerBR: string = useAscii ? '+' : '┘';
  const bar: string = horiz.repeat(Math.max(title.length + 8, 30));

  const lineTop: string = `${cornerTL}${bar}${cornerTR}`;
  const lineBot: string = `${cornerBL}${bar}${cornerBR}`;
  const statusPad = (label: string): string => label.padEnd(12);

  const statusTag = (status: BootStatus): string => {
    switch (status) {
      case 'ok': return chalk.green('[ OK ]');
      case 'skip': return chalk.yellow('[SKIP]');
      case 'fail': return chalk.red('[FAIL]');
      default: return chalk.cyan('[ .. ]');
    }
  };

  return {
    header_print(): void {
      console.log(lineTop);
      const paddedTitle = ` ${title} `;
      const padLen = bar.length - paddedTitle.length;
      const leftPad = Math.floor(padLen / 2);
      const rightPad = padLen - leftPad;
      console.log(`${useAscii ? '|' : '│'}${' '.repeat(leftPad)}${chalk.bold(paddedTitle)}${' '.repeat(rightPad)}${useAscii ? '|' : '│'}`);
    },
    footer_print(): void {
      console.log(lineBot);
    },
    log(status: BootStatus, label: string, message: string): void {
      console.log(`${statusTag(status)} ${statusPad(label)} ${message}`);
    }
  };
}

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
  const expandCommands: string[] = ['ls', 'rm', 'cat', 'mv', 'cp', 'du', 'tree'];
  return expandCommands.includes(command);
}

/**
 * Executes a shell command on the host system (shell escape with ! prefix).
 *
 * @param shellCommand - The command to execute on the host shell.
 * @returns A Promise that resolves when the command completes.
 */
async function shellCommand_execute(shellCommand: string): Promise<void> {
  return new Promise((resolve) => {
    const child: ChildProcess = spawn(shellCommand, {
      shell: true,
      stdio: 'inherit',
      env: process.env
    });

    child.on('close', (code: number | null) => {
      if (code !== null && code !== 0) {
        console.error(chalk.red(`Shell command exited with code ${code}`));
      }
      resolve();
    });

    child.on('error', (err: Error) => {
      console.error(chalk.red(`Failed to execute shell command: ${err.message}`));
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

  // Start timing if enabled
  const startTime: number = session.timingEnabled_get() ? performance.now() : 0;

  // Check for shell escape (! prefix)
  if (trimmedLine.startsWith('!')) {
    const shellCommand: string = trimmedLine.substring(1).trim();
    if (shellCommand) {
      await shellCommand_execute(shellCommand);
      // Display timing if enabled
      if (session.timingEnabled_get()) {
        const elapsed: number = performance.now() - startTime;
        console.log(chalk.gray(`[${elapsed.toFixed(2)}ms]`));
      }
    }
    return;
  }

  // Check for semicolon-separated commands (execute sequentially)
  const commands: string[] = semicolons_parse(trimmedLine);
  if (commands.length > 1) {
    // Execute each command in sequence
    for (const cmd of commands) {
      try {
        await command_handle(cmd);
      } catch (error: unknown) {
        const msg: string = error instanceof Error ? error.message : String(error);
        console.error(chalk.red(`Command error: ${msg}`));

        // Stop on error if flag is set, otherwise continue (bash ; behavior)
        if (g_stopOnError) {
          throw error;
        }
      }
    }
    // Display total timing if enabled
    if (session.timingEnabled_get()) {
      const elapsed: number = performance.now() - startTime;
      console.log(chalk.gray(`[Total: ${elapsed.toFixed(2)}ms]`));
    }
    return;
  }

  // Check for output redirection (> or >>)
  const redirectInfo = redirect_parse(trimmedLine);
  if (redirectInfo) {
    try {
      // Execute command and capture output
      const { buffer } = await chellCommand_executeAndCapture(redirectInfo.command);
      const targetPath: string = redirect_target_resolve(redirectInfo.filePath, redirectInfo.command);

      // Write to file
      if (redirectInfo.operator === '>') {
        writeFileSync(targetPath, buffer);
      } else {
        appendFileSync(targetPath, buffer);
      }
    } catch (error: unknown) {
      const msg: string = error instanceof Error ? error.message : String(error);
      console.error(chalk.red(`Redirect error: ${msg}`));
    }
    // Display timing if enabled
    if (session.timingEnabled_get()) {
      const elapsed: number = performance.now() - startTime;
      console.log(chalk.gray(`[${elapsed.toFixed(2)}ms]`));
    }
    return;
  }

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
    // Display timing if enabled
    if (session.timingEnabled_get()) {
      const elapsed: number = performance.now() - startTime;
      console.log(chalk.gray(`[${elapsed.toFixed(2)}ms]`));
    }
    return;
  }

  const tokens: string[] = args_tokenize(trimmedLine);
  if (tokens.length === 0) return;
  let [command, ...args]: string[] = tokens;

  // Check for --help flag before any processing
  if (hasHelpFlag(args, command)) {
    help_show(command);
    return;
  }

  // Expand wildcards for commands that support it
  if (shouldExpandWildcards(command)) {
    const expandResult: Result<string[]> = await wildcards_expandAll(args);
    if (!expandResult.ok) {
      const lastError = errorStack.stack_pop();
      if (lastError) {
        console.error(chalk.red(lastError.message));
      }
      return;
    }
    args = expandResult.value;
  }

  // Attempt to handle as a simulated plugin execution
  if (await pluginExecutable_handle(command, args)) {
    // Display timing if enabled
    if (session.timingEnabled_get()) {
      const elapsed: number = performance.now() - startTime;
      console.log(chalk.gray(`[${elapsed.toFixed(2)}ms]`));
    }
    return;
  }

  switch (command) {
    case 'connect': await builtin_connect(args); break;
    case 'logout': await builtin_logout(); break;
    case 'cd': await builtin_cd(args); break;
    case 'ls': await builtin_ls(args); break;
    case 'pwd': await builtin_pwd(args); break;
    case 'cat': await builtin_cat(args); break;
    case 'rm': await builtin_rm(args); break;
    case 'cp': await builtin_cp(args); break;
    case 'mv': await builtin_mv(args); break;
    case 'touch': await builtin_touch(args); break;
    case 'mkdir': await builtin_mkdir(args); break;
    case 'chefs': await builtin_chefs(args); break;
    case 'upload': await builtin_upload(args); break;
    case 'download': await builtin_download(args); break;
    case 'context': await builtin_context(args); break;
    case 'parametersofplugin': await builtin_parametersofplugin(args); break;
    case 'physicalmode': await builtin_physicalmode(args); break;
    case 'timing': await builtin_timing(args); break;
    case 'debug': await builtin_debug(args); break;
    case 'help': await builtin_help(args); break;
    case 'tree': await builtin_tree(args); break;
    case 'du': await builtin_du(args); break;
    case 'store': await builtin_store(args); break;
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
      // Check if command is a plugin name in /bin
      const binResult = await vfs.data_get('/bin');
      if (binResult.ok) {
        const pluginNames = binResult.value.map(item => item.name);
        if (pluginNames.includes(command)) {
          // Execute plugin in place
          await builtin_executePlugin(command, args);
          break;
        }
      }

      // Fall through to chili delegation
      console.log(chalk.yellow(`Unknown chell command '${command}' -- delegating to a spawned chili instance (slight delay expected)`));
      await chiliCommand_run(command, ['-s', ...args]);
      break;
  }

  // Display timing if enabled
  if (session.timingEnabled_get()) {
    const elapsed: number = performance.now() - startTime;
    console.log(chalk.gray(`[${elapsed.toFixed(2)}ms]`));
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
 * Parses a command line for output redirection operators (> or >>).
 *
 * @param line - The full command line.
 * @returns An object with the command and redirect info, or null if no redirection.
 */
function redirect_parse(line: string): { command: string; operator: '>' | '>>'; filePath: string } | null {
  let inSingleQuote: boolean = false;
  let inDoubleQuote: boolean = false;

  for (let i = 0; i < line.length; i++) {
    const char: string = line[i];

    if (char === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
    } else if (char === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
    } else if (!inSingleQuote && !inDoubleQuote) {
      // Check for >>
      if (i < line.length - 1 && line[i] === '>' && line[i + 1] === '>') {
        const command = line.substring(0, i).trim();
        const filePath = line.substring(i + 2).trim();
        return { command, operator: '>>', filePath };
      }
      // Check for >
      else if (line[i] === '>') {
        const command = line.substring(0, i).trim();
        const filePath = line.substring(i + 1).trim();
        return { command, operator: '>', filePath };
      }
    }
  }

  return null;
}

/**
 * Resolves the final redirect target. If the target is an existing directory,
 * and the source command is `cat <file>`, write into that directory using the
 * source file's basename. Errors when the filename can't be determined.
 */
function redirect_target_resolve(filePath: string, commandLine: string): string {
  try {
    const stats = statSync(filePath);
    if (!stats.isDirectory()) {
      return filePath;
    }
  } catch (err: unknown) {
    // Path doesn't exist; treat as a normal file path.
    const nodeErr = err as NodeJS.ErrnoException;
    if (nodeErr.code === 'ENOENT') {
      return filePath;
    }
    throw err;
  }

  const tokens: string[] = args_tokenize(commandLine);
  if (tokens.length === 0) {
    throw new Error(`Redirect target '${filePath}' is a directory and no source command was provided.`);
  }

  const [command, ...args] = tokens;
  if (command !== 'cat') {
    throw new Error(`Redirect target '${filePath}' is a directory; cannot infer filename for command '${command}'.`);
  }

  const sourceArgs: string[] = args.filter(arg => arg !== '--binary');
  if (sourceArgs.length === 0) {
    throw new Error(`Redirect target '${filePath}' is a directory; no source file provided to 'cat'.`);
  }

  if (sourceArgs.length > 1) {
    throw new Error(`Redirect target '${filePath}' is a directory; 'cat' with multiple files cannot choose a single output name.`);
  }

  const sourceName: string = path.basename(sourceArgs[0]);
  return path.join(filePath, sourceName);
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
  const originalStdoutWrite = process.stdout.write.bind(process.stdout);

  // Override console.log and console.error
  console.log = (...args: unknown[]): void => {
    const text: string = args.map(arg =>
      typeof arg === 'string' ? arg : JSON.stringify(arg)
    ).join(' ') + '\n';
    chunks.push(Buffer.from(text, 'utf-8'));
  };

  // Override process.stdout.write to capture binary data
  process.stdout.write = ((chunk: unknown): boolean => {
    if (typeof chunk === 'string') {
      chunks.push(Buffer.from(chunk, 'utf-8'));
    } else if (Buffer.isBuffer(chunk)) {
      chunks.push(chunk);
    } else if (chunk instanceof Uint8Array) {
      chunks.push(Buffer.from(chunk));
    }
    return true;
  }) as typeof process.stdout.write;

  try {
    await fn();
  } finally {
    // Restore original console methods and stdout.write
    console.log = originalLog;
    process.stdout.write = originalStdoutWrite;
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

  const tokens: string[] = args_tokenize(trimmedLine);
  if (tokens.length === 0) {
    return { text: '', buffer: Buffer.alloc(0) };
  }
  let [command, ...args]: string[] = tokens;

  // Expand wildcards for commands that support it
  if (shouldExpandWildcards(command)) {
    const expandResult: Result<string[]> = await wildcards_expandAll(args);
    if (!expandResult.ok) {
      const lastError = errorStack.stack_pop();
      const errorMsg: string = lastError ? lastError.message : 'Unknown error';
      return { text: chalk.red(`${errorMsg}\n`), buffer: Buffer.from('') };
    }
    args = expandResult.value;
  }

  return output_capture(async () => {
    switch (command) {
      case 'connect': await builtin_connect(args); break;
      case 'logout': await builtin_logout(); break;
      case 'cd': await builtin_cd(args); break;
      case 'ls': await builtin_ls(args); break;
      case 'pwd': await builtin_pwd(args); break;
      case 'cat': await builtin_cat(args); break;
      case 'rm': await builtin_rm(args); break;
      case 'touch': await builtin_touch(args); break;
      case 'mkdir': await builtin_mkdir(args); break;
      case 'chefs': await builtin_chefs(args); break;
      case 'upload': await builtin_upload(args); break;
      case 'context': await builtin_context(args); break;
      case 'parametersofplugin': await builtin_parametersofplugin(args); break;
      case 'physicalmode': await builtin_physicalmode(args); break;
      case 'timing': await builtin_timing(args); break;
      case 'du': await builtin_du(args); break;
      case 'store': await builtin_store(args); break;
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

      // Handle EPIPE errors when child closes stdin early
      child.stdin!.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EPIPE') {
          // Child closed stdin, this is normal if it exits early
          // Don't reject, just ignore - we'll handle exit code in 'close' event
        } else {
          reject(err);
        }
      });

      // Write input to child process with proper backpressure handling
      /**
       * Writes all buffered data to child process stdin with backpressure handling.
       * Splits large buffers into chunks and waits for drain events when needed.
       */
      const data_writeAll = async (): Promise<void> => {
        if (currentInput.length === 0) {
          child.stdin!.end();
          return;
        }

        return new Promise<void>((resolveWrite: (value: void) => void, rejectWrite: (reason: Error) => void) => {
          let offset: number = 0;
          const chunkSize: number = 64 * 1024; // 64KB chunks

          /**
           * Recursively writes the next chunk of data to stdin.
           * Handles backpressure by waiting for drain events when buffer is full.
           */
          const chunk_writeNext = (): void => {
            try {
              while (offset < currentInput.length) {
                const end: number = Math.min(offset + chunkSize, currentInput.length);
                const chunk: Buffer = currentInput.subarray(offset, end);
                offset = end;

                const canContinue: boolean = child.stdin!.write(chunk);
                if (!canContinue) {
                  // Buffer is full, wait for drain event
                  child.stdin!.once('drain', chunk_writeNext);
                  return;
                }
              }
              // All data written, close stdin
              child.stdin!.end();
              resolveWrite();
            } catch (err: unknown) {
              rejectWrite(err as Error);
            }
          };

          chunk_writeNext();
        });
      };

      // Start writing data (don't await - let it happen in parallel with reading output)
      data_writeAll().catch((err: unknown) => {
        // Ignore write errors if child already closed (EPIPE will be caught by stdin error handler)
      });
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
import { chrisContext, Context, SingleContext } from '@fnndsc/cumin';
// Global flag to control stop-on-error behavior
let g_stopOnError: boolean = false;

/**
 * Renders a simple key/value info box.
 */
function infoBox_print(rows: Array<{ label: string; value: string }>, useAscii: boolean): void {
  const horiz: string = useAscii ? '-' : '─';
  const vert: string = useAscii ? '|' : '│';
  const cornerTL: string = useAscii ? '+' : '┌';
  const cornerTR: string = useAscii ? '+' : '┐';
  const cornerBL: string = useAscii ? '+' : '└';
  const cornerBR: string = useAscii ? '+' : '┘';

  const labelWidth: number = Math.max(...rows.map(r => r.label.length), 8);
  const valueWidth: number = Math.max(...rows.map(r => r.value.length), 20);
  const innerWidth: number = Math.max(labelWidth + valueWidth + 3, 40);
  const line: string = horiz.repeat(innerWidth);

  console.log(`${cornerTL}${line}${cornerTR}`);
  rows.forEach(({ label, value }) => {
    const paddedLabel: string = label.padEnd(labelWidth);
    const paddedValue: string = value.padEnd(innerWidth - labelWidth - 2);
    console.log(`${vert} ${chalk.gray(paddedLabel)} ${chalk.white(paddedValue)}${vert}`);
  });
  console.log(`${cornerBL}${line}${cornerBR}`);
}

/**
 * Executes a chell script file.
 * Reads the file line by line, ignoring comments and blank lines.
 * Supports shebang (#!) on first line.
 *
 * @param scriptPath - Path to the script file.
 * @param stopOnError - Whether to stop execution on first error (default: false).
 * @returns A Promise that resolves when script execution completes.
 *
 * @example
 * ```typescript
 * await script_execute('/path/to/script.chell', false);
 * ```
 */
async function script_execute(scriptPath: string, stopOnError: boolean = false): Promise<void> {
  if (!existsSync(scriptPath)) {
    console.error(chalk.red(`Error: Script file not found: ${scriptPath}`));
    process.exit(1);
  }

  // Set global stop-on-error flag
  g_stopOnError = stopOnError;

  const scriptContent: string = readFileSync(scriptPath, 'utf8');
  const lines: string[] = scriptContent.split('\n');

  for (let i: number = 0; i < lines.length; i++) {
    let line: string = lines[i].trim();

    // Skip shebang on first line
    if (i === 0 && line.startsWith('#!')) {
      continue;
    }

    // Skip comment lines and blank lines
    if (line.startsWith('#') || line === '') {
      continue;
    }

    // Execute the line
    try {
      await command_handle(line);
    } catch (error: unknown) {
      const msg: string = error instanceof Error ? error.message : String(error);
      console.error(chalk.red(`Error on line ${i + 1}: ${msg}`));

      if (stopOnError) {
        console.error(chalk.red('Stopping execution due to error (use without -e to continue on error)'));
        process.exit(1);
      }
      // Otherwise continue to next line
    }
  }

  // Reset flag
  g_stopOnError = false;
}

/**
 * Starts the ChELL REPL.
 * Initializes connection and enters the command loop.
 *
 * @returns A Promise that resolves when the shell exits.
 */
export async function chell_start(): Promise<void> {
  const config: ChellCLIConfig = await cli_parse(process.argv, packageJson.version);
  const isInteractiveSession: boolean = config.mode !== 'execute' && config.mode !== 'script';
  const useAsciiBoot: boolean = (config.asciiBoot ?? false) || !process.stdout.isTTY;
  const prefetchPlugins: boolean = isInteractiveSession && (config.prefetchPlugins ?? true);
  const prefetchFeeds: boolean = isInteractiveSession && (config.prefetchFeeds ?? true);
  const prefetchPublicFeeds: boolean = prefetchFeeds && (config.prefetchPublicFeeds ?? false);
  const boot = isInteractiveSession ? bootLogger_create('ChELL Boot', useAsciiBoot) : null;

  if (config.mode === 'help' || config.mode === 'version') {
    if (config.output) console.log(config.output);
    return;
  }

  const border = chalk.gray('----------------------------------------------------------------');

  // Show startup banner only in interactive mode
  if (isInteractiveSession) {
    console.log(figlet.textSync('ChELL', { horizontalLayout: 'full' }));
    const rows = [
      { label: 'ChELL', value: 'ChELL Executes Layered Logic' },
      { label: 'Version', value: packageJson.version },
      { label: 'System', value: `${os.platform()} ${os.release()} (${os.arch()})` },
      { label: 'User', value: os.userInfo().username },
      { label: 'Time', value: new Date().toISOString() },
    ];
    infoBox_print(rows, useAsciiBoot);
    boot?.header_print();
  }

  // --- Common Initialization ---

  spinner.start('Initializing session components');
  await session.init();
  spinner.stop();
  if (isInteractiveSession) {
    console.log(chalk.green('[+] Session initialized.'));
    boot?.log('ok', 'Session', 'Components initialized');
  }

  // Set physical filesystem mode if requested
  if (config.physicalFS) {
    session.physicalMode_set(true);
    if (config.mode !== 'execute' && config.mode !== 'script') {
      console.log(chalk.yellow('[!] Physical filesystem mode enabled - logical-to-physical mapping disabled'));
    }
  }

  let currentContext: SingleContext = context_getSingle();

  // Handle explicit connection arguments (valid for both modes) BEFORE restoring saved context
  if (config.connectConfig) {
    let { user, password, url } = config.connectConfig;

    if (!user) {
      console.error(chalk.red('Error: Username required when connecting via CLI args.'));
      process.exit(1);
    }
    if (!password && url && config.mode !== 'execute' && config.mode !== 'script') {
      // Only prompt for password in interactive modes
      password = await password_prompt(user, url);
    } else if (!password && config.mode === 'execute') {
       console.error(chalk.red('Error: Password required for connection in execute mode.'));
       process.exit(1);
    }

    if (url && password) {
      spinner.start(`Establishing uplink to ${url}`);
      try {
        await session.connection.connection_connect({
          user: user!,
          password: password,
          url: url,
          debug: false
        });
        session.offline = false;
        // Explicit CLI args take precedence over any saved context.
        await chrisContext.current_set(Context.ChRISuser, user!);
        await chrisContext.current_set(Context.ChRISURL, url);
        await chrisContext.current_set(Context.ChRISfolder, '/');
        await chrisContext.current_set(Context.ChRISfeed, '');
        await chrisContext.current_set(Context.ChRISplugin, '');
        await chrisContext.currentContext_update();
        currentContext = context_getSingle();
        spinner.stop();
        if (config.mode !== 'execute' && config.mode !== 'script') {
          console.log(chalk.green('[+] Connection established.'));
        }
        boot?.log('ok', 'Connect', `Connected to ${url}`);
      } catch (error: unknown) {
        spinner.stop();
        const errorMessage: string = error instanceof Error ? error.message : String(error);
        console.error(chalk.red(`[!] Connection failed: ${errorMessage}`));
        boot?.log('fail', 'Connect', errorMessage);
        process.exit(1);
      }
    }
  } else {
    // Check if we have a saved session from a previous run
    spinner.start('Checking for previous context');
    await chrisContext.currentContext_update();
    spinner.stop();
    currentContext = context_getSingle();

    if (currentContext.user && currentContext.URL) {
      if (config.mode !== 'execute' && config.mode !== 'script') {
        console.log(chalk.green('[+] Previous context detected'));
        console.log(chalk.gray(`    User: ${chalk.cyan(currentContext.user)}`));
        console.log(chalk.gray(`    URL:  ${chalk.cyan(currentContext.URL)}`));
      }

      // Check for existing token
      spinner.start('Validating existing token');
      const token = await session.connection.authToken_get(true);
      spinner.stop();
      if (token) {
        // Token exists on disk, now validate it with the server
        spinner.start(`Testing connection to ${currentContext.URL}`);
        try {
          const client = await session.connection.client_get();
          if (client) {
            // Make a simple API call to validate the token
            await client.getUser();
            spinner.stop();
            if (config.mode !== 'execute' && config.mode !== 'script') {
              console.log(chalk.green('[+] Token validated with server'));
              console.log(chalk.green('[+] Session restored'));
              boot?.log('ok', 'Session', `Restored ${currentContext.user}@${currentContext.URL}`);
            }
          } else {
            spinner.stop();
            console.log(chalk.yellow('[!] Failed to create client'));
            console.log(chalk.yellow('[!] Running in disconnected mode'));
            session.offline = true;
            console.log(chalk.gray(`    Use: connect --user ${currentContext.user} --password <pwd> ${currentContext.URL}`));
          }
        } catch (error: unknown) {
          spinner.stop();
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
        boot?.log('skip', 'Session', 'No saved token; offline');
      }
    } else {
      if (config.mode !== 'execute' && config.mode !== 'script') {
        console.log(chalk.yellow('[!] No previous context found'));
      }
    }
  }

  if ((!currentContext.user || !currentContext.URL) && !session.offline) {
    // Only show "disconnected mode" if there's truly no saved session
    // and we haven't already reported it.
    console.log(chalk.yellow('[!] Running in disconnected mode.'));
    session.offline = true;
  }

  const prefetch_path = async (label: string, target: string): Promise<void> => {
    try {
      const result = await vfs.data_get(target);
      if (result.ok) {
        boot?.log('ok', label, `Cached ${result.value.length} item(s) from ${target}`);
      } else {
        const err = errorStack.stack_pop();
        boot?.log('fail', label, err?.message || `Prefetch failed for ${target}`);
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      boot?.log('fail', label, msg);
    }
  };

  // --- Execution Mode ---

  if (config.mode === 'execute' && config.commandToExecute) {
    // Set stop-on-error flag if requested
    if (config.stopOnError) {
      g_stopOnError = true;
    }
    await command_handle(config.commandToExecute);
    process.exit(0);
  }

  // --- Script Mode ---

  if (config.mode === 'script' && config.scriptFile) {
    await script_execute(config.scriptFile, config.stopOnError || false);
    process.exit(0);
  }

  // --- Interactive Mode ---

  // Pre-cache /bin for fast tab completion
  if (!session.offline && prefetchPlugins) {
    spinner.start('Populating plugin cache');
    try {
      const result = await vfs.data_get('/bin');
      spinner.stop();
      if (result.ok) {
        boot?.log('ok', 'Plugins', `Cached ${result.value.length} plugin(s)`);
      }
    } catch (e: unknown) {
      spinner.stop();
      const msg: string = e instanceof Error ? e.message : String(e);
      boot?.log('fail', 'Plugins', msg);
    }
  } else if (!session.offline) {
    boot?.log('skip', 'Plugins', 'Prefetch disabled');
  } else {
    boot?.log('skip', 'Plugins', 'Offline mode');
  }

  if (!session.offline && prefetchFeeds) {
    const userFeedPath: string | undefined = currentContext.user
      ? `/home/${currentContext.user}/feeds`
      : undefined;
    if (userFeedPath) {
      await prefetch_path('Feeds', userFeedPath);
    } else {
      boot?.log('skip', 'Feeds', 'No user context');
    }
    if (prefetchPublicFeeds) {
      await prefetch_path('Public', '/PUBLIC');
    }
  } else if (!session.offline) {
    boot?.log('skip', 'Feeds', 'Prefetch disabled');
  } else {
    boot?.log('skip', 'Feeds', 'Offline mode');
  }

  boot?.footer_print();

  console.log(chalk.yellow('Order up! Your Taco Chell is ready! Filled with chili, salsa, and cumin goodness! 🌮'));
  console.log('');

  const repl: REPL = new REPL();
  await repl.start(command_handle);
}
