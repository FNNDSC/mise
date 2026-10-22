/**
 * @file `kill` and `wait`: the shell's job verbs over the runner's jobs
 * (core/runner.ts).
 *
 * A job is named as it is mounted, `/proc/<source>/<id>`, or as
 * `<source>/<id>`, or by its id alone when one source has it. `kill` asks a
 * job to stop and is silent when it does, as kill(1) is; the job ends when
 * its current operation does, and a second `kill` says so rather than
 * forcing it, because a cloud job cut short can leave its state locked.
 * `wait` follows a job's log until it ends, and its status is the job's:
 * Ctrl-C stops following, never the job.
 *
 * @module
 */
import { envelope_error, envelope_ok, taskState_isOver, type CommandEnvelope } from '@fnndsc/menu';
import { runner_get, type JobRecord, type JobRunner, type JobStopResult } from '../../core/runner.js';
import { commandCancellation_enable, commandCancellation_signalGet } from '../../core/cancellation.js';
import { sink_dataLine } from '../../core/sink.js';

/** A job a word names. */
interface JobName {
  source: string;
  id: string;
}

/**
 * The job a word names.
 *
 * @param runner - The session's runner.
 * @param word - `/proc/<source>/<id>`, `<source>/<id>`, or `<id>`.
 * @returns The job, or a reason it names none.
 */
export function jobName_resolve(runner: JobRunner, word: string): JobName | { error: string } {
  const parts: string[] = word.replace(/^\/proc\//, '').split('/').filter(Boolean);
  if (parts.length === 2) return { source: parts[0] as string, id: parts[1] as string };
  if (parts.length !== 1) return { error: 'no such task' };
  const matches: JobRecord[] = runner.jobs_list().filter((record: JobRecord): boolean => record.id === parts[0]);
  if (matches.length === 0) return { error: 'no such task' };
  if (matches.length > 1) return { error: `ambiguous: ${matches.map((record: JobRecord): string => `/proc/${record.source}/${record.id}`).sort().join(', ')}` };
  return { source: (matches[0] as JobRecord).source, id: (matches[0] as JobRecord).id };
}

/** What `kill` says for each outcome but a quiet success. */
const STOP_WORDS: Record<Exclude<JobStopResult, 'stopping'>, (record: JobRecord | undefined) => string> = {
  'already-stopping': (): string => 'already asked to stop; it ends when its current operation does',
  'not-running': (record: JobRecord | undefined): string => `not running (${record?.state ?? 'ended'})`,
  unknown: (): string => 'no such task',
};

/**
 * `kill <task>…`: asks each job to stop.
 *
 * @param args - The words after `kill`.
 * @returns The envelope: quiet on success, a line per job that could not be asked.
 */
export async function builtin_kill(args: string[]): Promise<CommandEnvelope> {
  const flag: string | undefined = args.find((word: string): boolean => word.startsWith('-'));
  if (flag !== undefined) return envelope_error('', undefined, `kill: ${flag}: a task is never forced; kill asks it to stop\n`);
  if (args.length === 0) return envelope_error('', undefined, 'kill: usage: kill <task>…\n');
  const runner: JobRunner | null = runner_get();
  if (runner === null) return envelope_error('', undefined, 'kill: this session runs no tasks\n');
  const complaints: string[] = [];
  const stopped: string[] = [];
  for (const word of args) {
    const name: JobName | { error: string } = jobName_resolve(runner, word);
    if ('error' in name) { complaints.push(`kill: ${word}: ${name.error}`); continue; }
    const result: JobStopResult = runner.job_stop(name.source, name.id);
    if (result === 'stopping') { stopped.push(`/proc/${name.source}/${name.id}`); continue; }
    complaints.push(`kill: ${word}: ${STOP_WORDS[result](runner.job_get(name.source, name.id))}`);
  }
  const data: Record<string, unknown> = { stopping: stopped };
  if (complaints.length > 0) return envelope_error('', undefined, `${complaints.join('\n')}\n`);
  return envelope_ok('', { kind: 'tasks.kill', data });
}

/**
 * `wait [<task>…]`: follows each job's log until it ends; bare, every running job.
 *
 * @param args - The words after `wait`.
 * @returns The envelope: failed when a job did not end done, or following was stopped.
 */
export async function builtin_wait(args: string[]): Promise<CommandEnvelope> {
  const flag: string | undefined = args.find((word: string): boolean => word.startsWith('-'));
  if (flag !== undefined) return envelope_error('', undefined, `wait: ${flag}: unknown option\n`);
  const runner: JobRunner | null = runner_get();
  if (runner === null) return args.length === 0 ? envelope_ok('') : envelope_error('', undefined, 'wait: this session runs no tasks\n');
  const names: Array<JobName | { error: string; word: string }> = args.length === 0
    ? runner.jobs_list().filter((record: JobRecord): boolean => !taskState_isOver(record.state)).map((record: JobRecord): JobName => ({ source: record.source, id: record.id }))
    : args.map((word: string): JobName | { error: string; word: string } => {
      const name: JobName | { error: string } = jobName_resolve(runner, word);
      return 'error' in name ? { ...name, word } : name;
    });
  commandCancellation_enable();
  const signal: AbortSignal | undefined = commandCancellation_signalGet();
  const complaints: string[] = [];
  const ended: JobRecord[] = [];
  for (const name of names) {
    if ('error' in name) { complaints.push(`wait: ${name.word}: ${name.error}`); continue; }
    if (signal?.aborted === true) break;
    const record: JobRecord | undefined = await runner.job_follow(name.source, name.id, (line: string): void => sink_dataLine(line), signal);
    if (record === undefined) { complaints.push(`wait: ${name.id}: no such task`); continue; }
    if (!taskState_isOver(record.state)) { complaints.push(`wait: stopped following; /proc/${record.source}/${record.id} goes on`); break; }
    ended.push(record);
    if (record.state !== 'done') complaints.push(`wait: /proc/${record.source}/${record.id}: ${record.state}${record.outcome !== undefined ? ` (${record.outcome})` : ''}`);
  }
  const data: Record<string, unknown> = { ended };
  if (complaints.length > 0) return envelope_error('', undefined, `${complaints.join('\n')}\n`);
  return envelope_ok('', { kind: 'tasks.wait', data });
}
