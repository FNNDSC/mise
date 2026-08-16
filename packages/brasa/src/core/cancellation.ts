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

/** State owned by one top-level foreground command. */
interface CommandCancellationState {
  controller: AbortController;
  cancellable: boolean;
}

const cancellationScope: AsyncLocalStorage<CommandCancellationState> =
  new AsyncLocalStorage<CommandCancellationState>();
let foreground: CommandCancellationState | undefined;

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
