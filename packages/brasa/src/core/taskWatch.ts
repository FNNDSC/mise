/**
 * @file Watching any backend's task: the core asks its source until the task
 * is over, and tells every surface how the watch stands (`live`, `settled`,
 * or `stale` when the source cannot answer).
 *
 * A backend that watches its own subjects (ChRIS's feeds) answers first; this
 * watch is for a task the backend leaves to the core.
 *
 * @module
 */
import { taskState_isOver, type Task, type WatchState } from '@fnndsc/menu';
import { ambient_publish } from './ambient.js';
import type { TaskSource } from './backend.js';

/** How soon a watched task is asked again while it changes, and at most how long between asks. */
export const TASK_WATCH_FLOOR_MS: number = 3000;
export const TASK_WATCH_CAP_MS: number = 30000;

/** One watched task. */
interface TaskWatch {
  subject: string;
  source: TaskSource;
  id: string;
  owners: Set<string>;
  state: WatchState;
  /** The task as last read, to tell a change from none. */
  last: string | null;
  delayMs: number;
  timer: ReturnType<typeof setTimeout> | null;
}

const watches: Map<string, TaskWatch> = new Map();

/**
 * The task a subject names: `/proc/<source>/<id>`, in one of the sources.
 *
 * @param subject - The subject.
 * @param sources - The session's task sources.
 * @returns The source and the task's id, or null when no source has that name.
 */
export function taskSubject_parse(subject: string, sources: ReadonlyArray<TaskSource>): { source: TaskSource; id: string } | null {
  const match: RegExpMatchArray | null = /^\/proc\/([^/]+)\/([^/]+)\/?$/.exec(subject.trim());
  if (match === null) return null;
  const source: TaskSource | undefined = sources.find((candidate: TaskSource): boolean => candidate.id === match[1]);
  return source === undefined ? null : { source, id: match[2] as string };
}

/**
 * Records a watch's state, and tells the surfaces when it changed.
 *
 * @param watch - The watch.
 * @param state - Its state now.
 */
function state_set(watch: TaskWatch, state: WatchState): void {
  if (watch.state === state) return;
  watch.state = state;
  ambient_publish({ kind: 'watched', subject: watch.subject, state });
}

/**
 * Asks the source once: over is settled (and the watch ends), a source that
 * cannot answer or no longer has the task is stale, anything else live, asked
 * again sooner when it changed.
 *
 * @param watch - The watch.
 */
async function watch_tick(watch: TaskWatch): Promise<void> {
  let task: Task | undefined;
  let answered: boolean = true;
  try {
    task = (await watch.source.list()).find((candidate: Task): boolean => candidate.id === watch.id);
  } catch {
    answered = false;
  }
  if (!watches.has(watch.subject)) return;
  if (!answered || task === undefined) {
    state_set(watch, 'stale');
    watch.delayMs = TASK_WATCH_CAP_MS;
  } else if (taskState_isOver(task.state)) {
    state_set(watch, 'settled');
    watch_stop(watch);
    return;
  } else {
    const now: string = JSON.stringify(task);
    const changed: boolean = now !== watch.last;
    watch.last = now;
    state_set(watch, 'live');
    watch.delayMs = changed ? TASK_WATCH_FLOOR_MS : Math.min(TASK_WATCH_CAP_MS, watch.delayMs * 2);
  }
  watch.timer = setTimeout((): void => {
    watch.timer = null;
    void watch_tick(watch);
  }, watch.delayMs);
  watch.timer.unref();
}

/**
 * Ends a watch.
 *
 * @param watch - The watch.
 */
function watch_stop(watch: TaskWatch): void {
  if (watch.timer) clearTimeout(watch.timer);
  watch.timer = null;
  watches.delete(watch.subject);
}

/**
 * Starts or stops one owner's watch of a task.
 *
 * @param subject - The task's path, `/proc/<source>/<id>`.
 * @param owner - Who watches (a surface).
 * @param on - Start, or stop.
 * @param sources - The session's task sources.
 * @returns The watch's state, or null when the subject names no task source.
 */
export function taskWatch_set(subject: string, owner: string, on: boolean, sources: ReadonlyArray<TaskSource>): WatchState | null {
  const named: { source: TaskSource; id: string } | null = taskSubject_parse(subject, sources);
  if (named === null) return null;
  const key: string = `/proc/${named.source.id}/${named.id}`;
  const existing: TaskWatch | undefined = watches.get(key);
  if (!on) {
    if (existing) {
      existing.owners.delete(owner);
      if (existing.owners.size === 0) watch_stop(existing);
      return existing.state;
    }
    return 'settled';
  }
  if (existing) {
    existing.owners.add(owner);
    return existing.state;
  }
  const watch: TaskWatch = {
    subject: key, source: named.source, id: named.id, owners: new Set([owner]),
    state: 'live', last: null, delayMs: TASK_WATCH_FLOOR_MS, timer: null,
  };
  watches.set(key, watch);
  void watch_tick(watch);
  return watch.state;
}

/**
 * Ends every watch an owner holds (a surface that went away).
 *
 * @param owner - The owner.
 */
export function taskWatch_release(owner: string): void {
  for (const watch of Array.from(watches.values())) {
    watch.owners.delete(owner);
    if (watch.owners.size === 0) watch_stop(watch);
  }
}
