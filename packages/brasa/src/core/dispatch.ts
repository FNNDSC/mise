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
import { commands_register, commandOrder_set, envelopeHandler_get, plainHandler_get, builtinCommand_has, type CommandHandler, type EnvelopeHandler } from './commandRegistry.js';
import { coreCommands } from './coreCommands.js';
import { ENVELOPE_ORDER, PLAIN_ORDER, HELP_ORDER } from './commandOrder.js';




import { stdin_set } from '../builtins/games/stdin.js';

import { writeFileSync, appendFileSync } from 'fs';
import chalk from 'chalk';
import {
  builtin_pipeline,
  error_stripDebugPrefix,
} from '../builtins/index.js';
import { builtin_executePlugin } from '../builtins/pluginExecute.js';

import { shellWords_expand } from '../builtins/wildcard.js';
import {
  help_render,
  commandHelp_get,
  pipelineExecutableHelp_render,
  args_checkHasHelpFlag,
} from '../builtins/help.js';
import { pluginExecutable_handle } from '../builtins/executable.js';
import { Result, errorStack, Ok, Err, StackMessage, envelope_error } from '@fnndsc/cumin';
import type { CommandEnvelope } from '@fnndsc/cumin';
import { envelopeHandler_wrap, envelope_deliver, sink_get, PipeCaptureSink, sinkScope_run } from './sink.js';
import { reference_refusal, reference_resolve, unresolvedStands_get, verbInHand_set } from './expansion.js';
import { answer_note, answerConsulted_take, type SessionAnswer } from '../session/answer.js';
import { vfs } from '../lib/vfs/vfs.js';
import {
  shellWords_referencesExpand,
  shellWords_tokenize,
  shellWords_values,
  type ShellArguments,
  type ReferenceExpansion,
  type ShellWord,
} from '../lib/parser.js';
import { surface_get, capability_require } from './surface.js';
import { sudoCommand_run } from './elevation.js';
import {
  redirectTarget_resolve,
  pathnameExpansion_isEligible,
  type RedirectInfo,
} from './preprocess.js';
import type { ListingItem } from '@fnndsc/menu';
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
 * Shape of a converted builtin: returns its outcome as an envelope instead
 * of printing. The engine layer will consume these directly; the dispatch
 * table below consumes them through {@link envelopeHandler_wrap}.
 */

// The engine registers its core commands and the order commands list in; a
// backend registers its own beside them (the ChRIS backend's from brasa's
// entry). Every lookup below goes through the registry.
commands_register(coreCommands);
commandOrder_set({ envelope: ENVELOPE_ORDER, plain: PLAIN_ORDER, help: HELP_ORDER });

export { ENVELOPE_HANDLERS, COMMAND_HANDLERS } from './commandRegistry.js';

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
  sink_get().data_write(`${chalk.gray(`[${elapsed.toFixed(2)}ms]`)}\n`);
}

/**
 * Handles a pipeline name invoked directly as an executable from /bin.
 * Routes flag combinations to the appropriate pipeline subcommand:
 *   --diagram             → pipeline diagram (preserving renderer flags)
 *   --signalflow          → pipeline diagram --signalflow
 *   --help / -h           → contextual pipeline-executable help
 *   --nodes / --parameters → pipeline info
 *   --manifest             → pipeline manifest
 *   --source / --readme    → pipeline source
 *   (bare or --compute)    → pipeline run
 *
 * @param name - The pipeline name as typed.
 * @param args - Arguments following the pipeline name.
 * @returns The pipeline builtin's envelope, preserving diagram models and text.
 */
async function pipelineExecutable_handle(name: string, args: string[]): Promise<CommandEnvelope> {
  const exitCodeBefore: number = exitCode_read();
  let envelope: CommandEnvelope | undefined;
  if (args.includes('--help') || args.includes('-h')) {
    envelope = { status: 'ok', rendered: pipelineExecutableHelp_render(name) };
  } else if (args.includes('--diagram')) {
    const diagramArgs: string[] = args.filter((argument: string): boolean => argument !== '--diagram');
    envelope = await builtin_pipeline(['diagram', name, ...diagramArgs]);
  } else if (args.includes('--signalflow')) {
    envelope = await builtin_pipeline(['diagram', name, '--signalflow']);
  } else if (args.includes('--manifest')) {
    envelope = await builtin_pipeline(['manifest', name]);
  } else if (args.includes('--nodes') || args.includes('--parameters')) {
    envelope = await builtin_pipeline(['info', name]);
  } else if (args.includes('--source') || args.includes('--readme')) {
    envelope = await builtin_pipeline(['source', name]);
  } else {
    envelope = await builtin_pipeline(['run', name, ...args]);
  }
  const result: CommandEnvelope = envelope ?? { status: 'ok', rendered: '' };
  const exitCodeAfter: number = exitCode_read();
  if (exitCodeAfter !== 0 && exitCodeAfter !== exitCodeBefore) result.status = 'error';
  return result;
}

interface BinExecutableMatches {
  plugin: ListingItem | undefined;
  pipeline: ListingItem | undefined;
}

/**
 * Finds exact plugin and pipeline executable matches in the virtual `/bin`.
 *
 * @param command - Executable name as typed.
 * @returns Matching dynamic executable entries, if the listing is available.
 */
async function binExecutableMatches_get(command: string): Promise<BinExecutableMatches> {
  const binResult: Result<ListingItem[]> = await vfs.data_get('/bin');
  if (!binResult.ok) {
    return { plugin: undefined, pipeline: undefined };
  }
  return {
    plugin: binResult.value.find(
      (item: ListingItem): boolean => item.name === command && item.type === 'plugin',
    ),
    pipeline: binResult.value.find(
      (item: ListingItem): boolean => item.name === command && item.type === 'pipeline',
    ),
  };
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
 * Runs a printing handler uncaptured, preserving an explicit envelope or
 * deriving one from the exit-code delta for legacy handlers.
 *
 * This is the passthrough for commands that cannot be captured yet: the
 * interactive holdouts (their prompts must reach the terminal) and the
 * progress writers (their live updates must stay live). The handler prints
 * exactly as it always has; the placeholder envelope records only the
 * outcome, with no rendered text, so envelope consumers never re-print what
 * the terminal already showed. Migrated handlers may return that envelope
 * directly while retaining the same live-output behavior.
 *
 * @param handler - A legacy printing command handler.
 * @param args - Parsed arguments.
 * @returns A placeholder envelope carrying the command's outcome.
 */
async function handler_runDirect(handler: CommandHandler, args: string[]): Promise<CommandEnvelope> {
  const exitCodeBefore: number = exitCode_read();
  const explicitEnvelope: void | CommandEnvelope = await handler(args);
  if (explicitEnvelope !== undefined) return explicitEnvelope;
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
 * references in the arguments, then checks the registry's envelope handlers,
 * then its plain handlers, then /bin plugin/pipeline names, then falls
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

  if (command === 'sudo') {
    return await sudoCommand_run(args, commandDispatchEnvelope_run);
  }

  const envelopeHandler: EnvelopeHandler | undefined = envelopeHandler_get(command);
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

  const handler: CommandHandler | undefined = plainHandler_get(command);
  if (handler) {
    return handler_runDirect(handler, args);
  }

  const binMatches: BinExecutableMatches = await binExecutableMatches_get(command);
  if (binMatches.plugin) {
    return handler_runDirect(
      (pluginArgs: string[]): Promise<CommandEnvelope> => builtin_executePlugin(command, pluginArgs),
      args,
    );
  }

  if (binMatches.pipeline) {
    const envelope: CommandEnvelope = await pipelineExecutable_handle(command, args);
    envelope_deliver(envelope);
    return envelope;
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
    sink_get().err_write(`${chalk.red(lastError ? lastError.message : 'Redirect error')}\n`);
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
 * Builds a help envelope for a command if `--help` or `-h` is present in its
 * args, delivering it through the sink so the output reaches the active surface
 * (a remote client over the daemon) rather than the daemon's own terminal.
 *
 * @param command - The command name (used to look up help text).
 * @param args - Parsed argument list.
 * @returns The delivered help envelope, or null if no help flag was present.
 * The promise resolves after dynamic `/bin` pipeline discovery when needed.
 */
async function helpEnvelope_maybe(command: string, args: string[]): Promise<CommandEnvelope | null> {
  if (!args_checkHasHelpFlag(args, command)) {
    return null;
  }
  let rendered: string;
  if (commandHelp_get(command) !== undefined) {
    rendered = help_render(command);
  } else {
    const binMatches: BinExecutableMatches = await binExecutableMatches_get(command);
    rendered = binMatches.pipeline
      ? pipelineExecutableHelp_render(command)
      : help_render(command);
  }
  const envelope: CommandEnvelope = { status: 'ok', rendered };
  envelope_deliver(envelope);
  return envelope;
}

/**
 * Expands eligible shell words in the ChELL CFS/VFS namespace.
 *
 * @param command - Command word being executed.
 * @param args - Parsed argument words.
 * @returns Expanded compatibility arguments with expansion provenance.
 */
/**
 * Resolves the references in a whole command line, the command word included.
 *
 * A shell runs `$CMD arg`, and a manifest names its plugin as a parameter
 * (`@param ANON = pl-pfdicom_tagSub-v3.3.4`) for exactly that reason: the
 * same workflow on another CUBE supplies its own build. Expanding only the
 * arguments left the command word as written, and the line refused with
 * "command not found: ${ANON}".
 *
 * @param words - The line's tokenized words.
 * @returns The words with references resolved, or a refusal naming the one
 *   nothing could answer.
 */
async function commandLine_referencesExpand(words: readonly ShellWord[]): Promise<Result<ShellWord[]>> {
  // The verb is known before its operands expand, so an index can be
  // refused by KIND: IMAGE given a study says so, instead of resolving to
  // a path and failing later for a reason that names nothing typed. A
  // `sudo` line's verb is the one after it.
  const verb: string | undefined = words[0]?.value === 'sudo' ? words[1]?.value : words[0]?.value;
  verbInHand_set(verb ?? null);
  const expanded: ReferenceExpansion = await shellWords_referencesExpand(
    words,
    reference_resolve,
    unresolvedStands_get(),
  );
  verbInHand_set(null);
  if (!expanded.ok) {
    errorStack.stack_push('error', reference_refusal(expanded.missing));
    return Err();
  }
  return Ok(expanded.words);
}

async function commandWords_expand(
  command: string,
  args: readonly ShellWord[],
): Promise<Result<ShellArguments>> {
  const sudoNestedCommand: ShellWord | undefined = command === 'sudo' ? args[0] : undefined;
  const targetCommand: string = sudoNestedCommand?.value ?? command;

  const targetArgs: readonly ShellWord[] = sudoNestedCommand ? args.slice(1) : args;
  const values: string[] = targetArgs.map((word: ShellWord): string => word.value);
  const result: Result<ShellWord[]> = await shellWords_expand(
    targetArgs,
    (_word: ShellWord, index: number): boolean => pathnameExpansion_isEligible(
      targetCommand,
      index,
      targetArgs.length,
      values,
    ),
  );
  if (!result.ok) return result;
  const expandedWords: ShellWord[] = sudoNestedCommand
    ? [sudoNestedCommand, ...result.value]
    : result.value;
  return Ok(shellWords_values(expandedWords));
}

/**
 * Executes a chell command and captures its output.
 * Consults the command registry — the single source of truth — so the pipe path
 * is always consistent with the direct-execution path.
 *
 * @param commandLine - The command line to execute.
 * @returns The captured output as text and raw buffer.
 */
async function chellCommand_executeAndCapture(commandLine: string): Promise<{ text: string; buffer: Buffer }> {
  const trimmedLine: string = commandLine.trim();
  if (!trimmedLine) return { text: '', buffer: Buffer.alloc(0) };

  const tokenized: ShellWord[] = shellWords_tokenize(trimmedLine);
  if (tokenized.length === 0) {
    return { text: '', buffer: Buffer.alloc(0) };
  }
  const referenced: Result<ShellWord[]> = await commandLine_referencesExpand(tokenized);
  if (!referenced.ok) {
    const lastError: StackMessage | undefined = errorStack.stack_pop();
    const message: string = lastError === undefined
      ? 'unresolved reference'
      : error_stripDebugPrefix(lastError.message);
    return { text: chalk.red(`${message}\n`), buffer: Buffer.from('') };
  }
  const words: ShellWord[] = referenced.value;
  const [commandWord, ...argumentWords]: ShellWord[] = words;
  const command: string = commandWord.value;

  const expandResult: Result<ShellArguments> = await commandWords_expand(command, argumentWords);
  if (!expandResult.ok) {
    const lastError: StackMessage | undefined = errorStack.stack_pop();
    const errorMsg: string = lastError ? error_stripDebugPrefix(lastError.message) : 'Unknown error';
    return { text: chalk.red(`${errorMsg}\n`), buffer: Buffer.from('') };
  }
  const args: ShellArguments = expandResult.value;

  if (command === 'exit') {
    process.exit(0);
  }

  // The command runs with its output captured into a pipe sink scoped to this
  // async context — no console monkeypatch. Envelope handlers deliver their
  // rendered text through the sink (ANSI-stripped for the plain-pipe contract);
  // streaming commands and binary cat write to the same sink directly (raw
  // bytes kept byte-for-byte). The err channel passes through to stderr live.
  const pipeSink: PipeCaptureSink = new PipeCaptureSink(sink_get());
  await sinkScope_run(pipeSink, async (): Promise<void> => {
    const helpEnvelope: CommandEnvelope | null = await helpEnvelope_maybe(command, args);
    if (helpEnvelope) return;

    const envelopeHandler: EnvelopeHandler | undefined = envelopeHandler_get(command);
    if (envelopeHandler) {
      const envelope: CommandEnvelope | undefined = await envelopeHandler(args);
      if (envelope) {
        envelope_deliver(envelope);
      }
      return;
    }

    const pluginEnvelope: CommandEnvelope | null = await pluginExecutable_handle(command, args);
    if (pluginEnvelope) {
      envelope_deliver(pluginEnvelope);
      return;
    }

    const handler: CommandHandler | undefined = plainHandler_get(command);
    if (handler) {
      await handler(args);
      return;
    }

    const binMatches: BinExecutableMatches = await binExecutableMatches_get(command);
    if (binMatches.pipeline) {
      const envelope: CommandEnvelope = await pipelineExecutable_handle(command, args);
      envelope_deliver(envelope);
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

  // The first segment is a chell command run in-engine. A later segment
  // that names a builtin runs in-engine too, reading what came before it
  // (`fortune | cowsay` is the kernel's own, in a browser as in a terminal);
  // any other goes through the surface's host shell, so nothing spawns on a
  // daemon host — a surface without the capability (a browser) fails that
  // segment with a clear message.
  const firstCommand: string = segments[0];
  const { buffer } = await chellCommand_executeAndCapture(firstCommand);

  let currentInput: Buffer = buffer;
  for (let i: number = 1; i < segments.length; i++) {
    const segment: string = segments[i];
    const word: string = segment.trim().split(/\s+/)[0] ?? '';
    if (word !== '' && builtinCommand_has(word)) {
      stdin_set(currentInput.toString('utf-8'));
      try {
        currentInput = (await chellCommand_executeAndCapture(segment)).buffer;
      } finally {
        stdin_set(null);
      }
      continue;
    }
    capability_require('pipeSegments', 'this surface cannot run pipeline segments');
    currentInput = await surface_get().pipeSegment(segment, currentInput);
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
  const tokenized: ShellWord[] = shellWords_tokenize(trimmedLine);
  if (tokenized.length === 0) return null;
  const referenced: Result<ShellWord[]> = await commandLine_referencesExpand(tokenized);
  if (!referenced.ok) {
    const lastError: StackMessage | undefined = errorStack.stack_pop();
    // The refusal is the operator's to read, not the stack's: the debug
    // prefix names the function that pushed it, which tells them nothing.
    if (lastError) sink_get().err_write(`${chalk.red(error_stripDebugPrefix(lastError.message))}\n`);
    process.exitCode = 1;
    return { status: 'error', rendered: '' };
  }
  const words: ShellWord[] = referenced.value;
  // A line that acted on a number says which listing it counted: the rule
  // that a readout which acts says so, applied to the rows it acted on.
  const counted: SessionAnswer | null = answerConsulted_take();
  if (counted !== null) {
    sink_get().data_write(chalk.gray(`  from: ${counted.source} · ${counted.rows.length} rows\n`));
  }
  const [commandWord, ...argumentWords]: ShellWord[] = words;
  const command: string = commandWord.value;
  const expandResult: Result<ShellArguments> = await commandWords_expand(command, argumentWords);
  if (!expandResult.ok) {
    const lastError: StackMessage | undefined = errorStack.stack_pop();
    if (lastError) {
      sink_get().err_write(`${chalk.red(error_stripDebugPrefix(lastError.message))}\n`);
    }
    return { status: 'error', rendered: '' };
  }
  const args: ShellArguments = expandResult.value;

  // Help travels through the same expanded-word path as a pipe's first
  // ChELL segment, ensuring that structural execution forms agree.
  const helpEnvelope: CommandEnvelope | null = await helpEnvelope_maybe(command, args);
  if (helpEnvelope) return helpEnvelope;

  // Attempt to handle as a simulated plugin execution. This path bypasses
  // command_dispatchEnvelope, so it drains the errorStack itself.
  const checkpoint: number = errorStack.checkpoint_mark();
  const exitCodeBefore: number = exitCode_read();
  const pluginEnvelope: CommandEnvelope | null = await pluginExecutable_handle(command, args);
  if (pluginEnvelope) {
    envelope_deliver(pluginEnvelope);
    command_timingMaybePrint(startTime, timingEnabled);
    const exitCodeAfter: number = exitCode_read();
    const failed: boolean = exitCodeAfter !== 0 && exitCodeAfter !== exitCodeBefore;
    const result: CommandEnvelope = failed
      ? { ...pluginEnvelope, status: 'error' }
      : pluginEnvelope;
    if (result.model !== undefined) {
      answer_note(result.model.kind, result.model.data, trimmedLine);
    }
    return envelope_drainErrorsInto(checkpoint, result);
  }

  const envelope: CommandEnvelope = await command_dispatchEnvelope(command, args);
  command_timingMaybePrint(startTime, timingEnabled);
  // An answer with rows becomes the thing `@3` counts. Recorded from the
  // MODEL, not from the rendering, so a console table and a graphical pane
  // number the same rows — an index that meant different things on
  // different surfaces would be worse than no index at all.
  if (envelope.model !== undefined) {
    answer_note(envelope.model.kind, envelope.model.data, trimmedLine);
  }
  return envelope;
}
