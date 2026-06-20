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
import { createRequire } from 'module';
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
  builtin_tag,
  builtin_group,
  builtin_pluginmeta,
  builtin_plugininstance,
  builtin_workflow,
  builtin_download,
  builtin_edit,
  builtin_files,
  builtin_links,
  builtin_dirs,
  builtin_context,
  builtin_parametersofplugin,
  builtin_physicalmode,
  builtin_prompt,
  builtin_timing,
  builtin_whoami,
  builtin_whereami,
  builtin_debug,
  builtin_help,
  builtin_tree,
  builtin_du,
  builtin_store,
  error_stripDebugPrefix
} from './builtins/index.js';
import { builtin_executePlugin } from './builtins/pluginExecute.js';
import { builtin_proc } from './builtins/proc.js';
import { wildcards_expandAll } from './builtins/wildcard.js';
import { help_show, args_checkHasHelpFlag } from './builtins/help.js';
import { pluginExecutable_handle } from './builtins/executable.js';
import { Result, errorStack, Ok, Err, StackMessage, Client } from '@fnndsc/cumin';
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
import { prefetch_path, prefetch_withSpinner, PrefetchResult } from './lib/prefetch.js';
import { segment_pipeThrough } from './lib/pipe.js';
import { bootFlags_compute, type BootFlags } from './core/bootFlags.js';
import { ListingItem } from '@fnndsc/chili/models/listing.js';
import { context_getSingle, procCache_refresh, procTopology_warmup } from '@fnndsc/salsa';
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

/**
 * Loads a dependency's package.json via node module resolution, so it works
 * whether the dep is nested or hoisted to a workspace-root node_modules.
 *
 * @param name - The package name (e.g. `@fnndsc/cumin`).
 * @returns The parsed package.json, or a fallback `{ name, version: 'unknown' }`.
 */
function depPackageJson_load(name: string): PackageJson {
  try {
    const req = createRequire(import.meta.url);
    return req(`${name}/package.json`) as PackageJson;
  } catch {
    return { name, version: 'unknown' };
  }
}

const packageJson: PackageJson = JSON.parse(readFileSync(path.resolve(__dirname, '../package.json'), 'utf-8'));
const cuminJson: PackageJson = depPackageJson_load('@fnndsc/cumin');
const salsaJson: PackageJson = depPackageJson_load('@fnndsc/salsa');
const chiliJson: PackageJson = depPackageJson_load('@fnndsc/chili');

/**
 * Spawns the `chili` CLI as a child process.
 *
 * @param command - The command to run (e.g., "feeds").
 * @param args - The arguments to pass to the command.
 * @returns A Promise resolving when the child process exits.
 */
export async function chiliCommand_run(command: string, args: string[]): Promise<void> {
  // Resolve chili's entry via node module resolution (works when installed from
  // npm); fall back to the sibling dev-tree path for local monorepo runs.
  let chiliPath: string;
  try {
    chiliPath = createRequire(import.meta.url).resolve('@fnndsc/chili');
  } catch {
    chiliPath = path.resolve(__dirname, '../../chili/dist/index.js');
  }
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
/** Parsed output-redirection: command plus target file and append/overwrite. */
interface RedirectInfo {
  command: string;
  operator: '>' | '>>';
  filePath: string;
}

function redirect_parse(line: string): RedirectInfo | null {
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
        const command: string = line.substring(0, i).trim();
        const filePath: string = line.substring(i + 2).trim();
        return { command, operator: '>>', filePath };
      }
      // Check for >
      else if (line[i] === '>') {
        const command: string = line.substring(0, i).trim();
        const filePath: string = line.substring(i + 1).trim();
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
    const nodeErr: NodeJS.ErrnoException = err as NodeJS.ErrnoException;
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
  upload: builtin_upload,
  pacs: builtin_pacs,
  pipeline: builtin_pipeline,
  pipelines: builtin_pipeline,
  pull: builtin_pull,
  query: builtin_query,
  cubepath: builtin_cubepath,
  download: builtin_download,
  edit: builtin_edit,
  context: builtin_context,
  parametersofplugin: builtin_parametersofplugin,
  physicalmode: builtin_physicalmode,
  prompt: builtin_prompt,
  timing: builtin_timing,
  whoami: builtin_whoami,
  whereami: builtin_whereami,
  debug: builtin_debug,
  help: builtin_help,
  proc: builtin_proc,
  tree: builtin_tree,
  du: builtin_du,
  store: builtin_store,
  plugin: builtin_plugin,
  plugins: builtin_plugin,
  feed: builtin_feed,
  feeds: builtin_feed,
  compute: builtin_compute,
  computes: builtin_compute,
  tag: builtin_tag,
  tags: builtin_tag,
  group: builtin_group,
  groups: builtin_group,
  pluginmeta: builtin_pluginmeta,
  pluginmetas: builtin_pluginmeta,
  meta: builtin_pluginmeta,
  metas: builtin_pluginmeta,
  plugininstance: builtin_plugininstance,
  plugininstances: builtin_plugininstance,
  instance: builtin_plugininstance,
  instances: builtin_plugininstance,
  job: builtin_plugininstance,
  jobs: builtin_plugininstance,
  workflow: builtin_workflow,
  workflows: builtin_workflow,
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

export { COMMAND_HANDLERS_KEYS } from './command-keys.js';

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

  const binResult: Result<ListingItem[]> = await vfs.data_get('/bin');
  if (binResult.ok) {
    const pluginItem: ListingItem | undefined = binResult.value.find(item => item.name === command && item.type === 'plugin');
    const pipelineItem: ListingItem | undefined = binResult.value.find(item => item.name === command && item.type === 'pipeline');

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
  const redirectInfo: RedirectInfo | null = redirect_parse(line);
  if (!redirectInfo) {
    return Ok(false);
  }
  const { buffer } = await chellCommand_executeAndCapture(redirectInfo.command);
  const targetResult: Result<string> = redirectTarget_resolve(redirectInfo.filePath, redirectInfo.command);
  if (!targetResult.ok) {
    const lastError: StackMessage | undefined = errorStack.stack_pop();
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
    const lastError: StackMessage | undefined = errorStack.stack_pop();
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
      const lastError: StackMessage | undefined = errorStack.stack_pop();
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
    currentInput = await segment_pipeThrough(segments[i], currentInput);
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

    const rl: readline.Interface = readline.createInterface({
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

interface BootCache {
  plugins?: number;
  pipelines?: number;
  feeds?: number;
  public?: number;
}

interface PrefetchFlags {
  plugins: boolean;
  feeds: boolean;
  publicFeeds: boolean;
  jobs: boolean;
}

/**
 * Warm the VFS cache for plugins, feeds, and jobs.
 *
 * @param flags       - Which resource types to prefetch.
 * @param user        - Authenticated ChRIS username (for feed path construction).
 * @param isInteractive - Whether to show spinners vs plain log lines.
 * @param boot        - Boot logger; null in non-interactive modes.
 * @returns Counts for each prefetched resource type.
 */
async function cache_prefetch(
  flags: PrefetchFlags,
  user: string | undefined,
  isInteractive: boolean,
  boot: BootLogger | null,
): Promise<BootCache> {
  const result: BootCache = {};

  // --- Plugins & Pipelines ---
  if (!session.offline && flags.plugins) {
    const r: PrefetchResult = await prefetch_withSpinner('Plugins', 'Prefetching /bin for completions', isInteractive, async () => {
      const vfsResult: Result<ListingItem[]> = await vfs.data_get('/bin');
      if (vfsResult.ok) {
        return {
          ok: true,
          count: vfsResult.value.filter((i: { type: string }) => i.type === 'plugin').length,
          pipelineCount: vfsResult.value.filter((i: { type: string }) => i.type === 'pipeline').length,
        };
      }
      const err: StackMessage | undefined = errorStack.stack_pop();
      return { ok: false, message: err ? error_stripDebugPrefix(err.message) : 'Failed to prefetch /bin' };
    });
    if (r.ok) {
      result.plugins = r.count;
      result.pipelines = r.pipelineCount;
      boot?.log('ok', 'Plugins',   `Cached ${r.count         ?? 0} plugin(s)`);
      boot?.log('ok', 'Pipelines', `Cached ${r.pipelineCount ?? 0} pipeline(s)`);
    } else {
      boot?.log('fail', 'Plugins', r.message || 'Failed to prefetch /bin');
    }
  } else if (!session.offline) {
    boot?.log('skip', 'Plugins',   'Prefetch disabled');
    boot?.log('skip', 'Pipelines', 'Prefetch disabled');
  } else {
    boot?.log('skip', 'Plugins',   'Offline mode');
    boot?.log('skip', 'Pipelines', 'Offline mode');
  }

  // --- Feeds ---
  if (!session.offline && flags.feeds) {
    const feedPath: string | undefined = user ? `/home/${user}/feeds` : undefined;
    if (feedPath) {
      const r: PrefetchResult = await prefetch_withSpinner('Feeds', 'Prefetching user feeds', isInteractive, () => prefetch_path(feedPath));
      if (r.ok) {
        result.feeds = r.count;
        boot?.log('ok',   'Feeds', `Cached ${r.count ?? 0} item(s) from ${feedPath}`);
      } else {
        boot?.log('fail', 'Feeds', r.message || `Prefetch failed for ${feedPath}`);
      }
    } else {
      boot?.log('skip', 'Feeds', 'No user context');
    }
    if (flags.publicFeeds) {
      const r: PrefetchResult = await prefetch_withSpinner('Public', 'Prefetching public feeds', isInteractive, () => prefetch_path('/PUBLIC'));
      if (r.ok) {
        result.public = r.count;
        boot?.log('ok',   'Public', `Cached ${r.count ?? 0} item(s) from /PUBLIC`);
      } else {
        boot?.log('fail', 'Public', r.message || 'Prefetch failed for /PUBLIC');
      }
    }
  } else if (!session.offline) {
    boot?.log('skip', 'Feeds', 'Prefetch disabled');
  } else {
    boot?.log('skip', 'Feeds', 'Offline mode');
  }

  // --- Jobs ---
  if (!session.offline && flags.jobs) {
    const r: PrefetchResult = await prefetch_withSpinner('Jobs', 'Indexing /proc/jobs (feed list)...', isInteractive, async () => {
      try {
        await procCache_refresh();
        const { procCache_get } = await import('@fnndsc/cumin');
        return { ok: true, count: procCache_get().feedIDs_get().length };
      } catch (err: unknown) {
        const msg: string = err instanceof Error ? err.message : String(err);
        return { ok: false, message: msg };
      }
    });
    if (r.ok) {
      boot?.log('ok',   'Jobs', `Indexed ${r.count ?? 0} feed(s) — topology warming in background`);
    } else {
      boot?.log('fail', 'Jobs', r.message || 'Failed to index /proc/jobs');
    }
  } else if (!session.offline) {
    boot?.log('skip', 'Jobs', 'Prefetch disabled');
  } else {
    boot?.log('skip', 'Jobs', 'Offline mode');
  }

  return result;
}

/**
 * Assemble and render the Neofetch-style boot info panels.
 *
 * @param context    - Current ChRIS session context.
 * @param mode       - Shell mode string (e.g. 'interactive').
 * @param cache      - Prefetch counts for the panel's ChRIS section.
 * @param useAsciiBoot - Render ASCII box-drawing instead of Unicode.
 */
function bootPanels_render(
  context: SingleContext,
  mode: string,
  cache: BootCache,
  useAsciiBoot: boolean,
): void {
  const headerItems: BootInfoItem3[] = [
    { app: 'chell', name: 'ChELL Executes Layered Logic',                    version: packageJson.version },
    { app: 'chili', name: 'ChILI handles Intelligent Line Interactions',     version: chiliJson.version   },
    { app: 'salsa', name: 'Salsa Abstracts Logic Service Assets',            version: salsaJson.version   },
    { app: 'cumin', name: 'Cumin Underpins Management Infrastructure Needs', version: cuminJson.version   },
  ];

  const localItems: BootInfoItem[] = [
    { label: 'System', value: `${os.platform()} ${os.release()} (${os.arch()})` },
    { label: 'User',   value: `${os.userInfo().username}@${os.hostname()}` },
    ...(localIPv4_get() ? [{ label: 'Local', value: localIPv4_get() as string }] : []),
    { label: 'Time',   value: localTime_withOffset() },
  ];

  const maxItemLen: number = Math.max(30, (process.stdout.columns || 100) - 20);
  const str_truncate = (s: string): string => s.length > maxItemLen ? `…${s.slice(-(maxItemLen - 1))}` : s;

  const chrisItems: BootInfoItem[] = [
    { label: 'ChRIS', value: str_truncate(context.URL || 'offline') },
    { label: 'User',  value: context.user || 'offline' },
    { label: 'Mode',  value: mode },
  ];

  if (typeof cache.plugins   === 'number') chrisItems.push({ label: 'Plugins',      value: `${cache.plugins}`   });
  if (typeof cache.pipelines === 'number') chrisItems.push({ label: 'Pipelines',    value: `${cache.pipelines}` });
  if (context.plugin)                      chrisItems.push({ label: 'Active Plugin', value: context.plugin       });
  if (typeof cache.feeds     === 'number') chrisItems.push({ label: 'User Feeds',   value: `${cache.feeds}`     });
  if (context.feed)                        chrisItems.push({ label: 'Active Feed',  value: `${context.feed}`    });
  if (typeof cache.public    === 'number') chrisItems.push({ label: 'Public Feeds', value: `${cache.public}`    });
  if (context.pacsserver)                  chrisItems.push({ label: 'PACS Server',  value: context.pacsserver   });

  chrisItems.push({ label: 'Path', value: str_truncate(context.folder ?? '/') });

  const panels: BootPanels = { header: headerItems, local: localItems, chris: chrisItems };
  bootsequence_printIntroPanelsStacked([], panels, !useAsciiBoot, useAsciiBoot);
}

/**
 * Returns the first non-internal IPv4 address of the local machine, or null if none found.
 */
function localIPv4_get(): string | null {
  const interfaces: NodeJS.Dict<os.NetworkInterfaceInfo[]> = os.networkInterfaces();
  for (const key of Object.keys(interfaces)) {
    const iface: os.NetworkInterfaceInfo[] | undefined = interfaces[key];
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

type BootLogger = ReturnType<typeof bootLogger_create>;

/**
 * Connect using explicit CLI credentials. Returns Err() on unrecoverable failure.
 */
async function connection_fromArgs(
  config: ChellCLIConfig,
  boot: BootLogger | null,
): Promise<Result<SingleContext>> {
  let { user, password, url } = config.connectConfig!;

  if (!user) {
    console.error(chalk.red('Error: Username required when connecting via CLI args.'));
    return Err();
  }

  if (!password && url && config.mode !== 'execute' && config.mode !== 'script') {
    password = await password_prompt(user, url);
  }

  if (!password && config.mode === 'execute') {
    console.error(chalk.red('Error: Password required for connection in execute mode.'));
    return Err();
  }

  if (!url || !password) {
    return Ok(await context_getSingle());
  }

  spinner.start(`Establishing uplink to ${url}`);
  try {
    await session.connection.connection_connect({ user: user!, password, url, debug: false });
    session.offline = false;
    await chrisContext.current_set(Context.ChRISuser, user!);
    await chrisContext.current_set(Context.ChRISURL, url);
    await chrisContext.current_set(Context.ChRISfolder, '/');
    await chrisContext.current_set(Context.ChRISfeed, '');
    await chrisContext.current_set(Context.ChRISplugin, '');
    spinner.stop();
    if (config.mode !== 'execute' && config.mode !== 'script') {
      console.log(chalk.green('[+] Connection established.'));
    }
    boot?.log('ok', 'Connect', `Connected to ${url}`);
    return Ok(await context_getSingle());
  } catch (error: unknown) {
    spinner.stop();
    const errorMessage: string = error instanceof Error ? error.message : String(error);
    console.error(chalk.red(`[!] Connection failed: ${errorMessage}`));
    boot?.log('fail', 'Connect', errorMessage);
    return Err();
  }
}

/**
 * Restore a saved session from disk. Always succeeds — falls back to offline mode.
 */
async function connection_fromSavedSession(
  config: ChellCLIConfig,
  boot: BootLogger | null,
): Promise<SingleContext> {
  spinner.start('Checking for previous context');
  spinner.stop();

  const ctx: SingleContext = await context_getSingle();

  if (!ctx.user || !ctx.URL) {
    if (config.mode !== 'execute' && config.mode !== 'script') {
      console.log(chalk.yellow('[!] No previous context found'));
    }
    return ctx;
  }

  if (config.mode !== 'execute' && config.mode !== 'script') {
    console.log(chalk.green('[+] Previous context detected'));
    console.log(chalk.gray(`    User: ${chalk.cyan(ctx.user)}`));
    console.log(chalk.gray(`    URL:  ${chalk.cyan(ctx.URL)}`));
  }

  spinner.start('Validating existing token');
  const token: string | null = await session.connection.authToken_get(true);
  spinner.stop();

  if (!token) {
    console.log(chalk.yellow('[!] No token found'));
    console.log(chalk.yellow('[!] Running in disconnected mode'));
    session.offline = true;
    console.log(chalk.gray(`    Use: connect --user ${ctx.user} --password <pwd> ${ctx.URL}`));
    boot?.log('skip', 'Session', 'No saved token; offline');
    return ctx;
  }

  spinner.start(`Testing connection to ${ctx.URL}`);
  try {
    const client: Client | null = await session.connection.client_get();
    if (!client) {
      spinner.stop();
      console.log(chalk.yellow('[!] Failed to create client'));
      console.log(chalk.yellow('[!] Running in disconnected mode'));
      session.offline = true;
      console.log(chalk.gray(`    Use: connect --user ${ctx.user} --password <pwd> ${ctx.URL}`));
      return ctx;
    }
    await client.getUser();
    spinner.stop();
    if (config.mode !== 'execute' && config.mode !== 'script') {
      console.log(chalk.green('[+] Token validated with server'));
      console.log(chalk.green('[+] Session restored'));
      boot?.log('ok', 'Session', `Restored ${ctx.user}@${ctx.URL}`);
    }
  } catch (error: unknown) {
    spinner.stop();
    const msg: string = error instanceof Error ? error.message : String(error);
    console.log(chalk.yellow('[!] Token expired or invalid'));
    console.log(chalk.gray(`    Error: ${msg}`));
    console.log(chalk.yellow('[!] Running in disconnected mode'));
    session.offline = true;
    console.log(chalk.gray(`    Use: connect --user ${ctx.user} --password <pwd> ${ctx.URL}`));
  }

  return ctx;
}

/**
 * Establish a ChRIS connection: explicit CLI args or saved session restore.
 *
 * @param config - Parsed CLI config.
 * @param boot   - Boot logger; null in non-interactive modes.
 * @returns Ok(context) on success; Err() on unrecoverable failure (caller should exit).
 */
async function connection_establish(
  config: ChellCLIConfig,
  boot: BootLogger | null,
): Promise<Result<SingleContext>> {
  if (config.connectConfig) {
    return await connection_fromArgs(config, boot);
  }

  const ctx: SingleContext = await connection_fromSavedSession(config, boot);
  if (!ctx.user || !ctx.URL) {
    if (!session.offline) {
      console.log(chalk.yellow('[!] Running in disconnected mode.'));
      session.offline = true;
    }
  }
  return Ok(ctx);
}

/**
 * Registers the static VFS providers and the logical→physical path resolver
 * hook on the shared salsa vfsDispatcher.
 */
async function vfsProviders_register(): Promise<void> {
  const { vfsDispatcher } = await import('@fnndsc/salsa');
  const { StaticVfsProvider } = await import('./lib/vfs/providers/static.js');
  vfsDispatcher.provider_register(new StaticVfsProvider('/bin'));
  vfsDispatcher.provider_register(new StaticVfsProvider('/usr'));
  vfsDispatcher.provider_register(new StaticVfsProvider('/usr/bin'));

  vfsDispatcher.pathResolver_register(async (logicalPath: string): Promise<string> => {
    if (session.physicalMode_get()) {
      return logicalPath;
    }
    const { logical_toPhysical } = await import('@fnndsc/chili/utils');
    const res: Result<string> = await logical_toPhysical(logicalPath);
    if (res.ok) {
      return res.value;
    }
    throw new Error(`Logical-to-physical resolution failed for path: ${logicalPath}`);
  });
}

/**
 * Runs the interactive session: prefetches the boot cache, renders the boot
 * panels and greeting, kicks off non-blocking topology warm-up, and enters the
 * REPL loop.
 *
 * @param config - The parsed CLI config.
 * @param currentContext - The resolved session context.
 * @param flags - Prefetch/interactivity boot flags.
 * @param boot - The boot logger, or null when non-interactive.
 */
async function interactiveSession_run(
  config: ChellCLIConfig,
  currentContext: SingleContext,
  flags: Pick<BootFlags, 'prefetchPlugins' | 'prefetchFeeds' | 'prefetchPublicFeeds' | 'prefetchJobs' | 'isInteractiveSession' | 'useAsciiBoot'>,
  boot: ReturnType<typeof bootLogger_create> | null,
): Promise<void> {
  const cache: BootCache = await cache_prefetch(
    { plugins: flags.prefetchPlugins, feeds: flags.prefetchFeeds, publicFeeds: flags.prefetchPublicFeeds, jobs: flags.prefetchJobs },
    currentContext.user ?? undefined,
    flags.isInteractiveSession,
    boot,
  );

  if (flags.isInteractiveSession) {
    logo_animateStop();
    bootPanels_render(
      currentContext,
      config.mode,
      cache,
      flags.useAsciiBoot,
    );
  }

  console.log(chalk.yellow('Order up! Your Taco Chell is ready! Filled with chili, salsa, and cumin goodness! 🌮'));
  console.log('');
  if (flags.isInteractiveSession) {
    if (session.offline) {
      console.log(chalk.yellow('You are currently disconnected. Use: connect --user <user> --password <pwd> <url>'));
    }
    console.log(chalk.gray("Tip: type 'help' for available commands."));
    console.log('');
  }

  // Fire instance topology warm-up — does NOT block the REPL.
  // Progress is shown in the prompt as [proc: N/total] until complete.
  if (!session.offline && flags.prefetchJobs) {
    procTopology_warmup().catch(() => { /* non-fatal */ });
  }

  const repl: REPL = new REPL();
  await repl.start(command_handle);
}

/**
 * Starts the ChELL REPL.
 * Initializes connection and enters the command loop.
 *
 * @returns A Promise that resolves when the shell exits.
 */
export async function chell_start(): Promise<void> {
  const config: ChellCLIConfig = await cli_parse(process.argv, packageJson.version);
  const {
    isInteractiveSession,
    useAsciiBoot,
    prefetchPlugins,
    prefetchFeeds,
    prefetchPublicFeeds,
    prefetchJobs,
    showLogo,
  }: BootFlags = bootFlags_compute(config, !!process.stdout.isTTY);
  const boot: ReturnType<typeof bootLogger_create> | null = isInteractiveSession ? bootLogger_create('ChELL Boot', useAsciiBoot) : null;

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

  await vfsProviders_register();

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

  const ctxResult: Result<SingleContext> = await connection_establish(config, boot);
  if (!ctxResult.ok) process.exit(1);
  let currentContext: SingleContext = ctxResult.value;
  if (!currentContext.folder) {
    currentContext = { ...currentContext, folder: '/' };
  }

  // Login phase complete — start the brain activity animation now
  if (isInteractiveSession && showLogo && !useAsciiBoot) {
    logo_animatePulse();
  }


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

  await interactiveSession_run(
    config,
    currentContext,
    { prefetchPlugins, prefetchFeeds, prefetchPublicFeeds, prefetchJobs, isInteractiveSession, useAsciiBoot },
    boot,
  );
}
