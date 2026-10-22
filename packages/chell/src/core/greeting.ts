/**
 * @file The greeting a TTY prints on arrival.
 *
 * The kernel's `motd` says who you are, what you hold and what is running,
 * and ends with a fortune; this surface asks it once its session is up and
 * prints the answer. A browser asks the same command, so the two greet
 * alike. A `motd` that cannot be asked (an older daemon, a refused call) is
 * skipped without a word: a greeting is not worth an error.
 *
 * @module
 */
import chalk from 'chalk';
import { sinkScope_run, type BrasaEngine, type OutputSink } from '@fnndsc/brasa';
import type { CommandEnvelope } from '@fnndsc/cumin';
import { surfaceLine_execute } from './surfaceDispatch.js';

/** A sink that keeps nothing: the greeting prints what `motd` answered, and nothing it refused. */
const QUIET_SINK: OutputSink = {
  data_write: (): void => undefined,
  err_write: (): void => undefined,
  status_write: (): void => undefined,
  progress_write: (): void => undefined,
};

/** What this surface calls itself in the greeting. */
const SURFACE_NAME: string = 'chell';

/**
 * Prints the session's greeting, dim, followed by a blank line.
 *
 * @param engine - The engine the session runs on.
 */
export async function greeting_print(engine: BrasaEngine): Promise<void> {
  let envelopes: CommandEnvelope[];
  try {
    // Asked quietly: a backend with no `motd` (stratus, null) answers
    // `command not found`, which is not a greeting and not worth a red line.
    envelopes = await sinkScope_run(QUIET_SINK, (): Promise<CommandEnvelope[]> => surfaceLine_execute(engine, `motd ${SURFACE_NAME}`));
  } catch {
    return;
  }
  const text: string = envelopes
    .filter((envelope: CommandEnvelope): boolean => envelope.status === 'ok')
    .map((envelope: CommandEnvelope): string => envelope.rendered)
    .join('')
    .trimEnd();
  if (text.length === 0) return;
  console.log(chalk.gray(text));
  console.log('');
}
