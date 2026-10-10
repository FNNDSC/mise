/**
 * @file Watching any backend's task: live while it runs, settled when it is
 * over, stale when its source cannot answer; every surface told of a change.
 */
import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import type { AmbientEvent, Task } from '@fnndsc/menu';
import { taskWatch_set, taskWatch_release, taskSubject_parse, TASK_WATCH_FLOOR_MS } from '../src/core/taskWatch.js';
import { ambient_listen } from '../src/core/ambient.js';
import type { TaskSource } from '../src/core/backend.js';

const state: { tasks: Task[]; fails: boolean } = { tasks: [], fails: false };
const steps: TaskSource = {
  id: 'steps', label: 'install steps',
  list: async () => {
    if (state.fails) throw new Error('the source is down');
    return state.tasks;
  },
};
const heard: AmbientEvent[] = [];
let unlisten: () => void = () => undefined;

/** Lets the watch's ask and its timers run. */
async function ticks_run(ms: number = TASK_WATCH_FLOOR_MS): Promise<void> {
  await jest.advanceTimersByTimeAsync(ms);
}

beforeEach(() => {
  jest.useFakeTimers();
  state.tasks = [{ id: 'apply', label: 'Apply', state: 'running' }];
  state.fails = false;
  heard.length = 0;
  unlisten = ambient_listen((event: AmbientEvent) => { heard.push(event); });
});
afterEach(() => {
  taskWatch_release('a');
  taskWatch_release('b');
  unlisten();
  jest.useRealTimers();
});

describe('a task watch', () => {
  it('names a task by its path in a source, and nothing else', () => {
    expect(taskSubject_parse('/proc/steps/apply', [steps])).toEqual({ source: steps, id: 'apply' });
    expect(taskSubject_parse('/proc/other/apply', [steps])).toBeNull();
    expect(taskSubject_parse('/proc/steps', [steps])).toBeNull();
    expect(taskWatch_set('/proc/other/x', 'a', true, [steps])).toBeNull();
  });

  it('is live while the task runs, and settles, telling every surface, when it is over', async () => {
    expect(taskWatch_set('/proc/steps/apply', 'a', true, [steps])).toBe('live');
    await ticks_run(0);
    state.tasks = [{ id: 'apply', label: 'Apply', state: 'done' }];
    await ticks_run();
    expect(heard).toContainEqual({ kind: 'watched', subject: '/proc/steps/apply', state: 'settled' });
  });

  it('goes stale when the source cannot answer, and live again when it can', async () => {
    taskWatch_set('/proc/steps/apply', 'a', true, [steps]);
    await ticks_run(0);
    state.fails = true;
    await ticks_run();
    expect(heard).toContainEqual({ kind: 'watched', subject: '/proc/steps/apply', state: 'stale' });
    state.fails = false;
    await ticks_run(30000);
    expect(heard.at(-1)).toEqual({ kind: 'watched', subject: '/proc/steps/apply', state: 'live' });
  });

  it('is shared by its owners, and ends when the last lets go', async () => {
    taskWatch_set('/proc/steps/apply', 'a', true, [steps]);
    expect(taskWatch_set('/proc/steps/apply', 'b', true, [steps])).toBe('live');
    taskWatch_release('a');
    await ticks_run(0);
    state.tasks = [{ id: 'apply', label: 'Apply', state: 'failed' }];
    await ticks_run();
    expect(heard).toContainEqual({ kind: 'watched', subject: '/proc/steps/apply', state: 'settled' });
    heard.length = 0;
    taskWatch_set('/proc/steps/apply', 'b', false, [steps]);
    await ticks_run(30000);
    expect(heard).toEqual([]);
  });
});
