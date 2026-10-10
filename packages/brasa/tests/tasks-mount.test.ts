/**
 * @file A backend's tasks as files under `/proc/<source>`.
 */
import { describe, it, expect } from '@jest/globals';
import { TaskSourceVfsProvider, taskField_text } from '../src/core/tasks.js';
import type { TaskSource } from '../src/core/backend.js';
import type { Task } from '@fnndsc/menu';

const TASKS: Task[] = [
  { id: 'plan', label: 'Plan the cluster', state: 'done', started: '2026-10-09T10:00:00Z', ended: '2026-10-09T10:01:00Z', logTail: 'planned\n' },
  { id: 'apply', label: 'Apply the plan', state: 'running', progress: { current: 3, total: 10, unit: 'nodes' }, started: '2026-10-09T10:02:00Z' },
];
const source: TaskSource = {
  id: 'steps', label: 'install steps',
  list: async () => TASKS,
  log: async (id: string) => (id === 'apply' ? 'applying node 1\napplying node 2\n' : null),
};
const mount = new TaskSourceVfsProvider(source);

describe('a task source as files', () => {
  it('mounts at /proc/<source>, a folder per task, a file per field', async () => {
    expect(mount.prefix).toBe('/proc/steps');
    const tasks = await mount.list('/proc/steps');
    expect(tasks.ok && tasks.value.map((item) => `${item.name}:${item.type}`)).toEqual(['plan:dir', 'apply:dir']);
    const fields = await mount.list('/proc/steps/apply');
    expect(fields.ok && fields.value.map((item) => item.name)).toEqual(['label', 'state', 'progress', 'started', 'ended', 'log']);
    expect((await mount.list('/proc/steps/none')).ok).toBe(false);
  });

  it('reads each field as text, and the source\'s whole log where it keeps one', async () => {
    expect(await mount.read('/proc/steps/apply/state')).toEqual({ ok: true, value: 'running\n' });
    expect(await mount.read('/proc/steps/apply/progress')).toEqual({ ok: true, value: '3/10 nodes\n' });
    expect(await mount.read('/proc/steps/apply/log')).toEqual({ ok: true, value: 'applying node 1\napplying node 2\n' });
    expect(await mount.read('/proc/steps/plan/log')).toEqual({ ok: true, value: 'planned\n' });
    expect(await mount.read('/proc/steps/plan/ended')).toEqual({ ok: true, value: '2026-10-09T10:01:00Z\n' });
    expect(await mount.read('/proc/steps/apply/ended')).toEqual({ ok: true, value: '' });
  });

  it('says a folder is one, and nothing there is not there', async () => {
    expect(await mount.read('/proc/steps/apply')).toEqual({ ok: false, errno: 'EISDIR' });
    expect(await mount.read('/proc/steps')).toEqual({ ok: false, errno: 'EISDIR' });
    expect(await mount.read('/proc/steps/none/state')).toEqual({ ok: false, errno: 'ENOENT' });
    expect(await mount.read('/proc/steps/apply/bogus')).toEqual({ ok: false, errno: 'ENOENT' });
  });

  it('writes progress whole or open-ended', () => {
    expect(taskField_text({ id: 'x', label: 'x', state: 'running', progress: { current: 5, total: null } }, 'progress')).toBe('5\n');
  });
});
