/**
 * @file Running a printing command handler, and reading the outcome it left.
 *
 * @module
 */
import type { CommandEnvelope } from '@fnndsc/menu';
import type { CommandHandler } from './commandRegistry.js';

/**
 * Reads the current process exit code as a number.
 *
 * @returns The exit code, treating an unset code as zero.
 */
export function exitCode_read(): number {
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
export async function handler_runDirect(handler: CommandHandler, args: string[]): Promise<CommandEnvelope> {
  const exitCodeBefore: number = exitCode_read();
  const explicitEnvelope: void | CommandEnvelope = await handler(args);
  if (explicitEnvelope !== undefined) return explicitEnvelope;
  const exitCodeAfter: number = exitCode_read();
  const failed: boolean = exitCodeAfter !== 0 && exitCodeAfter !== exitCodeBefore;
  return { status: failed ? 'error' : 'ok', rendered: '' };
}
