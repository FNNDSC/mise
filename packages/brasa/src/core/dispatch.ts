/**
 * @file Command dispatch for the ChELL shell.
 *
 * Turns one parsed command into an executed command with an envelope result:
 * - the built-in command table and dispatch to built-ins, simulated plugin exec, or `chili`
 * - output capture for the redirect/pipe paths
 * - envelope-producing execution used by the engine facade
 *
 * Line-level orchestration (shell escape, semicolon batching, redirect and
 * pipe detection) lives in `./engine.js`; the startup/connection/REPL glue
 * lives in `./boot.js`.
 *
 * @module
 */
import { writeFileSync, appendFileSync } from 'fs';
import chalk from 'chalk';
import { spawn, ChildProcess } from 'child_process';
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
  builtin_timing,
  builtin_whoami,
  builtin_whereami,
  builtin_version,
  builtin_debug,
  builtin_help,
  builtin_tree,
  builtin_du,
  builtin_store,
  error_stripDebugPrefix
} from '../builtins/index.js';
import { builtin_executePlugin } from '../builtins/pluginExecute.js';
import { builtin_proc } from '../builtins/proc.js';
import { wildcards_expandAll } from '../builtins/wildcard.js';
import { help_show, args_checkHasHelpFlag } from '../builtins/help.js';
import { pluginExecutable_handle } from '../builtins/executable.js';
import { Result, errorStack, Ok, Err, StackMessage, envelope_error } from '@fnndsc/cumin';
import type { CommandEnvelope } from '@fnndsc/cumin';
import { envelopeHandler_wrap, envelope_deliver, sink_get, PipeCaptureSink, sinkScope_run } from './sink.js';
import { vfs } from '../lib/vfs/vfs.js';
import { args_tokenize } from '../lib/parser.js';
import { surface_get, capability_require } from './surface.js';
import {
  redirectTarget_resolve,
  wildcards_expandCheck,
  type RedirectInfo,
} from './preprocess.js';
import { ListingItem } from '@fnndsc/chili/models/listing.js';
import { chiliCommand_run, chiliCommand_exists, chiliDelegationNotice_build } from './chiliDelegate.js';

export { chiliCommand_run };

/**
 * Handles a command chell does not recognize. If chili has no such command
 * either, reports `command not found` on the error channel and does not
 * delegate — no chili run, no context init. Otherwise emits the hand-off notice
 * on the live sink *before* running chili, so the notice appears ahead of
 * chili's (possibly slow) output rather than being glued on after it returns.
 *
 * @param command - The unrecognized command name.
 * @param args - The command's arguments.
 * @returns The delivered envelope (chili's result, or a not-found error).
 */
async function unknownCommand_delegate(command: string, args: string[]): Promise<CommandEnvelope> {
  if (!(await chiliCommand_exists(command))) {
    const envelope: CommandEnvelope = envelope_error(
      '',
      undefined,
      `${chalk.red(`chell: command not found: ${command}`)}\n`,
    );
    envelope_deliver(envelope);
    return envelope;
  }
  sink_get().data_write(chiliDelegationNotice_build(command));
  const chiliEnvelope: CommandEnvelope = await chiliCommand_run(command, ['-s', ...args]);
  envelope_deliver(chiliEnvelope);
  return chiliEnvelope;
}

/**
 * Executes a shell command on the host system (shell escape with ! prefix).
 *
 * @param shellCommand - The command to execute on the host shell.
 * @returns A Promise resolving to the command's exit code (1 on spawn failure).
 */
export async function shellCommand_execute(shellCommand: string): Promise<number> {
  return new Promise((resolve: (code: number) => void) => {
    const child: ChildProcess = spawn(shellCommand, {
      shell: true,
      stdio: 'inherit',
      env: process.env
    });

    child.on('close', (code: number | null) => {
      if (code !== null && code !== 0) {
        console.error(chalk.red(`Shell command exited with code ${code}`));
      }
      resolve(code ?? 0);
    });

    child.on('error', (err: Error) => {
      console.error(chalk.red(`Failed to execute shell command: ${err.message}`));
      resolve(1);
    });
  });
}

type CommandHandler = (args: string[]) => Promise<void>;

/**
 * Shape of a converted builtin: returns its outcome as an envelope instead
 * of printing. The engine layer will consume these directly; the dispatch
 * table below consumes them through {@link envelopeHandler_wrap}.
 */
type EnvelopeHandler = (args: string[]) => Promise<CommandEnvelope>;

/**
 * Builtins that have been converted to return envelopes, keyed by command
 * name. Entries here are also present in COMMAND_HANDLERS in wrapped form;
 * this registry exists so envelope-aware hosts can bypass the wrapper and
 * receive the structured result.
 */

export const ENVELOPE_HANDLERS: Record<string, EnvelopeHandler> = {
  cat: builtin_cat,
  cd: builtin_cd,
  cp: builtin_cp,
  mv: builtin_mv,
  rm: builtin_rm,
  mkdir: builtin_mkdir,
  touch: builtin_touch,
  pwd: builtin_pwd,
  whoami: builtin_whoami,
  whereami: builtin_whereami,
  timing: builtin_timing,
  physicalmode: builtin_physicalmode,
  debug: builtin_debug,
  version: builtin_version,
  ls: builtin_ls,
  tree: builtin_tree,
  du: builtin_du,
  help: builtin_help,
  proc: builtin_proc,
  logout: builtin_logout,
  cubepath: builtin_cubepath,
  query: builtin_query,
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
  context: builtin_context,
  parametersofplugin: builtin_parametersofplugin,
  plugin: builtin_plugin,
  plugins: builtin_plugin,
  pacsservers: (args: string[]): Promise<CommandEnvelope> => chiliCommand_run('pacsservers', ['-s', ...args]),
  pacsqueries: (args: string[]): Promise<CommandEnvelope> => chiliCommand_run('pacsqueries', ['-s', ...args]),
  pacsretrieve: (args: string[]): Promise<CommandEnvelope> => chiliCommand_run('pacsretrieve', ['-s', ...args]),
  connect: builtin_connect,
  upload: builtin_upload,
  download: builtin_download,
  store: builtin_store,
  edit: builtin_edit,
  pacs: builtin_pacs,
  pull: builtin_pull,
  pipeline: builtin_pipeline,
  pipelines: builtin_pipeline,
};

export const COMMAND_HANDLERS: Record<string, CommandHandler> = {
  connect: envelopeHandler_wrap(builtin_connect),
  logout: envelopeHandler_wrap(builtin_logout),
  cd: envelopeHandler_wrap(builtin_cd),
  ls: envelopeHandler_wrap(builtin_ls),
  pwd: envelopeHandler_wrap(builtin_pwd),
  cat: envelopeHandler_wrap(builtin_cat),
  rm: envelopeHandler_wrap(builtin_rm),
  cp: envelopeHandler_wrap(builtin_cp),
  mv: envelopeHandler_wrap(builtin_mv),
  touch: envelopeHandler_wrap(builtin_touch),
  mkdir: envelopeHandler_wrap(builtin_mkdir),
  upload: envelopeHandler_wrap(builtin_upload),
  pacs: envelopeHandler_wrap(builtin_pacs),
  pipeline: envelopeHandler_wrap(builtin_pipeline),
  pipelines: envelopeHandler_wrap(builtin_pipeline),
  pull: envelopeHandler_wrap(builtin_pull),
  query: envelopeHandler_wrap(builtin_query),
  cubepath: envelopeHandler_wrap(builtin_cubepath),
  download: envelopeHandler_wrap(builtin_download),
  edit: envelopeHandler_wrap(builtin_edit),
  context: envelopeHandler_wrap(builtin_context),
  parametersofplugin: envelopeHandler_wrap(builtin_parametersofplugin),
  physicalmode: envelopeHandler_wrap(builtin_physicalmode),
  timing: envelopeHandler_wrap(builtin_timing),
  whoami: envelopeHandler_wrap(builtin_whoami),
  whereami: envelopeHandler_wrap(builtin_whereami),
  debug: envelopeHandler_wrap(builtin_debug),
  help: envelopeHandler_wrap(builtin_help),
  proc: envelopeHandler_wrap(builtin_proc),
  tree: envelopeHandler_wrap(builtin_tree),
  du: envelopeHandler_wrap(builtin_du),
  store: envelopeHandler_wrap(builtin_store),
  plugin: envelopeHandler_wrap(builtin_plugin),
  plugins: envelopeHandler_wrap(builtin_plugin),
  feed: envelopeHandler_wrap(builtin_feed),
  feeds: envelopeHandler_wrap(builtin_feed),
  compute: envelopeHandler_wrap(builtin_compute),
  computes: envelopeHandler_wrap(builtin_compute),
  tag: envelopeHandler_wrap(builtin_tag),
  tags: envelopeHandler_wrap(builtin_tag),
  group: envelopeHandler_wrap(builtin_group),
  groups: envelopeHandler_wrap(builtin_group),
  pluginmeta: envelopeHandler_wrap(builtin_pluginmeta),
  pluginmetas: envelopeHandler_wrap(builtin_pluginmeta),
  meta: envelopeHandler_wrap(builtin_pluginmeta),
  metas: envelopeHandler_wrap(builtin_pluginmeta),
  plugininstance: envelopeHandler_wrap(builtin_plugininstance),
  plugininstances: envelopeHandler_wrap(builtin_plugininstance),
  instance: envelopeHandler_wrap(builtin_plugininstance),
  instances: envelopeHandler_wrap(builtin_plugininstance),
  job: envelopeHandler_wrap(builtin_plugininstance),
  jobs: envelopeHandler_wrap(builtin_plugininstance),
  workflow: envelopeHandler_wrap(builtin_workflow),
  workflows: envelopeHandler_wrap(builtin_workflow),
  files: envelopeHandler_wrap(builtin_files),
  links: envelopeHandler_wrap(builtin_links),
  dirs: envelopeHandler_wrap(builtin_dirs),
  pacsservers: envelopeHandler_wrap((args: string[]): Promise<CommandEnvelope> => chiliCommand_run('pacsservers', ['-s', ...args])),
  pacsqueries: envelopeHandler_wrap((args: string[]): Promise<CommandEnvelope> => chiliCommand_run('pacsqueries', ['-s', ...args])),
  pacsretrieve: envelopeHandler_wrap((args: string[]): Promise<CommandEnvelope> => chiliCommand_run('pacsretrieve', ['-s', ...args])),
};

export { COMMAND_HANDLERS_KEYS } from '../command-keys.js';

/**
 * Prints elapsed time since startTime if timing is enabled.
 *
 * @param startTime - Timestamp from `performance.now()` at command start.
 * @param enabled - Whether timing display is active.
 */
export function command_timingMaybePrint(startTime: number, enabled: boolean): void {
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
 * Expands `$NAME` and `${NAME}` environment references in one token.
 *
 * Applied per token after parsing, so an expanded value can never inject
 * command separators, pipes or redirects (the structural characters were
 * already consumed). References to unset variables are left verbatim —
 * kinder than the shell's silent empty string when a script forgets an
 * export. Shell-escape lines (`!...`) never reach this point; bash does
 * its own expansion there.
 *
 * @param token - A single parsed command token.
 * @returns The token with set environment references substituted.
 */
export function envRefs_expand(token: string): string {
  return token.replace(
    /\$(?:\{([A-Za-z_][A-Za-z0-9_]*)\}|([A-Za-z_][A-Za-z0-9_]*))/g,
    (match: string, braced: string | undefined, bare: string | undefined) => {
      const value: string | undefined = process.env[braced ?? bare ?? ''];
      return value !== undefined ? value : match;
    },
  );
}

/**
 * Reads the current process exit code as a number.
 *
 * @returns The exit code, treating an unset code as zero.
 */
function exitCode_read(): number {
  return typeof process.exitCode === 'number' ? process.exitCode : 0;
}

/**
 * Runs a legacy printing handler uncaptured and derives an envelope from the
 * exit-code delta.
 *
 * This is the passthrough for commands that cannot be captured yet: the
 * interactive holdouts (their prompts must reach the terminal) and the
 * progress writers (their live updates must stay live). The handler prints
 * exactly as it always has; the placeholder envelope records only the
 * outcome, with no rendered text, so envelope consumers never re-print what
 * the terminal already showed.
 *
 * @param handler - A legacy printing command handler.
 * @param args - Parsed arguments.
 * @returns A placeholder envelope carrying the command's outcome.
 */
async function handler_runDirect(handler: CommandHandler, args: string[]): Promise<CommandEnvelope> {
  const exitCodeBefore: number = exitCode_read();
  await handler(args);
  const exitCodeAfter: number = exitCode_read();
  const failed: boolean = exitCodeAfter !== 0 && exitCodeAfter !== exitCodeBefore;
  return { status: failed ? 'error' : 'ok', rendered: '' };
}

/**
 * Drains the errorStack from a checkpoint into an envelope's structured
 * `errors` field, and escalates status to `error` when an error-type message
 * was drained.
 *
 * This is the per-command error boundary: it captures exactly the messages a
 * command left on the stack, so a remote surface receives full error detail
 * with each result and stale errors cannot bleed into the next command.
 * Escalating status from a drained error is a reliable per-command failure
 * signal, independent of whether the command happened to change
 * `process.exitCode`.
 *
 * @param checkpoint - A checkpoint from `errorStack.checkpoint_mark()`.
 * @param envelope - The envelope to attach drained errors to.
 * @returns The same envelope, with errors and possibly status updated.
 */
function envelope_drainErrorsInto(checkpoint: number, envelope: CommandEnvelope): CommandEnvelope {
  const drained: StackMessage[] = errorStack.checkpoint_drain(checkpoint);
  if (drained.length > 0) {
    envelope.errors = drained;
    if (envelope.status === 'ok' && drained.some((message: StackMessage): boolean => message.type === 'error')) {
      envelope.status = 'error';
    }
  }
  return envelope;
}

/**
 * Dispatches a parsed command to its handler and returns its envelope, with
 * any errors the command left on the stack drained into the envelope.
 *
 * @param command - The command name.
 * @param args - Parsed arguments.
 * @returns The envelope of the executed command.
 */
export async function command_dispatchEnvelope(command: string, args: string[]): Promise<CommandEnvelope> {
  const checkpoint: number = errorStack.checkpoint_mark();
  const envelope: CommandEnvelope = await commandDispatchEnvelope_run(command, args);
  return envelope_drainErrorsInto(checkpoint, envelope);
}

/**
 * Runs the dispatch itself (without the error drain). Expands environment
 * references in the arguments, then checks ENVELOPE_HANDLERS, then
 * unconverted COMMAND_HANDLERS, then /bin plugin/pipeline names, then falls
 * back to chili through the capture bridge.
 *
 * Envelope-speaking handlers are delivered through the active sink here, so
 * direct execution prints exactly as it always has; unconverted handlers
 * print for themselves and yield a placeholder envelope.
 *
 * @param command - The command name.
 * @param args - Parsed arguments.
 * @returns The envelope of the executed command.
 */
async function commandDispatchEnvelope_run(command: string, args: string[]): Promise<CommandEnvelope> {
  if (command === 'exit') {
    process.exit(0);
  }
  args = args.map(envRefs_expand);

  const envelopeHandler: EnvelopeHandler | undefined = ENVELOPE_HANDLERS[command];
  if (envelopeHandler) {
    // A handler that resolves without an envelope (as stubbed handlers in
    // tests do) is treated as having produced no output.
    const envelope: CommandEnvelope | undefined = await envelopeHandler(args);
    if (!envelope) {
      return { status: 'ok', rendered: '' };
    }
    envelope_deliver(envelope);
    return envelope;
  }

  const handler: CommandHandler | undefined = COMMAND_HANDLERS[command];
  if (handler) {
    return handler_runDirect(handler, args);
  }

  const binResult: Result<ListingItem[]> = await vfs.data_get('/bin');
  if (binResult.ok) {
    const pluginItem: ListingItem | undefined = binResult.value.find(item => item.name === command && item.type === 'plugin');
    const pipelineItem: ListingItem | undefined = binResult.value.find(item => item.name === command && item.type === 'pipeline');

    if (pluginItem) {
      return handler_runDirect((pluginArgs: string[]): Promise<void> => builtin_executePlugin(command, pluginArgs), args);
    }

    if (pipelineItem) {
      return handler_runDirect((pipelineArgs: string[]): Promise<void> => pipelineExecutable_handle(command, pipelineArgs), args);
    }
  }

  // Unknown commands are guarded, then delegated to chili — its output is
  // captured through its own seam, with no console capture here.
  return unknownCommand_delegate(command, args);
}

/**
 * Dispatches a parsed command to its handler.
 *
 * Compatibility shape over {@link command_dispatchEnvelope} for callers that
 * do not consume envelopes.
 *
 * @param command - The command name.
 * @param args - Parsed arguments.
 * @returns A Promise that resolves once the command has been dispatched.
 */
export async function command_dispatch(command: string, args: string[]): Promise<void> {
  await command_dispatchEnvelope(command, args);
}

/**
 * Executes a redirected command (`>` / `>>`): captures the command's output
 * and writes it to the target file.
 *
 * @param redirectInfo - The parsed redirection (command, operator, target).
 * @returns An envelope recording the outcome; rendered text stays empty
 *   because the output went to the file, not the terminal.
 */
export async function redirect_execute(redirectInfo: RedirectInfo): Promise<CommandEnvelope> {
  const { buffer } = await chellCommand_executeAndCapture(redirectInfo.command);
  const targetResult: Result<string> = redirectTarget_resolve(redirectInfo.filePath, redirectInfo.command);
  if (!targetResult.ok) {
    const lastError: StackMessage | undefined = errorStack.stack_pop();
    console.error(chalk.red(lastError ? lastError.message : 'Redirect error'));
    return { status: 'error', rendered: '' };
  }
  if (redirectInfo.operator === '>') {
    writeFileSync(targetResult.value, buffer);
  } else {
    appendFileSync(targetResult.value, buffer);
  }
  return { status: 'ok', rendered: '' };
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

  if (command === 'exit') {
    process.exit(0);
  }

  // The command runs with its output captured into a pipe sink scoped to this
  // async context — no console monkeypatch. Envelope handlers deliver their
  // rendered text through the sink (ANSI-stripped for the plain-pipe contract);
  // streaming commands and binary cat write to the same sink directly (raw
  // bytes kept byte-for-byte). The err channel passes through to stderr live.
  const pipeSink: PipeCaptureSink = new PipeCaptureSink();
  await sinkScope_run(pipeSink, async (): Promise<void> => {
    const envelopeHandler: EnvelopeHandler | undefined = ENVELOPE_HANDLERS[command];
    if (envelopeHandler) {
      const envelope: CommandEnvelope | undefined = await envelopeHandler(args);
      if (envelope) {
        envelope_deliver(envelope);
      }
      return;
    }

    if (await pluginExecutable_handle(command, args, { piped: true })) {
      return;
    }

    const handler: CommandHandler | undefined = COMMAND_HANDLERS[command];
    if (handler) {
      await handler(args);
      return;
    }

    await unknownCommand_delegate(command, args);
  });

  const buffer: Buffer = pipeSink.buffer_get();
  return { text: buffer.toString('utf-8'), buffer };
}

/**
 * Executes a pipe chain by running the first command in chell and piping
 * through local tools, delivering the final output on the data channel.
 *
 * @param segments - Array of command segments separated by pipes.
 * @returns An envelope whose rendered text is the chain's final output.
 */
export async function pipe_execute(segments: string[]): Promise<CommandEnvelope> {
  if (segments.length === 0) {
    return { status: 'ok', rendered: '' };
  }

  // The first segment is a chell command run in-engine; the rest run through
  // the surface, so nothing spawns on a daemon host — a surface without the
  // capability (a browser) fails the pipeline with a clear message.
  if (segments.length > 1) {
    capability_require('pipeSegments', 'this surface cannot run pipeline segments');
  }

  // Execute first segment in chell and capture output
  const firstCommand: string = segments[0];
  const { buffer } = await chellCommand_executeAndCapture(firstCommand);

  // Chain remaining segments through the surface's own tools.
  let currentInput: Buffer = buffer;
  for (let i: number = 1; i < segments.length; i++) {
    currentInput = await surface_get().pipeSegment(segments[i], currentInput);
  }

  // Output final result
  sink_get().data_write(currentInput);
  return { status: 'ok', rendered: currentInput.toString('utf-8') };
}

/**
 * Executes one plain command line (no shell escape, batch, redirect or pipe)
 * and returns its envelope.
 *
 * Mirrors the historical direct-execution order exactly: help flag
 * short-circuit, wildcard expansion, simulated plugin execution, then table
 * dispatch. Timing is printed at the same points the shell always printed
 * it (after plugin execution or dispatch; never after help or a wildcard
 * failure).
 *
 * @param trimmedLine - The trimmed command line.
 * @param startTime - Timing reference from `performance.now()`.
 * @param timingEnabled - Whether to print elapsed time after execution.
 * @returns The command's envelope, or null when the line held no tokens.
 */
export async function command_executeToEnvelope(
  trimmedLine: string,
  startTime: number,
  timingEnabled: boolean,
): Promise<CommandEnvelope | null> {
  const tokens: string[] = args_tokenize(trimmedLine);
  if (tokens.length === 0) return null;
  let [command, ...args]: string[] = tokens;

  // Check for --help flag before any processing
  const helpResult: Result<boolean> = help_showMaybe(command, args);
  if (helpResult.ok && helpResult.value) {
    return { status: 'ok', rendered: '' };
  }

  // Expand wildcards for commands that support it
  const expandResult: Result<string[]> = await wildcards_expand(command, args);
  if (!expandResult.ok) {
    return { status: 'error', rendered: '' };
  }
  args = expandResult.value;

  // Attempt to handle as a simulated plugin execution. This path bypasses
  // command_dispatchEnvelope, so it drains the errorStack itself.
  const checkpoint: number = errorStack.checkpoint_mark();
  const exitCodeBefore: number = exitCode_read();
  if (await pluginExecutable_handle(command, args)) {
    command_timingMaybePrint(startTime, timingEnabled);
    const exitCodeAfter: number = exitCode_read();
    const failed: boolean = exitCodeAfter !== 0 && exitCodeAfter !== exitCodeBefore;
    return envelope_drainErrorsInto(checkpoint, { status: failed ? 'error' : 'ok', rendered: '' });
  }

  const envelope: CommandEnvelope = await command_dispatchEnvelope(command, args);
  command_timingMaybePrint(startTime, timingEnabled);
  return envelope;
}
