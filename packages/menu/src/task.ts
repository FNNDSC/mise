/**
 * @file A task: one long-running step a session can show and watch,
 * whatever runs it (a CUBE plugin instance, an install step on a host).
 *
 * @module
 */
import type { ProgressUnit } from './progress.js';

/** Where a task stands. */
export const TASK_STATES = ['queued', 'running', 'done', 'failed', 'cancelled'] as const;

/** Where a task stands. */
export type TaskState = typeof TASK_STATES[number];

/** How far a task has come: so many of so many (the total unknown while it is). */
export interface TaskProgress {
  current: number;
  total: number | null;
  unit?: ProgressUnit;
}

/** One long-running step. */
export interface Task {
  /** Its name within its source, a path segment (`feed_12`, `apply`). */
  id: string;
  /** What an operator reads it as. */
  label: string;
  state: TaskState;
  progress?: TaskProgress;
  /** When it started and ended, ISO 8601. */
  started?: string;
  ended?: string;
  /** The last lines of its log, when the source keeps them with the task. */
  logTail?: string;
}

/**
 * Whether a task is over: it will not change again.
 *
 * @param state - Its state.
 * @returns True for done, failed and cancelled.
 */
export function taskState_isOver(state: TaskState): boolean {
  return state === 'done' || state === 'failed' || state === 'cancelled';
}
