/**
 * @file A line the surface runs in the operator's name, visibly: echoed in
 * the console as if typed, run as a typed line runs (never silent, so its
 * answer streams into the console and reaches the session's scrollback),
 * and its outcome written. A pane that acts by a command it could have
 * asked the operator to type uses this, so the transcript is the whole story.
 *
 * @module
 */
import type { ExecuteOutcome } from '../calypso/client.js';
import type { HostContext } from './hostContext.js';

/**
 * Runs a line visibly and says whether it took.
 *
 * @param context - The console and the wire.
 * @param line - The command line.
 * @returns True when every envelope came back ok.
 */
export async function lineVisible_run(context: Pick<HostContext, 'terminal' | 'client'>, line: string): Promise<boolean> {
  const { terminal, client } = context;
  terminal.line_echo(line);
  let outcome: ExecuteOutcome;
  try {
    outcome = await client.line_execute(line);
  } catch (error: unknown) {
    terminal.output_write('err', `\x1b[31m${error instanceof Error ? error.message : String(error)}\x1b[0m\n`);
    return false;
  }
  terminal.outcome_write(outcome);
  return outcome.envelopes.length > 0 && outcome.envelopes.every((envelope): boolean => envelope.status === 'ok');
}
