/**
 * @file The chell engine facade: line execution and completion behind one
 * hostable interface.
 *
 * The engine is the seam between the shell's deterministic core (dispatch,
 * session, VFS) and whatever hosts it. The CLI REPL is one host; a session
 * daemon serving remote surfaces is the next. A host creates the engine,
 * installs an output sink, and drives it one line at a time:
 *
 * ```
 * const engine: BrasaEngine = await engine_create();
 * const envelopes: CommandEnvelope[] = await engine.line_execute('ls; pwd');
 * ```
 *
 * `line_execute` owns line-level orchestration — shell escape, semicolon
 * batching, redirects, pipes — and yields exactly one envelope per executed
 * command. Output is delivered through the active sink as each command
 * completes, so a terminal host sees output live; the returned envelopes are
 * the records an envelope-aware host (daemon, test) consumes.
 *
 * Single-command execution and the command table live in `./dispatch.js`;
 * this module deliberately keeps its cumin imports type-only.
 *
 * @see docs/calypso.adoc for the governing design.
 * @module
 */
import chalk from 'chalk';
import type { CommandEnvelope, Result } from '@fnndsc/cumin';
import { session } from '../session/index.js';
import { semicolons_parse } from '../lib/semicolonParser.js';
import {
  pipes_parse,
  redirect_parse,
  command_shellEscape_detect,
  type RedirectInfo,
} from './preprocess.js';
import {
  command_executeToEnvelope,
  command_timingMaybePrint,
  redirect_execute,
  pipe_execute,
} from './dispatch.js';
import { capability_require, surface_get } from './surface.js';
import { commandCancellation_request, commandCancellation_run } from './cancellation.js';
import { sink_get } from './sink.js';

/**
 * Result of a completion request: the candidates and the prefix they
 * complete, matching what a readline completer consumes.
 *
 * @property candidates - The matching completion candidates.
 * @property prefix - The input prefix the candidates complete.
 */
export interface CompletionResult {
  candidates: string[];
  prefix: string;
}

/**
 * The hostable shell engine.
 *
 * One engine serves one session: it executes command lines against the
 * shared session state and answers completion requests. Hosts own the
 * output destination (via the sink) and the input source (a readline loop,
 * a socket); the engine owns everything between.
 */
export interface BrasaEngine {
  /**
   * Executes one input line and returns one envelope per executed command.
   *
   * @param line - The raw input line (may contain `;`, `|`, `>`, `!`).
   * @returns The envelopes of the executed commands, in execution order.
   */
  line_execute(line: string): Promise<CommandEnvelope[]>;

  /**
   * Requests cancellation of the foreground command when it supports it.
   *
   * @returns True when the active command accepted the request.
   */
  line_cancel?(): boolean;

  /**
   * Computes completion candidates for a partial input line.
   *
   * @param linePrefix - The input line up to the cursor.
   * @returns The matching candidates and the prefix they complete.
   */
  line_complete(linePrefix: string): Promise<CompletionResult>;

  /**
   * Reads one ChRIS file's raw bytes, resolved against the session's
   * working directory. The seam a hosting daemon uses to serve file
   * content to surfaces that render it natively (an image in a browser
   * panel) rather than through a terminal stream.
   *
   * @param filePath - The file's path (absolute or cwd-relative).
   * @returns The file's bytes.
   */
  file_read?(filePath: string): Promise<Buffer>;
}

/**
 * Whether a batch (semicolon list, script) should abort on the first error.
 * Read by the batch loop; set by the boot layer for `-e` / script modes.
 */
let stopOnError: boolean = false;

/**
 * Sets the shared stop-on-error flag. Exposed so the boot layer (which owns
 * the `-e` flag and script execution) can drive the flag that the batch
 * loop reads.
 *
 * @param value - `true` to abort a batch on the first error.
 */
export function stopOnError_set(value: boolean): void {
  stopOnError = value;
}

/**
 * Executes a shell-escaped line (`!command`) on the host system.
 *
 * @param trimmedLine - The trimmed input line including the leading `!`.
 * @param startTime - Timing reference from `performance.now()`.
 * @param timingEnabled - Whether to print elapsed time after execution.
 * @returns One envelope carrying the host command's outcome, or none for a
 *   bare `!`.
 */
async function shellEscape_execute(
  trimmedLine: string,
  startTime: number,
  timingEnabled: boolean,
): Promise<CommandEnvelope[]> {
  const shellCommand: string = trimmedLine.substring(1).trim();
  if (!shellCommand) return [];
  try {
    capability_require('shellCommands', 'this surface cannot run shell commands');
    const exitCode: number = await surface_get().shellCommand(shellCommand);
    command_timingMaybePrint(startTime, timingEnabled);
    return [{ status: exitCode === 0 ? 'ok' : 'error', rendered: '' }];
  } catch (error: unknown) {
    const message: string = error instanceof Error ? error.message : String(error);
    return [{ status: 'error', rendered: '', renderedErr: `${chalk.red(`Shell command failed: ${message}`)}\n` }];
  }
}

/**
 * Executes a semicolon batch, one segment at a time, collecting each
 * segment's envelopes.
 *
 * A segment that throws yields an error envelope; the batch continues unless
 * stop-on-error is set, in which case the envelopes collected so far are
 * returned immediately (and no total time is printed, matching the shell's
 * historical behavior).
 *
 * @param commands - The batch segments in execution order.
 * @param startTime - Timing reference from `performance.now()`.
 * @param timingEnabled - Whether to print the batch's total elapsed time.
 * @returns The envelopes of all executed segments, in execution order.
 */
async function batch_execute(
  commands: string[],
  startTime: number,
  timingEnabled: boolean,
): Promise<CommandEnvelope[]> {
  const envelopes: CommandEnvelope[] = [];
  for (const command of commands) {
    try {
      envelopes.push(...await line_execute(command));
    } catch (error: unknown) {
      const msg: string = error instanceof Error ? error.message : String(error);
      sink_get().err_write(`${chalk.red(`Command error: ${msg}`)}\n`);
      envelopes.push({ status: 'error', rendered: '' });
      if (stopOnError) {
        return envelopes;
      }
    }
  }
  if (timingEnabled) {
    const elapsed: number = performance.now() - startTime;
    sink_get().data_write(`${chalk.gray(`[Total: ${elapsed.toFixed(2)}ms]`)}\n`);
  }
  return envelopes;
}

/**
 * Executes one input line and returns one envelope per executed command.
 *
 * Line-level constructs are recognized in the shell's historical order:
 * shell escape first (the whole line goes to the host shell), then
 * semicolon batching (each segment recurses through this function), then
 * pipes, then standalone output redirection, then plain dispatch. A redirect
 * in the final pipe segment therefore runs on the originating surface along
 * with that segment. Output reaches the
 * active sink as each command completes.
 *
 * @param line - The raw input line.
 * @returns The envelopes of the executed commands, in execution order.
 */
export async function line_execute(line: string): Promise<CommandEnvelope[]> {
  return await commandCancellation_run(async (): Promise<CommandEnvelope[]> => line_execute_run(line));
}

/**
 * Executes one line inside its already-established cancellation scope.
 *
 * @param line - The raw input line.
 * @returns The envelopes of the executed commands, in execution order.
 */
async function line_execute_run(line: string): Promise<CommandEnvelope[]> {
  const trimmedLine: string = line.trim();
  if (!trimmedLine) return [];

  // Start timing if enabled
  const timingEnabled: boolean = session.timingEnabled_get();
  const startTime: number = timingEnabled ? performance.now() : 0;

  if (command_shellEscape_detect(trimmedLine)) {
    return shellEscape_execute(trimmedLine, startTime, timingEnabled);
  }

  const batch: string[] = semicolons_parse(trimmedLine);
  if (batch.length > 1) {
    return batch_execute(batch, startTime, timingEnabled);
  }

  const pipeSegments: string[] = pipes_parse(trimmedLine);
  if (pipeSegments.length > 1) {
    try {
      const envelope: CommandEnvelope = await pipe_execute(pipeSegments);
      command_timingMaybePrint(startTime, timingEnabled);
      return [envelope];
    } catch (error: unknown) {
      const msg: string = error instanceof Error ? error.message : String(error);
      sink_get().err_write(`${chalk.red(`Pipe error: ${msg}`)}\n`);
      return [{ status: 'error', rendered: '' }];
    }
  }

  const redirectInfo: RedirectInfo | null = redirect_parse(trimmedLine);
  if (redirectInfo) {
    const envelope: CommandEnvelope = await redirect_execute(redirectInfo);
    if (envelope.status === 'ok') {
      command_timingMaybePrint(startTime, timingEnabled);
    }
    return [envelope];
  }

  const envelope: CommandEnvelope | null = await command_executeToEnvelope(trimmedLine, startTime, timingEnabled);
  return envelope ? [envelope] : [];
}

/**
 * Requests cancellation of the active foreground command.
 *
 * @returns True when a command can honor the request.
 */
export function line_cancel(): boolean {
  return commandCancellation_request();
}

/**
 * Computes completion candidates for a partial input line.
 *
 * Promise-shaped facade over the callback-style completer, for hosts that
 * answer completion requests asynchronously (a remote surface's tab press).
 * Completion failures resolve to no candidates; they never reject, matching
 * the completer's own never-crash contract.
 *
 * @param linePrefix - The input line up to the cursor.
 * @returns The matching candidates and the prefix they complete.
 */
export async function line_complete(linePrefix: string): Promise<CompletionResult> {
  const { input_complete } = await import('../lib/completer/index.js');
  return new Promise((resolve: (result: CompletionResult) => void) => {
    input_complete(linePrefix, (err: Error | null, result: [string[], string]) => {
      if (err || !result) {
        resolve({ candidates: [], prefix: linePrefix });
        return;
      }
      resolve({ candidates: result[0], prefix: result[1] });
    });
  });
}

/**
 * Handles a command entered by the user.
 *
 * Compatibility shape over {@link line_execute} for callers that do not
 * consume envelopes.
 *
 * @param line - The input line.
 * @returns A Promise that resolves once the command has been processed.
 */
export async function command_handle(line: string): Promise<void> {
  await line_execute(line);
}

/**
 * Registers the static VFS providers and the logical→physical path resolver
 * hook on the shared salsa vfsDispatcher.
 */
async function vfsProviders_register(): Promise<void> {
  const { vfsDispatcher } = await import('@fnndsc/salsa');
  const { StaticVfsProvider } = await import('../lib/vfs/providers/static.js');
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
 * Creates the engine: initializes session state, registers the VFS
 * providers, and returns the facade a host drives.
 *
 * Establishing a CUBE connection is deliberately not the engine's concern —
 * connection setup involves host-owned interaction (credential prompting,
 * boot reporting) and the engine executes correctly both offline and
 * connected.
 *
 * @returns The engine facade.
 */
export async function engine_create(): Promise<BrasaEngine> {
  await session.init();
  await vfsProviders_register();
  return { line_execute, line_cancel, line_complete, file_read };
}

/**
 * Reads one ChRIS file's raw bytes through ChILI, resolved against the
 * session's working directory.
 *
 * @param filePath - The file's path (absolute or cwd-relative).
 * @returns The file's bytes.
 * @throws {Error} When the path does not resolve to a readable file.
 */
export async function file_read(filePath: string): Promise<Buffer> {
  const { files_catBinary } = await import('@fnndsc/chili/commands/fs/cat.js');
  const result: Result<Buffer> = await files_catBinary(filePath);
  if (!result.ok) {
    throw new Error(`cannot read ${filePath}`);
  }
  return result.value;
}
