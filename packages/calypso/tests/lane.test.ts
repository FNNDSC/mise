/**
 * @file The lane: lines that change the same session state take turns,
 * first come first served; a line holding nothing runs beside anything; the
 * turn is given up however the work ends, and a holder can step aside and
 * queue again.
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
    const mine = await lane.acquire();
    order.push('a works');
    lane.release(mine);
    const b = lane.run(async () => { order.push('b runs'); });
    const back = lane.acquire().then((hold) => { order.push('a back'); lane.release(hold); });
    await Promise.all([b, back]);
    expect(order).toEqual(['a works', 'b runs', 'a back']);
    expect(lane.busy).toBe(false);
  });

  it('runs a line holding nothing beside one holding everything, and lines holding a piece in common in turn', async () => {
    const lane = new Lane();
    const order: string[] = [];
    let openWriter: () => void = (): void => undefined;
    const writer = lane.run(async () => { order.push('pull in'); await new Promise<void>((r) => { openWriter = r; }); order.push('pull out'); });
    await lane.run(async () => { order.push('ls'); }, new Set());
    const cd = lane.run(async () => { order.push('cd'); }, new Set(['cwd']));
    await Promise.resolve();
    expect(order).toEqual(['pull in', 'ls']);
    openWriter();
    await Promise.all([writer, cd]);
    expect(order).toEqual(['pull in', 'ls', 'pull out', 'cd']);
  });

  it('never lets a later line overtake an earlier one it conflicts with', async () => {
    const lane = new Lane();
    const order: string[] = [];
    let openFirst: () => void = (): void => undefined;
    const first = lane.run(async () => { order.push('cd 1'); await new Promise<void>((r) => { openFirst = r; }); }, new Set(['cwd']));
    const all = lane.run(async () => { order.push('undeclared'); });
    const cohort = lane.run(async () => { order.push('gather'); }, new Set(['cohort']));
    await Promise.resolve();
    // The cohort is free, but the undeclared line ahead of it wants it too.
    expect(order).toEqual(['cd 1']);
    expect(lane.waiting).toBe(2);
    openFirst();
    await Promise.all([first, all, cohort]);
    expect(order).toEqual(['cd 1', 'undeclared', 'gather']);
  });
});
