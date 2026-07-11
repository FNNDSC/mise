/**
 * @file Structured progress events emitted by commands and rendered by hosts.
 *
 * Progress is semantic live telemetry. It is not command output, is never
 * captured into envelopes, and is never consumed by pipes or redirects.
 *
 * @module
 */

export type ProgressOperation = 'upload' | 'download' | 'pull' | 'workflow';
export type ProgressKind = 'transfer' | 'retrieve' | 'workflow';
export type ProgressPhase = 'scanning' | 'transferring' | 'watching' | 'retrying' | 'complete' | 'failed';
export type ProgressUnit = 'files' | 'bytes' | 'series' | 'jobs' | 'nodes';
export type ProgressStatus = 'running' | 'done' | 'unconfirmed' | 'stalled' | 'timeout' | 'error' | 'unknown';

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
