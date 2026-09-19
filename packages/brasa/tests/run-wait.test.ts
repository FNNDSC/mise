/**
 * @file Unit tests for waiting on scheduled work.
 *
 * The claims worth pinning: a wait ends when every node it was given has
 * settled, not when the first one does; a cancellation DETACHES rather than
 * killing, because the run continues either way and the operator needs its
 * handle; and losing touch with CUBE is reported as not knowing, never as
 * failure — a run whose status cannot be read has not failed.
 */
import { describe, it, expect, jest, beforeEach } from '@jest/globals';

/** Status answers, one per poll, replayed in order; the last one repeats. */
let answers: Array<Map<number, string>> = [];
let asked: number = 0;

jest.unstable_mockModule('@fnndsc/salsa', () => ({
  jobs_statusBatch: async (): Promise<Map<number, string>> => {
    const answer: Map<number, string> = answers[Math.min(asked, answers.length - 1)] ?? new Map();
    asked += 1;
    return answer;
  },
}));

const progressed: unknown[] = [];
jest.unstable_mockModule('../src/core/sink.js', () => ({
  sink_get: () => ({ progress_write: (event: unknown): void => { progressed.push(event); } }),
}));

const { runs_awaitSettled, settlement_render, elapsed_render } = await import('../src/builtins/res/runWait.js');
const { commandCancellation_run, commandCancellation_request } = await import('../src/core/cancellation.js');

/** A status answer for a set of instances. */
function answer(entries: Record<number, string>): Map<number, string> {
  return new Map(Object.entries(entries).map(([id, status]): [number, string] => [Number(id), status]));
}

beforeEach(() => {
  answers = [];
  asked = 0;
  progressed.length = 0;
});

describe('runs_awaitSettled', () => {
  it('returns at once when the work is already done', async () => {
    answers = [answer({ 7: 'finishedSuccessfully' })];
    const settlement = await runs_awaitSettled([7], 'pl-dcm2niix', { pollMs: 1 });
    expect(settlement.outcome).toBe('settled');
    expect(settlement.failed).toBe(0);
    expect(asked).toBe(1);
  });

  it('waits for EVERY node, not the first one to finish', async () => {
    answers = [
      answer({ 7: 'finishedSuccessfully', 8: 'started' }),
      answer({ 7: 'finishedSuccessfully', 8: 'started' }),
      answer({ 7: 'finishedSuccessfully', 8: 'finishedSuccessfully' }),
    ];
    const settlement = await runs_awaitSettled([7, 8], 'a pipeline', { pollMs: 1 });
    expect(settlement.outcome).toBe('settled');
    expect(asked).toBe(3);
  });

  it('counts a node that ended badly, and says which', async () => {
    answers = [answer({ 7: 'finishedSuccessfully', 8: 'finishedWithError' })];
    const settlement = await runs_awaitSettled([7, 8], 'a pipeline', { pollMs: 1 });
    expect(settlement.outcome).toBe('settled');
    expect(settlement.failed).toBe(1);
    expect(settlement_render(settlement, 'a pipeline')).toContain('8 finishedWithError');
  });

  it('DETACHES on cancellation, keeping the handle', async () => {
    answers = [answer({ 7: 'started' })];
    const settlement = await commandCancellation_run(async () => {
      const waiting = runs_awaitSettled([7], 'pl-dcm2niix', { pollMs: 20 });
      // The operator presses Esc while the run is still going.
      setTimeout((): void => { commandCancellation_request(); }, 5);
      return await waiting;
    });
    expect(settlement.outcome).toBe('detached');
    expect(settlement.instanceIDs).toEqual([7]);
    const rendered: string = settlement_render(settlement, 'pl-dcm2niix');
    expect(rendered).toContain('the run continues');
    expect(rendered).toContain('7');
  });

  it('reports not knowing when CUBE stops answering, never failure', async () => {
    answers = [new Map()];
    const settlement = await runs_awaitSettled([7], 'pl-dcm2niix', { pollMs: 1 });
    expect(settlement.outcome).toBe('unreachable');
    expect(settlement.failed).toBe(0);
    expect(settlement_render(settlement, 'pl-dcm2niix')).toContain('may still be going');
  });

  it('says how the work is going on the progress channel', async () => {
    answers = [
      answer({ 7: 'started', 8: 'started' }),
      answer({ 7: 'finishedSuccessfully', 8: 'finishedSuccessfully' }),
    ];
    await runs_awaitSettled([7, 8], 'a pipeline', { pollMs: 1 });
    expect(progressed.length).toBe(2);
    expect(progressed[0]).toMatchObject({ operation: 'workflow', phase: 'working', current: 0, total: 2 });
    expect(progressed[1]).toMatchObject({ phase: 'complete', current: 2, total: 2, status: 'done' });
  });

  it('waits on nothing without asking anything', async () => {
    const settlement = await runs_awaitSettled([], 'nothing', { pollMs: 1 });
    expect(settlement.outcome).toBe('settled');
    expect(asked).toBe(0);
  });
});

describe('elapsed_render', () => {
  it('reads the way an operator says a duration', () => {
    expect(elapsed_render(4200)).toBe('4s');
    expect(elapsed_render(134000)).toBe('2m14s');
  });
});
