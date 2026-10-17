/**
 * @file Foreground-command cancellation scope.
 *
 * One interactive engine owns one foreground command at a time. This module
 * carries that command's abort signal through asynchronous dispatch without
 * turning cancellation into ambient process state for unrelated work.
 *
 * @module
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { turnPart_register } from './turn.js';

/** State owned by one top-level foreground command. */
interface CommandCancellationState {
  controller: AbortController;
  cancellable: boolean;
}

const cancellationScope: AsyncLocalStorage<CommandCancellationState> =
  new AsyncLocalStorage<CommandCancellationState>();
let foreground: CommandCancellationState | undefined;

// Ctrl-C cancels the command holding the turn: one that stepped aside to
// wait on a question takes its cancellation back when it resumes.
turnPart_register({
  name: 'cancellation',
  save: (): unknown => foreground,
  clear: (): void => { foreground = undefined; },
  restore: (saved: unknown): void => { foreground = saved as CommandCancellationState | undefined; },
});

/**
 * Runs work inside the foreground-command cancellation scope.
 *
 * Nested line execution retains its parent's scope, so a semicolon batch has
 * one cancellation lifetime rather than one controller per segment.
 *
 * @param operation - Work performed by one command line.
 * @returns The operation result.
 */
export async function commandCancellation_run<T>(operation: () => Promise<T>): Promise<T> {
  if (cancellationScope.getStore() !== undefined) {
    return await operation();
  }

  const state: CommandCancellationState = {
    controller: new AbortController(),
    cancellable: false,
  };
  const previous: CommandCancellationState | undefined = foreground;
  foreground = state;
  try {
    return await cancellationScope.run(state, operation);
  } finally {
    if (foreground === state) foreground = previous;
  }
}

/**
 * Whether code is running inside a command's scope (a line within a
 * command, rather than a line of its own).
 *
 * @returns True inside a command.
 */
export function commandCancellation_active(): boolean {
  return cancellationScope.getStore() !== undefined;
}

/**
 * Marks the current command as able to honor a foreground cancellation.
 *
 * @returns Nothing. Calls outside a command scope have no effect.
 */
export function commandCancellation_enable(): void {
  const state: CommandCancellationState | undefined = cancellationScope.getStore();
  if (state !== undefined) state.cancellable = true;
}

/**
 * Gets the abort signal for the command currently running on this async path.
 *
 * @returns The command signal, or undefined outside foreground execution.
 */
export function commandCancellation_signalGet(): AbortSignal | undefined {
  return cancellationScope.getStore()?.controller.signal;
}

/**
 * Requests cancellation of the currently running cancellable command.
 *
 * @returns True when a cancellable foreground command was signalled.
 */
export function commandCancellation_request(): boolean {
  if (foreground === undefined || !foreground.cancellable || foreground.controller.signal.aborted) {
    return false;
  }
  foreground.controller.abort();
  return true;
}

/**
 * Aborts the foreground command whether or not it declared it can honor a
 * cancellation: the operator's STOP. A command that checks its signal ends;
 * one that does not is left for the host to abandon, and everything it does
 * afterwards can see that it was stopped ({@link commandCancellation_stopped}).
 *
 * @returns True when there was a foreground command to abort.
 */
export function commandCancellation_abort(): boolean {
  if (foreground === undefined) return false;
  if (!foreground.controller.signal.aborted) foreground.controller.abort();
  return true;
}

/**
 * Whether the command this code runs inside has been stopped: its output is
 * no longer anyone's, and it may not ask a question.
 *
 * @returns True inside a stopped command; false outside any command.
 */
export function commandCancellation_stopped(): boolean {
  return cancellationScope.getStore()?.controller.signal.aborted === true;
}
