/**
 * @file `joblets` and `fg`: the shell's verbs over lines run in the
 * background (core/joblets.ts).
 *
 * `joblets` lists them, as a shell's `jobs` does (the word `jobs` is the
 * ChRIS backend's, for plugin instances). `fg %1` brings one to the front:
 * it asks the question the joblet waits on, here, then follows its log
 * until it ends. Ctrl-C stops following, never the joblet; `kill %1` stops
 * it.
 *
 * @module
 */
import { envelope_error, envelope_ok, taskState_isOver, type CommandEnvelope } from '@fnndsc/menu';
import { runner_get, type JobRecord, type JobRunner } from '../../core/runner.js';
import { commandCancellation_enable, commandCancellation_signalGet } from '../../core/cancellation.js';
import { sink_dataLine } from '../../core/sink.js';
import { surface_get } from '../../core/surface.js';
import { JOBLETS_SOURCE_ID, joblet_isWaiting, jobletQuestion_await, jobletWord_parse, type JobletQuestion } from '../../core/joblets.js';

/**
 * A joblet's state, as `joblets` prints it.
 *
 * @param record - Its record.
 * @returns The word.
 */
function jobletState_word(record: JobRecord): string {
  if (!taskState_isOver(record.state)) return joblet_isWaiting(Number(record.id)) ? 'Waiting for an answer' : 'Running';
  if (record.state === 'done') return 'Done';
  if (record.state === 'cancelled') return 'Stopped';
  const exit: unknown = record.data.exit;
  return record.outcome === 'ended by restart' ? 'Ended by restart' : `Failed (exit ${typeof exit === 'number' ? exit : 1})`;
}

/**
 * `joblets`: every joblet the session has kept, by number.
 *
 * @param args - The words after `joblets`.
 * @returns The listing.
 */
export async function builtin_joblets(args: string[]): Promise<CommandEnvelope> {
  if (args.length > 0) return envelope_error('', undefined, `joblets: ${args[0]}: takes no operands; ls /proc/joblets/<N> reads one\n`);
  const runner: JobRunner | null = runner_get();
  const records: JobRecord[] = (runner?.jobs_list(JOBLETS_SOURCE_ID) ?? [])
    .sort((a: JobRecord, b: JobRecord): number => Number(a.id) - Number(b.id));
  const lines: string[] = records.map((record: JobRecord): string => `[${record.id}]  ${jobletState_word(record).padEnd(22)}  ${record.label}${taskState_isOver(record.state) ? '' : ' &'}`);
  return envelope_ok(lines.length === 0 ? '' : `${lines.join('\n')}\n`, {
    kind: 'joblets.list',
    data: records.map((record: JobRecord) => ({ number: Number(record.id), line: record.label, state: jobletState_word(record), path: `/proc/${JOBLETS_SOURCE_ID}/${record.id}` })),
  });
}

/**
 * `fg [%N]`: brings a joblet to the front: answers what it waits on here,
 * and follows its log until it ends.
 *
 * @param args - The words after `fg`.
 * @returns The joblet's status: 0 when it ended done.
 */
export async function builtin_fg(args: string[]): Promise<CommandEnvelope> {
  if (args.length > 1) return envelope_error('', undefined, 'fg: usage: fg [%N]\n');
  const runner: JobRunner | null = runner_get();
  const number: number | null = jobletWord_parse(args[0] ?? '%%');
  const record: JobRecord | undefined = number === null || runner === null ? undefined : runner.job_get(JOBLETS_SOURCE_ID, String(number));
  if (runner === null || number === null || record === undefined) return envelope_error('', undefined, `fg: ${args[0] ?? '%%'}: no such joblet\n`);
  commandCancellation_enable();
  const signal: AbortSignal | undefined = commandCancellation_signalGet();
  sink_dataLine(record.label);
  const followed: Promise<JobRecord | undefined> = runner.job_followAside(JOBLETS_SOURCE_ID, String(number), (line: string): void => sink_dataLine(line), signal);
  // Its questions are asked here, as they come, until it ends.
  const answering: Promise<void> = (async (): Promise<void> => {
    for (;;) {
      const question: JobletQuestion | null = await jobletQuestion_await(number, followed);
      if (question === null) return;
      try {
        question.answer(await surface_get().prompt(question.request));
      } catch (error: unknown) {
        question.refuse(error instanceof Error ? error : new Error(String(error)));
      }
    }
  })();
  const ended: JobRecord | undefined = await followed;
  await answering;
  if (ended === undefined || !taskState_isOver(ended.state)) {
    return envelope_error('', undefined, `fg: stopped following; %${number} goes on (kill %${number} stops it)\n`);
  }
  if (ended.state === 'done') return envelope_ok('', { kind: 'joblet.ended', data: { ...ended } });
  return envelope_error('', undefined, `fg: %${number}: ${jobletState_word(ended)}${ended.outcome !== undefined && ended.outcome !== 'stopped when asked' ? `: ${ended.outcome}` : ''}\n`);
}
