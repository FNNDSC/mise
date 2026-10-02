/**
 * @file The replay track: a replay begins with every dated node hidden and
 * the scene redrawn, shows what arrives and hides what leaves, tells the
 * host each moment it moves, and redraws whole when it stops.
 */
import { describe, it, expect, beforeEach } from '@jest/globals';
import { REPLAY_WALL_MS } from '../src/controls/replay.js';
import { ReplayTrack } from '../src/scene/replayTrack.js';
import type { StarField } from '../src/draw/index.js';

/** A star field that records what the replay asked of it. */
class StarsStub {
  public presence: Map<string, number> = new Map();
  public flashes: Map<string, number> = new Map();
  public threadsPresent: ((id: string) => boolean) | null = null;
  public flushes: number = 0;
  public presence_set(ids: Iterable<string>, presence: number): void {
    for (const id of ids) this.presence.set(id, presence);
  }
  public flash_set(id: string, strength: number): void {
    this.flashes.set(id, strength);
  }
  public threads_present(present: (id: string) => boolean): void {
    this.threadsPresent = present;
  }
  public flush(): void {
    this.flushes += 1;
  }
}

const day: number = 86_400_000;
let now: number;
let stars: StarsStub;
let redraws: number;
let moves: Array<[number, boolean]>;
let track: ReplayTrack;

beforeEach(() => {
  now = 1_000_000;
  stars = new StarsStub();
  redraws = 0;
  moves = [];
  track = new ReplayTrack({
    stars: stars as unknown as StarField,
    redraw: (): void => { redraws += 1; },
    moved: (at: number, playing: boolean): void => { moves.push([at, playing]); },
    now: () => now,
  });
});

describe('ReplayTrack', () => {
  it('is idle until begun', () => {
    expect(track.active()).toBe(false);
    expect(track.state()).toBeNull();
    track.step();
    track.seek(0);
    track.stop();
    expect(redraws).toBe(0);
  });

  it('begins with a redraw and every dated node hidden; undated threads stay', () => {
    track.begin(new Map([['a', 0], ['b', 5 * day]]));
    expect(track.active()).toBe(true);
    expect(redraws).toBe(1);
    expect(stars.presence.get('a')).toBe(0);
    expect(stars.presence.get('b')).toBe(0);
    expect(stars.threadsPresent?.('a')).toBe(false);
    expect(stars.threadsPresent?.('undated')).toBe(true);
    expect(track.state()).toEqual({ playing: true, at: 0, span: [0, 5 * day] });
  });

  it('shows arrivals as the clock plays, flashes them, and tells the host', () => {
    track.begin(new Map([['a', 0], ['b', 5 * day]]));
    now += 1;
    track.step();
    expect(stars.presence.get('a')).toBe(1);
    expect(stars.presence.get('b')).toBe(0);
    expect(stars.flashes.get('a')).toBeGreaterThan(0);
    expect(stars.threadsPresent?.('a')).toBe(true);
    expect(moves.length).toBe(1);
    expect(moves[0]?.[1]).toBe(true);
    now += REPLAY_WALL_MS;
    track.step();
    expect(stars.presence.get('b')).toBe(1);
    // The last step reported the stop.
    expect(moves[moves.length - 1]?.[1]).toBe(false);
  });

  it('seeks back: what had not arrived by then is hidden again, its flash gone', () => {
    track.begin(new Map([['a', 0], ['b', 5 * day]]));
    now += REPLAY_WALL_MS + 1;
    track.step();
    expect(stars.presence.get('b')).toBe(1);
    track.pause();
    track.seek(day);
    expect(stars.presence.get('b')).toBe(0);
    expect(stars.flashes.get('b')).toBe(0);
    expect(stars.presence.get('a')).toBe(1);
    expect(track.state()?.playing).toBe(false);
    track.play(2);
    expect(track.state()?.playing).toBe(true);
  });

  it('repaints as it stands when the scene redraws under it', () => {
    track.begin(new Map([['a', 0], ['b', 5 * day]]));
    now += 1;
    track.step();
    stars.presence.clear();
    track.paintAll();
    expect(stars.presence.get('a')).toBe(1);
    expect(stars.presence.get('b')).toBe(0);
  });

  it('stops with one redraw and goes idle', () => {
    track.begin(new Map([['a', 0]]));
    track.stop();
    expect(track.active()).toBe(false);
    expect(redraws).toBe(2);
    track.stop();
    expect(redraws).toBe(2);
  });
});
