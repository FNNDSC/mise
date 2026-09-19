/**
 * @file Waiting for scheduled work to settle.
 *
 * A scheduled run used to return the moment CUBE accepted it, which reads as
 * completion and is not: the next line in a script runs against output that
 * does not exist yet, and the only way to sequence work was a sleep, which is
 * a lie about time. A verb that starts work therefore waits for it, and
 * `--detach` is how an operator asks for the handle instead.
 *
 * Waiting holds the LINE, never the session. Progress goes out on the
 * progress channel while the wait runs, so a surface shows the work moving
 * and other panes keep refreshing; a cancellation (Esc at a surface, Ctrl-C
 * at a console) DETACHES rather than kills — the run continues and its
 * handle is printed, which is what `--detach` would have given, asked for
 * later.
 *
 * A pipeline schedules several nodes at once, so a wait is over a SET: it
 * ends when every node it was given has reached a status it does not leave.
 *
 * @module
 */
import chalk from 'chalk';
import { jobs_statusBatch } from '@fnndsc/salsa';
import { sink_get } from '../../core/sink.js';
import { commandCancellation_enable, commandCancellation_signalGet } from '../../core/cancellation.js';

/** Statuses a run does not leave. */
export const RUN_TERMINAL_STATUSES: ReadonlySet<string> = new Set([
  'finishedSuccessfully',
  'finishedWithError',
  'cancelled',
]);

/** How a wait ended. */
export type RunSettlementOutcome = 'settled' | 'detached' | 'unreachable';

/** What a wait found out. */
export interface RunSettlement {
  /** The runs waited on. */
  instanceIDs: number[];
  /** Each run's status: terminal when settled, last seen otherwise. */
  statuses: Map<number, string>;
  /** How the wait ended. */
  outcome: RunSettlementOutcome;
  /** How many runs ended in a status that is not success. */
  failed: number;
  /** How long the wait lasted. */
  elapsedMs: number;
}

/** First seconds are polled briskly; a long run is not worth the traffic. */
const POLL_FAST_MS: number = 2000;
/** What the interval settles to once the work is clearly not instant. */
const POLL_SLOW_MS: number = 5000;
/** When the interval stretches. */
const POLL_BRISK_WINDOW_MS: number = 30000;
/** Consecutive unanswered status asks before the wait gives up on knowing. */
const STATUS_MISSES_MAX: number = 5;

/**
 * Sleeps, unless the command is cancelled first.
 *
 * @param ms - How long to wait.
 * @param signal - The foreground command's abort signal, when there is one.
 * @returns True when the sleep completed, false when cancellation cut it short.
 */
async function pause_take(ms: number, signal: AbortSignal | undefined): Promise<boolean> {
  if (signal?.aborted === true) return false;
  return await new Promise<boolean>((resolve): void => {
    const onAbort = (): void => {
      clearTimeout(timer);
      resolve(false);
    };
    const timer: ReturnType<typeof setTimeout> = setTimeout((): void => {
      signal?.removeEventListener('abort', onAbort);
      resolve(true);
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Says how the wait is going, on the channel progress travels on.
 *
 * @param label - What to call the work on a surface.
 * @param settled - How many of the runs have finished.
 * @param total - How many runs the wait covers.
 * @param phase - Whether the work is still going, done, or failed.
 */
function runProgress_emit(
  label: string,
  settled: number,
  total: number,
  phase: 'working' | 'complete' | 'failed',
): void {
  sink_get().progress_write({
    operation: 'workflow',
    kind: 'workflow',
    phase,
    label,
    current: settled,
    total,
    percent: total > 0 ? Math.min(100, (settled / total) * 100) : undefined,
    unit: 'jobs',
    status: phase === 'working' ? 'running' : (phase === 'complete' ? 'done' : 'error'),
  });
}

/**
 * Counts the runs that have reached a terminal status, and those that failed.
 *
 * @param statuses - Status by instance id.
 * @returns How many are settled, and how many of those did not succeed.
 */
function settlement_count(statuses: Map<number, string>): { settled: number; failed: number } {
  let settled: number = 0;
  let failed: number = 0;
  for (const status of statuses.values()) {
    if (!RUN_TERMINAL_STATUSES.has(status)) continue;
    settled += 1;
    if (status !== 'finishedSuccessfully') failed += 1;
  }
  return { settled, failed };
}

/** How often a wait asks, for a caller that knows better than the default. */
export interface RunWaitCadence {
  /** Milliseconds between asks. Both windows collapse to this when given. */
  pollMs?: number;
}

/**
 * Waits for every given run to reach a status it does not leave.
 *
 * @param instanceIDs - The plugin instances to wait on.
 * @param label - What to call the work in progress and readouts.
 * @param cadence - How often to ask, when the default rhythm is wrong.
 * @returns How the wait ended, and the statuses it ended on.
 */
export async function runs_awaitSettled(
  instanceIDs: number[],
  label: string,
  cadence: RunWaitCadence = {},
): Promise<RunSettlement> {
  const started: number = Date.now();
  const statuses: Map<number, string> = new Map(
    instanceIDs.map((id: number): [number, string] => [id, 'scheduled']),
  );
  if (instanceIDs.length === 0) {
    return { instanceIDs, statuses, outcome: 'settled', failed: 0, elapsedMs: 0 };
  }

  // A wait is exactly the kind of work a cancellation should reach.
  commandCancellation_enable();
  const signal: AbortSignal | undefined = commandCancellation_signalGet();
  let misses: number = 0;

  for (;;) {
    const read: Map<number, string> = await jobs_statusBatch(instanceIDs);
    if (read.size === 0) {
      // One unanswered ask is a network hiccup, not a verdict on the work.
      misses += 1;
      if (misses >= STATUS_MISSES_MAX) {
        return { instanceIDs, statuses, outcome: 'unreachable', failed: 0, elapsedMs: Date.now() - started };
      }
    } else {
      misses = 0;
      for (const [id, status] of read) statuses.set(id, status);
      const { settled, failed } = settlement_count(statuses);
      if (settled === instanceIDs.length) {
        runProgress_emit(label, settled, instanceIDs.length, failed > 0 ? 'failed' : 'complete');
        return { instanceIDs, statuses, outcome: 'settled', failed, elapsedMs: Date.now() - started };
      }
      runProgress_emit(label, settled, instanceIDs.length, 'working');
    }

    const elapsed: number = Date.now() - started;
    const interval: number = cadence.pollMs
      ?? (elapsed < POLL_BRISK_WINDOW_MS ? POLL_FAST_MS : POLL_SLOW_MS);
    const slept: boolean = await pause_take(interval, signal);
    if (!slept) {
      const { failed } = settlement_count(statuses);
      return { instanceIDs, statuses, outcome: 'detached', failed, elapsedMs: Date.now() - started };
    }
  }
}

/**
 * Renders how long a wait lasted, the way an operator says it.
 *
 * @param ms - Elapsed milliseconds.
 * @returns A short duration, such as `2m14s`.
 */
export function elapsed_render(ms: number): string {
  const seconds: number = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes: number = Math.floor(seconds / 60);
  return `${minutes}m${`${seconds % 60}`.padStart(2, '0')}s`;
}

/**
 * Renders what a wait found, in the operator's terms.
 *
 * A detached wait says how to get back to the work, because the run is still
 * going and the handle is the only way to reach it.
 *
 * @param settlement - What the wait found.
 * @param label - What the work is called.
 * @returns The line to print.
 */
export function settlement_render(settlement: RunSettlement, label: string): string {
  const took: string = elapsed_render(settlement.elapsedMs);
  const handles: string = settlement.instanceIDs.join(', ');

  if (settlement.outcome === 'detached') {
    return chalk.yellow(
      `${label}: detached after ${took} — the run continues. Instance ${handles}; follow it with \`plugininstance list\` or the feed's graph.`,
    );
  }
  if (settlement.outcome === 'unreachable') {
    return chalk.yellow(
      `${label}: lost touch with CUBE after ${took} — the run may still be going. Instance ${handles}.`,
    );
  }
  if (settlement.failed > 0) {
    const failedIds: string = [...settlement.statuses.entries()]
      .filter(([, status]: [number, string]): boolean => status !== 'finishedSuccessfully')
      .map(([id, status]: [number, string]): string => `${id} ${status}`)
      .join(', ');
    return chalk.red(`${label}: finished with errors after ${took} — ${failedIds}`);
  }
  const nodes: string = settlement.instanceIDs.length === 1
    ? `instance ${handles}`
    : `${settlement.instanceIDs.length} nodes`;
  return chalk.green(`${label}: finished successfully in ${took} (${nodes})`);
}
