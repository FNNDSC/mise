/**
 * @file Running a printing command handler, and reading the outcome it left.
 *
 * @module
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import type { CommandEnvelope } from '@fnndsc/menu';
import type { CommandHandler } from './commandRegistry.js';

/** A line's own exit status: what its commands set, and only they read. */
interface ExitStatus {
  code: number | undefined;
}

/**
 * The exit status of the line running on this async path. Lines that run
 * at once (a read beside a writer, a background job) each have their own,
 * so one's failure never marks another's (#1273). Outside a line (a test
 * calling a handler, chell's own boot) the process's exit code is used.
 */
const exitScope: AsyncLocalStorage<ExitStatus> = new AsyncLocalStorage<ExitStatus>();

/**
 * Reads the exit status as a number: the running line's own, else the
 * process's.
 *
 * @returns The exit code, treating an unset code as zero.
 */
export function exitCode_read(): number {
  const line: ExitStatus | undefined = exitScope.getStore();
  const code: number | string | null | undefined = line !== undefined ? line.code : process.exitCode;
  return typeof code === 'number' ? code : 0;
}

/**
 * Sets the exit status: the running line's own, else the process's.
 *
 * @param code - The status, or undefined to clear it.
 */
export function exitCode_set(code: number | undefined): void {
  const line: ExitStatus | undefined = exitScope.getStore();
  if (line !== undefined) line.code = code;
  else process.exitCode = code;
}

/**
 * Runs a line with an exit status of its own, then leaves that status as
 * the process's, so a one-shot `chell -c` still exits with its line's code.
 *
 * @param operation - The line's work.
 * @returns What the work returned.
 */
export async function exitScope_run<T>(operation: () => Promise<T>, ended?: (code: number) => void): Promise<T> {
  const line: ExitStatus = { code: undefined };
  try {
    return await exitScope.run(line, operation);
  } finally {
    process.exitCode = line.code;
    ended?.(typeof line.code === 'number' ? line.code : 0);
  }
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
export async function handler_runDirect(handler: CommandHandler, args: string[]): Promise<CommandEnvelope> {
  const exitCodeBefore: number = exitCode_read();
  const explicitEnvelope: void | CommandEnvelope = await handler(args);
  if (explicitEnvelope !== undefined) return explicitEnvelope;
  const exitCodeAfter: number = exitCode_read();
  const failed: boolean = exitCodeAfter !== 0 && exitCodeAfter !== exitCodeBefore;
  return { status: failed ? 'error' : 'ok', rendered: '' };
}
