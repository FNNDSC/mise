/**
 * @file Foreground-command cancellation scope.
 *
 * Each top-level line owns its abort signal, carried through asynchronous
 * dispatch without turning cancellation into ambient process state for
 * unrelated work. Several lines may run at once (a read beside a writer, a
 * line run while another waits on a question), so a host that runs them
 * names each one, and a STOP or Ctrl-C reaches the line it names. A host
 * that names none (a local console) reaches the most recent.
 *
 * @module
 */
import { AsyncLocalStorage } from 'node:async_hooks';

/** State owned by one top-level line. */
interface CommandCancellationState {
  controller: AbortController;
  cancellable: boolean;
}

const cancellationScope: AsyncLocalStorage<CommandCancellationState> =
  new AsyncLocalStorage<CommandCancellationState>();
/** The most recent line, for a host that names none. */
let foreground: CommandCancellationState | undefined;
/** The running lines a host named, by name. */
const named: Map<string, CommandCancellationState> = new Map();

/**
 * Runs work inside the foreground-command cancellation scope.
 *
 * Nested line execution retains its parent's scope, so a semicolon batch has
 * one cancellation lifetime rather than one controller per segment.
 *
 * @param operation - Work performed by one command line.
 * @param id - The host's name for the line, which a STOP names.
 * @returns The operation result.
 */
export async function commandCancellation_run<T>(operation: () => Promise<T>, id?: string): Promise<T> {
  if (cancellationScope.getStore() !== undefined) {
    return await operation();
  }

  const state: CommandCancellationState = {
    controller: new AbortController(),
    cancellable: false,
  };
  const previous: CommandCancellationState | undefined = foreground;
  foreground = state;
  if (id !== undefined) named.set(id, state);
  try {
    return await cancellationScope.run(state, operation);
  } finally {
    if (foreground === state) foreground = previous;
    if (id !== undefined && named.get(id) === state) named.delete(id);
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
 * The line a request reaches.
 *
 * @param id - The host's name for it, or undefined for the most recent.
 * @returns Its state, or undefined when no such line runs.
 */
function line_find(id: string | undefined): CommandCancellationState | undefined {
  return id === undefined ? foreground : named.get(id);
}

/**
 * Requests cancellation of a running cancellable command (Ctrl-C).
 *
 * @param id - The line, as its host named it; the most recent when omitted.
 * @returns True when a cancellable command was signalled.
 */
export function commandCancellation_request(id?: string): boolean {
  const line: CommandCancellationState | undefined = line_find(id);
  if (line === undefined || !line.cancellable || line.controller.signal.aborted) {
    return false;
  }
  line.controller.abort();
  return true;
}

/**
 * Aborts a running command whether or not it declared it can honor a
 * cancellation: the operator's STOP. A command that checks its signal ends;
 * one that does not is left for the host to abandon, and everything it does
 * afterwards can see that it was stopped ({@link commandCancellation_stopped}).
 *
 * @param id - The line, as its host named it; the most recent when omitted.
 * @returns True when there was such a command to abort.
 */
export function commandCancellation_abort(id?: string): boolean {
  const line: CommandCancellationState | undefined = line_find(id);
  if (line === undefined) return false;
  if (!line.controller.signal.aborted) line.controller.abort();
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
