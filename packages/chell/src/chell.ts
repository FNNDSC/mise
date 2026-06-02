/**
 * @file ChELL - ChELL Executes Logic Layers
 *
 * Core entrypoint for the CheLL interactive shell. Responsibilities:
 * - Initialize session/context and render the boot splash (logo + system/ChRIS panels).
 * - Parse and execute user input with support for wildcards, pipes, redirects, and inline shell escapes.
 * - Dispatch built-in commands, simulated plugin exec, and fallback delegation to `chili`.
 * - Provide REPL loop with timing, debug toggles, and logical/physical FS modes.
 *
 * The code is organized into:
 * - Session/bootstrap helpers (init, prefetch, intro rendering)
 * - Command preprocessing helpers (semicolon batching, pipes, redirects, wildcards, help)
 * - Command dispatch table for built-ins and plugin/bin execution
 * - REPL wiring and prompt startup
 *
 * @module
 */
import * as readline from 'readline';
import * as os from 'os';
import * as path from 'path';
import { readFileSync, writeFileSync, appendFileSync, statSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { Writable } from 'stream';
import chalk from 'chalk';
import { spawn, ChildProcess } from 'child_process';
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
  builtin_pacs,
  builtin_pipeline,
  builtin_pull,
  builtin_query,
  builtin_cubepath,
  builtin_rm,
  builtin_touch,
  builtin_mkdir,
  builtin_plugin,
  builtin_feed,
  builtin_compute,
  builtin_download,
  builtin_files,
  builtin_links,
  builtin_dirs,
  builtin_context,
  builtin_parametersofplugin,
  builtin_physicalmode,
  builtin_prompt,
  builtin_timing,
  builtin_debug,
  builtin_help,
  builtin_tree,
  builtin_du,
  builtin_store,
  error_stripDebugPrefix
} from './builtins/index.js';
import { builtin_executePlugin } from './builtins/pluginExecute.js';
import { wildcards_expandAll } from './builtins/wildcard.js';
import { help_show, args_checkHasHelpFlag } from './builtins/help.js';
import { pluginExecutable_handle } from './builtins/executable.js';
import { Result, errorStack, Ok, Err } from '@fnndsc/cumin';
import { vfs } from './lib/vfs/vfs.js';
import { spinner } from './lib/spinner.js';
import { args_tokenize } from './lib/parser.js';
import { semicolons_parse } from './lib/semicolonParser.js';
import { logo_linesRender, logo_print, logo_animatePulse, logo_animateStart, logo_animateStop } from './lib/logo.js';
import {
  BootInfoItem,
  BootInfoItem3,
  BootPanels,
  bootLogger_create,
  bootsequence_printIntroPanels,
  bootsequence_printIntroPanelsStacked
} from './lib/bootsequence.js';
import { settings_load } from './config/settings.js';
import { cli_parse, ChellCLIConfig } from './core/cli.js';
import { context_getSingle } from '@fnndsc/salsa';
import { chrisContext, Context, SingleContext } from '@fnndsc/cumin';

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
const cuminJson: PackageJson = JSON.parse(readFileSync(path.resolve(__dirname, '../node_modules/@fnndsc/cumin/package.json'), 'utf-8'));
const salsaJson: PackageJson = JSON.parse(readFileSync(path.resolve(__dirname, '../node_modules/@fnndsc/salsa/package.json'), 'utf-8'));
const chiliJson: PackageJson = JSON.parse(readFileSync(path.resolve(__dirname, '../node_modules/@fnndsc/chili/package.json'), 'utf-8'));

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
function wildcards_expandCheck(command: string): boolean {
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
  const timingEnabled: boolean = session.timingEnabled_get();
  const startTime: number = timingEnabled ? performance.now() : 0;

  if (command_shellEscape_detect(trimmedLine)) {
    await shellEscape_handle(trimmedLine, startTime, timingEnabled);
    return;
  }

  const semicolonResult: Result<boolean> = await semicolons_handle(trimmedLine, startTime, timingEnabled);
  if (!semicolonResult.ok) {
    return;
  }
  if (semicolonResult.value) return;

  const redirectResult: Result<boolean> = await redirect_handle(trimmedLine, startTime, timingEnabled);
  if (!redirectResult.ok) {
    return;
  }
  if (redirectResult.value) return;

  const pipeResult: Result<boolean> = await pipe_handle(trimmedLine, startTime, timingEnabled);
  if (!pipeResult.ok) {
    return;
  }
  if (pipeResult.value) return;

  const tokens: string[] = args_tokenize(trimmedLine);
  if (tokens.length === 0) return;
  let [command, ...args]: string[] = tokens;

  // Check for --help flag before any processing
  const helpResult: Result<boolean> = help_showMaybe(command, args);
  if (helpResult.ok && helpResult.value) {
    return;
  }

  // Expand wildcards for commands that support it
  const expandResult: Result<string[]> = await wildcards_expand(command, args);
  if (!expandResult.ok) {
    return;
  }
  args = expandResult.value;

  // Attempt to handle as a simulated plugin execution
  if (await pluginExecutable_handle(command, args)) {
    // Display timing if enabled
    command_timingMaybePrint(startTime, timingEnabled);
    return;
  }

  await command_dispatch(command, args);

  // Display timing if enabled
  command_timingMaybePrint(startTime, timingEnabled);
}

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
 * Resolves the final redirect target path. If the target is an existing directory
 * and the source command is `cat <file>`, resolves to `<dir>/<basename>`.
 * Returns Err (with message on errorStack) when the filename cannot be determined.
 *
 * @param filePath - The redirect target path as written by the user.
 * @param commandLine - The command whose output is being redirected.
 * @returns Ok(resolved path) or Err on failure.
 */
function redirectTarget_resolve(filePath: string, commandLine: string): Result<string> {
  try {
    const stats = statSync(filePath);
    if (!stats.isDirectory()) {
      return Ok(filePath);
    }
  } catch (err: unknown) {
    const nodeErr = err as NodeJS.ErrnoException;
    if (nodeErr.code === 'ENOENT') {
      return Ok(filePath);
    }
    errorStack.stack_push('error', `Redirect: filesystem error for '${filePath}': ${String(err)}`);
    return Err();
  }

  const tokens: string[] = args_tokenize(commandLine);
  if (tokens.length === 0) {
    errorStack.stack_push('error', `Redirect target '${filePath}' is a directory and no source command was provided.`);
    return Err();
  }

  const [command, ...args] = tokens;
  if (command !== 'cat') {
    errorStack.stack_push('error', `Redirect target '${filePath}' is a directory; cannot infer filename for command '${command}'.`);
    return Err();
  }

  const sourceArgs: string[] = args.filter((arg: string) => arg !== '--binary');
  if (sourceArgs.length === 0) {
    errorStack.stack_push('error', `Redirect target '${filePath}' is a directory; no source file provided to 'cat'.`);
    return Err();
  }

  if (sourceArgs.length > 1) {
    errorStack.stack_push('error', `Redirect target '${filePath}' is a directory; 'cat' with multiple files cannot choose a single output name.`);
    return Err();
  }

  const sourceName: string = path.basename(sourceArgs[0]);
  return Ok(path.join(filePath, sourceName));
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

type CommandHandler = (args: string[]) => Promise<void>;

const COMMAND_HANDLERS: Record<string, CommandHandler> = {
  connect: builtin_connect,
  logout: builtin_logout,
  cd: builtin_cd,
  ls: builtin_ls,
  pwd: builtin_pwd,
  cat: builtin_cat,
  rm: builtin_rm,
  cp: builtin_cp,
  mv: builtin_mv,
  touch: builtin_touch,
  mkdir: builtin_mkdir,
  chefs: builtin_chefs,
  upload: builtin_upload,
  pacs: builtin_pacs,
  pipeline: builtin_pipeline,
  pipelines: builtin_pipeline,
  pull: builtin_pull,
  query: builtin_query,
  cubepath: builtin_cubepath,
  download: builtin_download,
  context: builtin_context,
  parametersofplugin: builtin_parametersofplugin,
  physicalmode: builtin_physicalmode,
  prompt: builtin_prompt,
  timing: builtin_timing,
  debug: builtin_debug,
  help: builtin_help,
  tree: builtin_tree,
  du: builtin_du,
  store: builtin_store,
  plugin: builtin_plugin,
  plugins: builtin_plugin,
  feed: builtin_feed,
  feeds: builtin_feed,
  compute: builtin_compute,
  computes: builtin_compute,
  files: builtin_files,
  links: builtin_links,
  dirs: builtin_dirs,
  pacsservers: async (args: string[]): Promise<void> => {
    await chiliCommand_run('pacsservers', ['-s', ...args]);
  },
  pacsqueries: async (args: string[]): Promise<void> => {
    await chiliCommand_run('pacsqueries', ['-s', ...args]);
  },
  pacsretrieve: async (args: string[]): Promise<void> => {
    await chiliCommand_run('pacsretrieve', ['-s', ...args]);
  }
};

/**
 * Prints elapsed time since startTime if timing is enabled.
 *
 * @param startTime - Timestamp from `performance.now()` at command start.
 * @param enabled - Whether timing display is active.
 */
function command_timingMaybePrint(startTime: number, enabled: boolean): void {
  if (!enabled) return;
  const elapsed: number = performance.now() - startTime;
  console.log(chalk.gray(`[${elapsed.toFixed(2)}ms]`));
}

/**
 * Handles a pipeline name invoked directly as an executable from /bin.
 * Routes flag combinations to the appropriate pipeline subcommand:
 *   --nodes / --parameters → pipeline info
 *   --source / --readme    → pipeline source
 *   (bare or --compute)    → pipeline run
 *
 * @param name - The pipeline name as typed.
 * @param args - Arguments following the pipeline name.
 */
async function pipelineExecutable_handle(name: string, args: string[]): Promise<void> {
  if (args.includes('--nodes') || args.includes('--parameters')) {
    await builtin_pipeline(['info', name]);
  } else if (args.includes('--source') || args.includes('--readme')) {
    await builtin_pipeline(['source', name]);
  } else {
    await builtin_pipeline(['run', name, ...args]);
  }
}

/**
 * Dispatches a parsed command to its handler.
 * Checks COMMAND_HANDLERS, then /bin plugin names, then falls back to chili.
 *
 * @param command - The command name.
 * @param args - Parsed arguments.
 */
async function command_dispatch(command: string, args: string[]): Promise<void> {
  if (command === 'exit') {
    process.exit(0);
  }

  const handler: CommandHandler | undefined = COMMAND_HANDLERS[command];
  if (handler) {
    await handler(args);
    return;
  }

  const binResult = await vfs.data_get('/bin');
  if (binResult.ok) {
    const pluginItem = binResult.value.find(item => item.name === command && item.type === 'plugin');
    const pipelineItem = binResult.value.find(item => item.name === command && item.type === 'pipeline');

    if (pluginItem) {
      await builtin_executePlugin(command, args);
      return;
    }

    if (pipelineItem) {
      await pipelineExecutable_handle(command, args);
      return;
    }
  }

  console.log(chalk.yellow(`Unknown chell command '${command}' -- delegating to a spawned chili instance (slight delay expected)`));
  await chiliCommand_run(command, ['-s', ...args]);
}

/**
 * Returns true if the input line is a shell escape (starts with `!`).
 *
 * @param line - Trimmed input line.
 */
function command_shellEscape_detect(line: string): boolean {
  return line.startsWith('!');
}

/**
 * Executes a shell-escaped command and prints timing if enabled.
 *
 * @param line - Full input line including the leading `!`.
 * @param startTime - Timing reference from `performance.now()`.
 * @param timingEnabled - Whether to print elapsed time after execution.
 */
async function shellEscape_handle(line: string, startTime: number, timingEnabled: boolean): Promise<void> {
  const shellCommand: string = line.substring(1).trim();
  if (!shellCommand) return;
  await shellCommand_execute(shellCommand);
  command_timingMaybePrint(startTime, timingEnabled);
}

/**
 * Splits a semicolon-separated command line and executes each segment in sequence.
 * Returns Ok(true) if the line contained semicolons and was handled, Ok(false) if not.
 *
 * @param line - Full input line.
 * @param startTime - Timing reference.
 * @param timingEnabled - Whether to print total elapsed time after all segments.
 */
async function semicolons_handle(line: string, startTime: number, timingEnabled: boolean): Promise<Result<boolean>> {
  const commands: string[] = semicolons_parse(line);
  if (commands.length <= 1) {
    return Ok(false);
  }
  for (const cmd of commands) {
    try {
      await command_handle(cmd);
    } catch (error: unknown) {
      const msg: string = error instanceof Error ? error.message : String(error);
      console.error(chalk.red(`Command error: ${msg}`));
      if (stopOnError) {
        return Err();
      }
    }
  }
  if (timingEnabled) {
    const elapsed: number = performance.now() - startTime;
    console.log(chalk.gray(`[Total: ${elapsed.toFixed(2)}ms]`));
  }
  return Ok(true);
}

/**
 * Handles output redirection (`>` / `>>`). Captures command output and writes to the target file.
 * Returns Ok(true) if redirection was detected and handled, Ok(false) if not.
 *
 * @param line - Full input line.
 * @param startTime - Timing reference.
 * @param timingEnabled - Whether to print elapsed time after execution.
 */
async function redirect_handle(line: string, startTime: number, timingEnabled: boolean): Promise<Result<boolean>> {
  const redirectInfo = redirect_parse(line);
  if (!redirectInfo) {
    return Ok(false);
  }
  const { buffer } = await chellCommand_executeAndCapture(redirectInfo.command);
  const targetResult: Result<string> = redirectTarget_resolve(redirectInfo.filePath, redirectInfo.command);
  if (!targetResult.ok) {
    const lastError = errorStack.stack_pop();
    console.error(chalk.red(lastError ? lastError.message : 'Redirect error'));
    return Err();
  }
  if (redirectInfo.operator === '>') {
    writeFileSync(targetResult.value, buffer);
  } else {
    appendFileSync(targetResult.value, buffer);
  }
  command_timingMaybePrint(startTime, timingEnabled);
  return Ok(true);
}

/**
 * Handles pipe chains (`cmd1 | cmd2 | ...`). Executes the first segment in chell and
 * pipes the output through subsequent host-shell processes.
 * Returns Ok(true) if a pipe was detected and handled, Ok(false) if not.
 *
 * @param line - Full input line.
 * @param startTime - Timing reference.
 * @param timingEnabled - Whether to print elapsed time after the chain completes.
 */
async function pipe_handle(line: string, startTime: number, timingEnabled: boolean): Promise<Result<boolean>> {
  const segments: string[] = pipes_parse(line);
  if (segments.length <= 1) {
    return Ok(false);
  }
  try {
    await pipe_execute(segments);
  } catch (error: unknown) {
    const msg: string = error instanceof Error ? error.message : String(error);
    console.error(chalk.red(`Pipe error: ${msg}`));
    return Err();
  }
  command_timingMaybePrint(startTime, timingEnabled);
  return Ok(true);
}

/**
 * Shows help for a command if `--help` or `-h` is present in args.
 * Returns Ok(true) if help was displayed, Ok(false) otherwise.
 *
 * @param command - The command name (used to look up help text).
 * @param args - Parsed argument list.
 */
function help_showMaybe(command: string, args: string[]): Result<boolean> {
  if (args_checkHasHelpFlag(args, command)) {
    help_show(command);
    return Ok(true);
  }
  return Ok(false);
}

/**
 * Expands wildcard patterns in args for commands that support it.
 * Returns Ok(expanded args) or Err if expansion fails.
 *
 * @param command - The command name (determines whether expansion applies).
 * @param args - Raw argument list potentially containing glob patterns.
 */
async function wildcards_expand(command: string, args: string[]): Promise<Result<string[]>> {
  if (!wildcards_expandCheck(command)) {
    return Ok(args);
  }
  const expandResult: Result<string[]> = await wildcards_expandAll(args);
  if (!expandResult.ok) {
    const lastError = errorStack.stack_pop();
    if (lastError) {
      console.error(chalk.red(error_stripDebugPrefix(lastError.message)));
    }
    return Err();
  }
  return Ok(expandResult.value);
}

/**
 * Executes a chell command and captures its output.
 * Consults COMMAND_HANDLERS — the single source of truth — so the pipe path
 * is always consistent with the direct-execution path.
 *
 * @param commandLine - The command line to execute.
 * @returns The captured output as text and raw buffer.
 */
async function chellCommand_executeAndCapture(commandLine: string): Promise<{ text: string; buffer: Buffer }> {
  const trimmedLine: string = commandLine.trim();
  if (!trimmedLine) return { text: '', buffer: Buffer.alloc(0) };

  const tokens: string[] = args_tokenize(trimmedLine);
  if (tokens.length === 0) {
    return { text: '', buffer: Buffer.alloc(0) };
  }
  let [command, ...args]: string[] = tokens;

  if (wildcards_expandCheck(command)) {
    const expandResult: Result<string[]> = await wildcards_expandAll(args);
    if (!expandResult.ok) {
      const lastError = errorStack.stack_pop();
      const errorMsg: string = lastError ? error_stripDebugPrefix(lastError.message) : 'Unknown error';
      return { text: chalk.red(`${errorMsg}\n`), buffer: Buffer.from('') };
    }
    args = expandResult.value;
  }

  return output_capture(async () => {
    if (command === 'exit') {
      process.exit(0);
    }

    if (await pluginExecutable_handle(command, args, { piped: true })) {
      return;
    }

    const handler: CommandHandler | undefined = COMMAND_HANDLERS[command];
    if (handler) {
      await handler(args);
      return;
    }

    console.log(chalk.yellow(`Unknown chell command '${command}' -- delegating to a spawned chili instance (slight delay expected)`));
    await chiliCommand_run(command, ['-s', ...args]);
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

let stopOnError: boolean = false;

/**
 * Returns the first non-internal IPv4 address of the local machine, or null if none found.
 */
function localIPv4_get(): string | null {
  const interfaces = os.networkInterfaces();
  for (const key of Object.keys(interfaces)) {
    const iface = interfaces[key];
    if (!iface) continue;
    for (const entry of iface) {
      if (entry.family === 'IPv4' && !entry.internal && entry.address) {
        return entry.address;
      }
    }
  }
  return null;
}

/**
 * Returns the current local date/time as `YYYY-MM-DD HH:MM:SS ±HH:MM`.
 */
function localTime_withOffset(): string {
  const now: Date = new Date();
  const offsetMinutes: number = now.getTimezoneOffset();
  const sign: string = offsetMinutes <= 0 ? '+' : '-';
  const absMinutes: number = Math.abs(offsetMinutes);
  const hours: number = Math.floor(absMinutes / 60);
  const minutes: number = absMinutes % 60;
  const pad = (n: number): string => n.toString().padStart(2, '0');
  const offsetStr: string = `${sign}${pad(hours)}:${pad(minutes)}`;
  const dateStr: string = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const timeStr: string = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  return `${dateStr} ${timeStr} ${offsetStr}`;
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
  stopOnError = stopOnError;

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
  stopOnError = false;
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
  const prefetchPublicFeeds: boolean = isInteractiveSession && prefetchFeeds && (config.prefetchPublicFeeds ?? true);
  const showLogo: boolean = isInteractiveSession && process.stdout.isTTY && (config.showLogo ?? true);
  const boot = isInteractiveSession ? bootLogger_create('ChELL Boot', useAsciiBoot) : null;

  if (config.mode === 'help' || config.mode === 'version') {
    if (config.output) console.log(config.output);
    return;
  }

  // --- Common Initialization ---

  if (isInteractiveSession) {
    logo_print(showLogo && !useAsciiBoot);
  }

  await settings_load();

  spinner.start('Initializing session components');
  await session.init();
  spinner.stop();

  // Register static VFS providers under the unified salsa vfsDispatcher
  const { vfsDispatcher } = await import('@fnndsc/salsa');
  const { StaticVfsProvider } = await import('./lib/vfs/providers/static.js');
  vfsDispatcher.provider_register(new StaticVfsProvider('/bin'));
  vfsDispatcher.provider_register(new StaticVfsProvider('/usr'));
  vfsDispatcher.provider_register(new StaticVfsProvider('/usr/bin'));

  // Register logical-to-physical path resolution hook on the unified salsa vfsDispatcher
  vfsDispatcher.pathResolver_register(async (logicalPath: string): Promise<string> => {
    if (session.physicalMode_get()) {
      return logicalPath;
    }
    const { logical_toPhysical } = await import('@fnndsc/chili/utils');
    const res = await logical_toPhysical(logicalPath);
    if (res.ok) {
      return res.value;
    }
    throw new Error(`Logical-to-physical resolution failed for path: ${logicalPath}`);
  });

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

  let currentContext: SingleContext = await context_getSingle();
  if (!currentContext.folder) {
    currentContext = { ...currentContext, folder: '/' };
  }

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
        currentContext = await context_getSingle();
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
    spinner.stop();
    currentContext = await context_getSingle();

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

  // Login phase complete — start the brain activity animation now
  if (isInteractiveSession && showLogo && !useAsciiBoot) {
    logo_animatePulse();
  }

  const prefetch_path = async (label: string, target: string): Promise<{ ok: boolean; count?: number; message?: string }> => {
    try {
      const result = await vfs.data_get(target);
      if (result.ok) {
        return { ok: true, count: result.value.length };
      }
      const err = errorStack.stack_pop();
      return { ok: false, message: err ? error_stripDebugPrefix(err.message) : `Prefetch failed for ${target}` };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, message: msg };
    }
  };

  const prefetch_withSpinner = async (
    label: string,
    message: string,
    action: () => Promise<{ ok: boolean; count?: number; pipelineCount?: number; message?: string }>
  ): Promise<{ ok: boolean; count?: number; pipelineCount?: number; message?: string }> => {
    const paddedLabel: string = label.padEnd(12);
    // Spinner adds its own glyph and a following space. Pad so the label column
    // aligns with the fixed-width status logs (e.g., "[ OK ] " = 7 chars).
    const spinnerPrefix: string = ' '.repeat(5); // 1 glyph + 1 space + 5 = 7
    const spinnerMessage: string = `${spinnerPrefix}${paddedLabel} ${message}`;
    const showSpinner: boolean = isInteractiveSession && process.stdout.isTTY;

    if (showSpinner) {
      spinner.start(spinnerMessage, true);
    } else {
      console.log(spinnerMessage);
    }

    try {
      return await action();
    } finally {
      if (showSpinner) {
        spinner.stop();
        process.stdout.write('\r\x1b[K');
      }
    }
  };

  // --- Execution Mode ---

  if (config.mode === 'execute' && config.commandToExecute) {
    // Set stop-on-error flag if requested
    if (config.stopOnError) {
      stopOnError = true;
    }
    await command_handle(config.commandToExecute);
    process.exit(process.exitCode ?? 0);
  }

  // --- Script Mode ---

  if (config.mode === 'script' && config.scriptFile) {
    await script_execute(config.scriptFile, config.stopOnError || false);
    process.exit(0);
  }

  // --- Interactive Mode ---

  let cachedPlugins: number | undefined;
  let cachedPipelines: number | undefined;
  let cachedFeeds: number | undefined;
  let cachedPublic: number | undefined;

  // Pre-cache /bin for fast tab completion
  if (!session.offline && prefetchPlugins) {
    const binResult = await prefetch_withSpinner('Plugins', 'Prefetching /bin for completions', async () => {
      const result = await vfs.data_get('/bin');
      if (result.ok) {
        const pluginCount = result.value.filter((item: { type: string }) => item.type === 'plugin').length;
        const pipelineCount = result.value.filter((item: { type: string }) => item.type === 'pipeline').length;
        return { ok: true, count: pluginCount, pipelineCount };
      }
      const err = errorStack.stack_pop();
      return { ok: false, message: err ? error_stripDebugPrefix(err.message) : 'Failed to prefetch /bin' };
    });
    if (binResult.ok) {
      cachedPlugins = binResult.count;
      cachedPipelines = binResult.pipelineCount;
      boot?.log('ok', 'Plugins', `Cached ${binResult.count ?? 0} plugin(s)`);
      boot?.log('ok', 'Pipelines', `Cached ${binResult.pipelineCount ?? 0} pipeline(s)`);
    } else {
      boot?.log('fail', 'Plugins', binResult.message || 'Failed to prefetch /bin');
    }
  } else if (!session.offline) {
    boot?.log('skip', 'Plugins', 'Prefetch disabled');
    boot?.log('skip', 'Pipelines', 'Prefetch disabled');
  } else {
    boot?.log('skip', 'Plugins', 'Offline mode');
    boot?.log('skip', 'Pipelines', 'Offline mode');
  }

  if (!session.offline && prefetchFeeds) {
    const userFeedPath: string | undefined = currentContext.user
      ? `/home/${currentContext.user}/feeds`
      : undefined;
    if (userFeedPath) {
      const feedResult = await prefetch_withSpinner('Feeds', 'Prefetching user feeds', async () => {
        return await prefetch_path('Feeds', userFeedPath);
      });
      if (feedResult.ok) {
        cachedFeeds = feedResult.count;
        boot?.log('ok', 'Feeds', `Cached ${feedResult.count ?? 0} item(s) from ${userFeedPath}`);
      } else {
        boot?.log('fail', 'Feeds', feedResult.message || `Prefetch failed for ${userFeedPath}`);
      }
    } else {
      boot?.log('skip', 'Feeds', 'No user context');
    }
    if (prefetchPublicFeeds) {
      const publicResult = await prefetch_withSpinner('Public', 'Prefetching public feeds', async () => {
        return await prefetch_path('Public', '/PUBLIC');
      });
      if (publicResult.ok) {
        cachedPublic = publicResult.count;
        boot?.log('ok', 'Public', `Cached ${publicResult.count ?? 0} item(s) from /PUBLIC`);
      } else {
        boot?.log('fail', 'Public', publicResult.message || 'Prefetch failed for /PUBLIC');
      }
    }
  } else if (!session.offline) {
    boot?.log('skip', 'Feeds', 'Prefetch disabled');
  } else {
    boot?.log('skip', 'Feeds', 'Offline mode');
  }

  if (isInteractiveSession) {
    logo_animateStop();

    const headerItems: BootInfoItem3[] = [
      { app: 'chell', name: 'ChELL Executes Layered Logic',                    version: packageJson.version },
      { app: 'chili', name: 'ChILI handles Intelligent Line Interactions',     version: chiliJson.version   },
      { app: 'salsa', name: 'Salsa Abstracts Logic Service Assets',            version: salsaJson.version   },
      { app: 'cumin', name: 'Cumin Underpins Management Infrastructure Needs', version: cuminJson.version   },
    ];
    const localItems: BootInfoItem[] = [
      { label: 'System', value: `${os.platform()} ${os.release()} (${os.arch()})` },
      { label: 'User', value: `${os.userInfo().username}@${os.hostname()}` },
      ...(localIPv4_get() ? [{ label: 'Local', value: localIPv4_get() as string }] : []),
      { label: 'Time', value: localTime_withOffset() },
    ];
    const chrisItems: BootInfoItem[] = [];
    chrisItems.push({ label: 'ChRIS', value: currentContext.URL || 'offline' });
    chrisItems.push({ label: 'User', value: currentContext.user || 'offline' });
    chrisItems.push({ label: 'Mode', value: config.mode });
    if (typeof cachedPlugins === 'number') {
      chrisItems.push({ label: 'Plugins', value: `${cachedPlugins}` });
    }
    if (typeof cachedPipelines === 'number') {
      chrisItems.push({ label: 'Pipelines', value: `${cachedPipelines}` });
    }
    if (currentContext.plugin) {
      chrisItems.push({ label: 'Active Plugin', value: currentContext.plugin });
    }
    if (typeof cachedFeeds === 'number') {
      chrisItems.push({ label: 'User Feeds', value: `${cachedFeeds}` });
    }
    if (currentContext.feed) {
      const feedLabel: string = `${currentContext.feed}`;
      chrisItems.push({ label: 'Active Feed', value: feedLabel });
    }
    if (typeof cachedPublic === 'number') {
      chrisItems.push({ label: 'Public Feeds', value: `${cachedPublic}` });
    }
    if (currentContext.pacsserver) {
      chrisItems.push({ label: 'PACS Server', value: currentContext.pacsserver });
    }
    const folderDisplay: string = currentContext.folder ?? '/';
    chrisItems.push({ label: 'Path', value: folderDisplay });

    const panels: BootPanels = {
      header: headerItems,
      local: localItems,
      chris: chrisItems
    };
    // Render Neofetch informational boxes stacked under the boot messages (no duplicate logo rendering)
    bootsequence_printIntroPanelsStacked([], panels, !useAsciiBoot, useAsciiBoot);
  }

  console.log(chalk.yellow('Order up! Your Taco Chell is ready! Filled with chili, salsa, and cumin goodness! 🌮'));
  console.log('');
  if (isInteractiveSession) {
    if (session.offline) {
      console.log(chalk.yellow('You are currently disconnected. Use: connect --user <user> --password <pwd> <url>'));
    }
    console.log(chalk.gray("Tip: type 'help' for available commands."));
    console.log('');
  }

  const repl: REPL = new REPL();
  await repl.start(command_handle);
}
