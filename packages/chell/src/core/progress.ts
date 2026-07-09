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
