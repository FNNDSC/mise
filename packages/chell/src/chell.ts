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
import { writeFileSync, appendFileSync } from 'fs';
import chalk from 'chalk';
import { spawn, ChildProcess } from 'child_process';
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
import { Result, errorStack, Ok, Err, StackMessage } from '@fnndsc/cumin';
import { vfs } from './lib/vfs/vfs.js';
import { args_tokenize } from './lib/parser.js';
import { semicolons_parse } from './lib/semicolonParser.js';
import { segment_pipeThrough } from './lib/pipe.js';
import {
  pipes_parse,
  redirect_parse,
  redirectTarget_resolve,
  wildcards_expandCheck,
  command_shellEscape_detect,
  type RedirectInfo,
} from './core/preprocess.js';
import { ListingItem } from '@fnndsc/chili/models/listing.js';
import { run as chiliRun } from '@fnndsc/chili/run.js';

/**
 * Spawns the `chili` CLI as a child process.
 *
 * @param command - The command to run (e.g., "feeds").
 * @param args - The arguments to pass to the command.
 * @returns A Promise resolving when the child process exits.
 */
export async function chiliCommand_run(command: string, args: string[]): Promise<void> {
  // Run chili in-process. chili shares this process's cumin connection/context,
  // so there is no node subprocess to spawn and no per-command startup cost.
  try {
    await chiliRun([command, ...args]);
  } catch (err) {
    const message: string = err instanceof Error ? err.message : String(err);
    console.error(chalk.red(`chili command '${command}' failed: ${message}`));
  }
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
export async function command_handle(line: string): Promise<void> {
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

  console.log(chalk.yellow(`Unknown chell command '${command}' -- delegating to chili`));
  await chiliCommand_run(command, ['-s', ...args]);
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

    console.log(chalk.yellow(`Unknown chell command '${command}' -- delegating to chili`));
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
 * Whether a batch (semicolon list, script) should abort on the first error.
 * Read by {@link semicolons_handle}; set by the boot layer for `-e` / script modes.
 */
let stopOnError: boolean = false;

/**
 * Sets the shared stop-on-error flag. Exposed so the boot layer (which owns the
 * `-e` flag and script execution) can drive the flag that the dispatch layer reads.
 *
 * @param value - `true` to abort a batch on the first error.
 */
export function stopOnError_set(value: boolean): void {
  stopOnError = value;
}
