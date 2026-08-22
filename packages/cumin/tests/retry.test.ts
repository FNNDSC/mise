/**
 * Tests for the bounded retry-with-backoff helper.
 */
import { retry_untilValue } from '../src/utils/retry';

describe('retry_untilValue', () => {
  it('returns the first non-null value without further attempts', async () => {
    const fn = jest.fn(async () => 'hit');
    expect(await retry_untilValue(3, [1], fn)).toBe('hit');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries through nulls and returns a later success', async () => {
    const fn = jest.fn(async (attempt: number) => (attempt < 2 ? null : 'third'));
    expect(await retry_untilValue(3, [1, 1], fn)).toBe('third');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('returns null when every attempt fails', async () => {
    const fn = jest.fn(async () => null);
    expect(await retry_untilValue(2, [1], fn)).toBeNull();
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('reuses the last delay when attempts outnumber delays', async () => {
    jest.useFakeTimers();
    const timestamps: number[] = [];
    const fn = jest.fn(async () => { timestamps.push(Date.now()); return null; });
    const run = retry_untilValue(4, [10, 20], fn);
    await jest.advanceTimersByTimeAsync(100);
    await run;
    jest.useRealTimers();
    expect(fn).toHaveBeenCalledTimes(4);
    // Delays: none, 10, 20, then 20 again (last reused).
    expect(timestamps[1] - timestamps[0]).toBe(10);
    expect(timestamps[2] - timestamps[1]).toBe(20);
    expect(timestamps[3] - timestamps[2]).toBe(20);
  });

  it('passes the 0-based attempt index through', async () => {
    const seen: number[] = [];
    await retry_untilValue(3, [1], async (attempt: number) => { seen.push(attempt); return null; });
    expect(seen).toEqual([0, 1, 2]);
  });
});
