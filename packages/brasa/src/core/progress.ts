/**
 * @file Structured progress events emitted by commands and rendered by hosts.
 *
 * Progress is semantic live telemetry. It is not command output, is never
 * captured into envelopes, and is never consumed by pipes or redirects.
 *
 * @module
 */

/**
 * Operations that may produce structured progress.
 *
 * `task` is the deliberate none-of-the-above value: work whose activity has no
 * useful name, such as a cache warm-up or a directory scan. It is also the
 * value an unknown operation from a newer peer degrades to, so a surface built
 * against an older enum renders such work generically instead of dropping it.
 */
export const PROGRESS_OPERATIONS = [
  'upload', 'download', 'pull', 'workflow', 'pipeline', 'group', 'task',
] as const;
/** Broad structured-progress producer classes. */
export const PROGRESS_KINDS = ['transfer', 'retrieve', 'workflow', 'inspection'] as const;
/**
 * Lifecycle phases shared by structured-progress operations.
 *
 * `working` is indeterminate: work is under way and neither its extent nor its
 * remaining time is known. The named phases all imply a specific activity,
 * which is precisely what indeterminate work cannot claim.
 */
export const PROGRESS_PHASES = [
  'scanning', 'transferring', 'watching', 'retrying', 'reading', 'working', 'complete', 'failed',
] as const;
/** Units supported by counted progress. */
export const PROGRESS_UNITS = ['files', 'bytes', 'series', 'jobs', 'nodes'] as const;
/** Operation and item states supported by structured progress. */
export const PROGRESS_STATUSES = [
  'running', 'done', 'unconfirmed', 'stalled', 'timeout', 'error', 'unknown',
] as const;

export type ProgressOperation = typeof PROGRESS_OPERATIONS[number];
export type ProgressKind = typeof PROGRESS_KINDS[number];
export type ProgressPhase = typeof PROGRESS_PHASES[number];
export type ProgressUnit = typeof PROGRESS_UNITS[number];
export type ProgressStatus = typeof PROGRESS_STATUSES[number];

export interface ProgressEvent {
  operation: ProgressOperation;
  kind?: ProgressKind;
  phase: ProgressPhase;
  label?: string;
  itemId?: string;
  current?: number;
  total?: number;
  percent?: number;
  unit?: ProgressUnit;
  status?: ProgressStatus;
}

/**
 * Renders progress events for a frontend.
 *
 * The engine emits {@link ProgressEvent}s and knows nothing about how they are
 * shown. Each frontend supplies its own implementation: a terminal draws bars,
 * a daemon forwards the events over its wire, a headless host drops them.
 */
export interface ProgressRenderer {
  /**
   * Renders a single progress event.
   *
   * @param event - The progress telemetry to render.
   */
  write(event: ProgressEvent): void;
}

/**
 * Progress renderer that drops every event.
 *
 * The engine's default when no frontend has supplied a live renderer, so
 * headless hosts incur no terminal coupling.
 */
export class NullProgressRenderer implements ProgressRenderer {
  /** @inheritdoc */
  public write(_event: ProgressEvent): void {
    // Progress is live telemetry: with no frontend to render it, it is dropped.
  }
}
