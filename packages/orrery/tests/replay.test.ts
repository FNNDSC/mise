/**
 * @file The replay's clock: arrivals in order over a fixed wall time, a
 * speed, a pause, a seek back that sends nodes away again, a flash that
 * fades, and a stop at the last arrival.
 */
import { describe, it, expect, beforeEach } from '@jest/globals';
import { ReplayClock, REPLAY_WALL_MS, REPLAY_FLASH_MS } from '../src/controls/replay.js';

let now: number;
let clock: ReplayClock;
const day: number = 86_400_000;

beforeEach(() => {
  now = 1_000_000;
  // Four feeds over ten days; c and d the same day.
  clock = new ReplayClock(new Map([['a', 0], ['b', 5 * day], ['c', 10 * day], ['d', 10 * day]]), () => now);
});

describe('ReplayClock', () => {
  it('knows its span and its order', () => {
    expect(clock.span()).toEqual([0, 10 * day]);
    expect(clock.ids()).toEqual(['a', 'b', 'c', 'd']);
    expect(clock.playing()).toBe(false);
  });

  it('reveals in order over the wall time, and stops at the last arrival', () => {
    clock.play();
    now += 1;
    expect(clock.step().arrived).toEqual(['a']);
    now += REPLAY_WALL_MS / 2;
    const middle = clock.step();
    expect(middle.arrived).toEqual(['b']);
    // One wall millisecond is 10 days / 30 s of history; the first step took one.
    expect(middle.at).toBeCloseTo(5 * day + (10 * day) / REPLAY_WALL_MS, 3);
    now += REPLAY_WALL_MS;
    const end = clock.step();
    expect(end.arrived).toEqual(['c', 'd']);
    expect(end.done).toBe(true);
    expect(clock.playing()).toBe(false);
    expect(clock.at()).toBe(10 * day);
  });

  it('runs faster at a higher speed, and not at all while paused', () => {
    clock.play(4);
    now += REPLAY_WALL_MS / 4;
    expect(clock.step().done).toBe(true);
    clock.seek(0);
    clock.pause();
    now += REPLAY_WALL_MS;
    expect(clock.step()).toEqual({ at: 0, arrived: [], departed: [], done: false });
  });

  it('seeks back and sends later arrivals away, and forward without a flash', () => {
    clock.seek(10 * day);
    const back = clock.seek(4 * day);
    expect(back.departed).toEqual(['d', 'c', 'b']);
    expect(clock.seek(6 * day).arrived).toEqual(['b']);
    expect(clock.flashing().size).toBe(0);
  });

  it('flashes what arrives, fading, and reports a faded flash once at zero', () => {
    clock.play();
    now += 1;
    clock.step();
    now += REPLAY_FLASH_MS / 2;
    expect(clock.flashing().get('a')).toBeCloseTo(0.5, 2);
    now += REPLAY_FLASH_MS;
    expect(clock.flashing().get('a')).toBe(0);
    expect(clock.flashing().has('a')).toBe(false);
  });

  it('starts over when played at its end', () => {
    clock.seek(10 * day);
    clock.play();
    expect(clock.at()).toBe(0);
  });

  it('crosses a history of one moment at once, and an empty one is done', () => {
    const one = new ReplayClock(new Map([['x', 7], ['y', 7]]), () => now);
    one.play();
    now += 1;
    expect(one.step()).toMatchObject({ arrived: ['x', 'y'], done: true });
    expect(new ReplayClock(new Map(), () => now).step().done).toBe(true);
  });
});
