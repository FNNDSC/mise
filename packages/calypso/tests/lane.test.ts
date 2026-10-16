/**
 * @file The lane: one turn at a time, first come first served; the turn is
 * given up however the work ends, and a holder can step aside and queue
 * again.
 *
 * @module
 */
import { Lane } from '../src/daemon/lane';

describe('Lane', () => {
  it('gives the turn in arrival order, one at a time', async () => {
    const lane = new Lane();
    const order: string[] = [];
    let openA: () => void = (): void => undefined;
    const a = lane.run(async () => { order.push('a in'); await new Promise<void>((r) => { openA = r; }); order.push('a out'); });
    const b = lane.run(async () => { order.push('b'); });
    const c = lane.run(async () => { order.push('c'); });
    await Promise.resolve();
    expect(order).toEqual(['a in']);
    expect(lane.waiting).toBe(2);
    expect(lane.busy).toBe(true);
    openA();
    await Promise.all([a, b, c]);
    expect(order).toEqual(['a in', 'a out', 'b', 'c']);
    expect(lane.busy).toBe(false);
    expect(lane.waiting).toBe(0);
  });

  it('gives the turn up when the work throws', async () => {
    const lane = new Lane();
    await expect(lane.run(async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    expect(lane.busy).toBe(false);
    await expect(lane.run(async () => 'next')).resolves.toBe('next');
  });

  it('a holder can step aside and take its place in line again', async () => {
    const lane = new Lane();
    const order: string[] = [];
    await lane.acquire();
    order.push('a works');
    lane.release();
    const b = lane.run(async () => { order.push('b runs'); });
    const back = lane.acquire().then(() => { order.push('a back'); lane.release(); });
    await Promise.all([b, back]);
    expect(order).toEqual(['a works', 'b runs', 'a back']);
    expect(lane.busy).toBe(false);
  });
});
