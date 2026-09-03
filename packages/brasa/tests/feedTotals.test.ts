/**
 * @file The roster's totals: derived from resident nodes only, output bytes
 * summed, wall span from first start to last end (to now while running),
 * absent — never zero — for a feed whose topology is not resident.
 */
import type { ProcInstance } from '@fnndsc/cumin';
import { feedTotals_derive } from '../src/builtins/proc.js';

function inst(over: Partial<ProcInstance>): ProcInstance {
  return { id: 1, feedID: 7, parentID: null, pluginName: 'pl', params: null, status: 'finishedSuccessfully', ...over };
}

function cache_of(loaded: boolean, instances: ProcInstance[]) {
  return {
    topologyLoaded_has: (): boolean => loaded,
    feedInstanceIDs_get: (): number[] => instances.map((i: ProcInstance): number => i.id),
    instance_get: (id: number): ProcInstance | undefined => instances.find((i: ProcInstance): boolean => i.id === id),
  };
}

describe('feedTotals_derive', () => {
  it('says nothing for a feed whose topology is not resident', () => {
    expect(feedTotals_derive(cache_of(false, [inst({ outputBytes: 5 })]), 7)).toEqual({});
  });

  it('sums output bytes and spans first start to last end', () => {
    const totals = feedTotals_derive(cache_of(true, [
      inst({ id: 1, outputBytes: 100, startedAt: '2026-01-01T00:00:00Z', finishedAt: '2026-01-01T00:01:00Z' }),
      inst({ id: 2, outputBytes: 50, startedAt: '2026-01-01T00:00:30Z', finishedAt: '2026-01-01T00:03:30Z' }),
    ]), 7);
    expect(totals).toEqual({ sizeBytes: 150, wallSeconds: 210 });
  });

  it('skips nodes the cache no longer holds, and ends that were never started', () => {
    const cache = cache_of(true, [
      inst({ id: 1, outputBytes: 7, finishedAt: '2026-01-01T00:01:00Z' }),
    ]);
    const withGhost = { ...cache, feedInstanceIDs_get: (): number[] => [1, 99] };
    expect(feedTotals_derive(withGhost, 7)).toEqual({ sizeBytes: 7 });
  });

  it('spans to now while a node still runs, and omits bytes never observed', () => {
    const start: number = Date.now() - 90_000;
    const totals = feedTotals_derive(cache_of(true, [
      inst({ id: 1, startedAt: new Date(start).toISOString(), status: 'started' }),
    ]), 7);
    expect(totals.sizeBytes).toBeUndefined();
    expect(totals.wallSeconds).toBeGreaterThanOrEqual(89);
    expect(totals.wallSeconds).toBeLessThanOrEqual(92);
  });
});
