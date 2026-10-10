/**
 * @file A backend's tasks as files: `/proc/<source>/<task>/` holds a task's
 * fields, one file each, the way `/proc/jobs` holds a job's.
 *
 * @module
 */
import { Ok, Err, errorStack, vfs_ok, vfs_fail, type Result, type VFSItem, type VFSProvider, type CpOptions, type VfsOutcome } from '@fnndsc/fond';
import type { Task } from '@fnndsc/menu';
import type { TaskSource } from './backend.js';

/** The files each task's folder holds, in listing order. */
export const TASK_FIELDS: ReadonlyArray<string> = ['label', 'state', 'progress', 'started', 'ended', 'log'];

/**
 * A task field's text, as its file reads.
 *
 * @param task - The task.
 * @param field - The field.
 * @returns The text (empty for a field the task has not got).
 */
export function taskField_text(task: Task, field: string): string {
  switch (field) {
    case 'label': return `${task.label}\n`;
    case 'state': return `${task.state}\n`;
    case 'progress': {
      if (task.progress === undefined) return '';
      const of: string = task.progress.total === null ? '' : `/${task.progress.total}`;
      return `${task.progress.current}${of}${task.progress.unit ? ` ${task.progress.unit}` : ''}\n`;
    }
    case 'started': return task.started ? `${task.started}\n` : '';
    case 'ended': return task.ended ? `${task.ended}\n` : '';
    case 'log': return task.logTail ?? '';
    default: return '';
  }
}

/** One task source, mounted at `/proc/<id>`. */
export class TaskSourceVfsProvider implements VFSProvider {
  readonly prefix: string;

  /**
   * @param source - The source it shows.
   */
  constructor(private readonly source: TaskSource) {
    this.prefix = `/proc/${source.id}`;
  }

  /**
   * The path's parts below the mount: none, a task, or a task's field.
   *
   * @param where - The path.
   * @returns The parts.
   */
  private parts_of(where: string): string[] {
    return where.slice(this.prefix.length).split('/').filter(Boolean);
  }

  /**
   * A task by id, now.
   *
   * @param id - Its id.
   * @returns It, or undefined.
   */
  private async task_get(id: string): Promise<Task | undefined> {
    return (await this.source.list()).find((task: Task): boolean => task.id === id);
  }

  async list(where: string): Promise<Result<VFSItem[]>> {
    const parts: string[] = this.parts_of(where);
    const now: string = new Date().toISOString();
    if (parts.length === 0) {
      return Ok((await this.source.list()).map((task: Task): VFSItem => ({
        name: task.id, type: 'dir', size: 0, owner: this.source.id, date: task.started ?? now,
      })));
    }
    const task: Task | undefined = parts.length === 1 ? await this.task_get(parts[0] as string) : undefined;
    if (task === undefined) {
      errorStack.stack_push('error', `Cannot list ${where}: No such file or directory`);
      return Err();
    }
    return Ok(TASK_FIELDS.map((field: string): VFSItem => ({
      name: field, type: 'file', size: taskField_text(task, field).length, owner: this.source.id, date: task.started ?? now,
    })));
  }

  async read(where: string): Promise<VfsOutcome<string>> {
    const parts: string[] = this.parts_of(where);
    if (parts.length < 2) return vfs_fail(parts.length === 0 ? 'EISDIR' : (await this.task_get(parts[0] as string)) ? 'EISDIR' : 'ENOENT');
    const [id, field] = parts as [string, string];
    const task: Task | undefined = await this.task_get(id);
    if (task === undefined || parts.length > 2 || !TASK_FIELDS.includes(field)) return vfs_fail('ENOENT');
    if (field === 'log' && this.source.log) {
      const whole: string | null = await this.source.log(id);
      if (whole !== null) return vfs_ok(whole);
    }
    return vfs_ok(taskField_text(task, field));
  }

  async readBinary(where: string): Promise<VfsOutcome<Buffer>> {
    const text: VfsOutcome<string> = await this.read(where);
    return text.ok ? vfs_ok(Buffer.from(text.value, 'utf-8')) : text;
  }

  async cp(_src: string, _dest: string, _options: CpOptions): Promise<VfsOutcome> {
    return vfs_fail('EROFS', `cp: a task is not copied: ${this.prefix} is the ${this.source.label}`);
  }
}
