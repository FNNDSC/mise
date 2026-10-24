/**
 * @jest-environment jsdom
 */
/**
 * @file Motion: the line parser, the frames' clock, the crossing geometry,
 * and the bridge playing what the engine's lines say on its picture, in
 * their order, from a state with a Klingon in the quadrant (seed 13).
 */
import { describe, it, expect, beforeAll } from '@jest/globals';
import { trek_play } from 'bsd-trek';
import type { TrekState, TrekTerminal } from 'bsd-trek/host';
import { TrekBridge } from '../../src/features/trek/bridge.js';
import { course_between, crossing_compute, FrameQueue, lineEvent_parse } from '../../src/features/trek/motion.js';

const shown: TrekState[] = [];
if (typeof globalThis.structuredClone !== 'function') (globalThis as { structuredClone?: <T>(v: T) => T }).structuredClone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

beforeAll(async () => {
  const script: string[] = ['', 's', 'n', 'pw', 'srscan', 'terminate', 'n'];
  const terminal: TrekTerminal = {
    text_write: (): void => undefined,
    question_ask: async (): Promise<string | null> => (script.length > 0 ? (script.shift() as string) : null),
    seconds_sleep: async (): Promise<void> => {},
    state_show: (state: TrekState): void => { shown.push(state); },
  };
  await trek_play(terminal, { seed: 13, fast: 1, trace: 0, styled: false }, { saved: null });
});

/** A bridge whose frames play at once (reduced motion), with its cues recorded. */
function bridge_make(): { bridge: TrekBridge; cues: string[] } {
  (window as unknown as { matchMedia: (q: string) => { matches: boolean } }).matchMedia = (): { matches: boolean } => ({ matches: true });
  const cues: string[] = [];
  const voice = { pill: (): void => undefined, cue: (name: string): void => { cues.push(name); } };
  const bridge: TrekBridge = new TrekBridge({ voice, leave: (): void => undefined }, 13);
  document.body.append(bridge.root);
  return { bridge, cues };
}

/** The kinds drawn on the scan at a sector. */
function sector_kind(bridge: TrekBridge, x: number, y: number): string {
  const node: Element | null = bridge.root.querySelector(`.tb-sector[data-x="${x}"][data-y="${y}"]`);
  return [...(node?.classList ?? [])].find((c: string): boolean => c.startsWith('tb-sector-')) ?? '';
}

describe('the line parser', () => {
  it('names what a line moves: a track and its points, a kill, a nova, a phaser hit, a hit on the ship, a Klingon\'s move and escape, a supernova', () => {
    expect(lineEvent_parse('Torpedo track:')).toEqual({ kind: 'torpedo-head' });
    expect(lineEvent_parse('Torpedo track, torpedo number 2:')).toEqual({ kind: 'torpedo-head' });
    expect(lineEvent_parse('   9.5\t 1.5')).toEqual({ kind: 'torpedo-point', at: { x: 9.5, y: 1.5 } });
    expect(lineEvent_parse('Torpedo missed')).toEqual({ kind: 'torpedo-end' });
    expect(lineEvent_parse('   *** Klingon at 0,2 destroyed ***')).toEqual({ kind: 'kill', at: { x: 0, y: 2 } });
    expect(lineEvent_parse('Spock: Star at 0,3 gone nova')).toEqual({ kind: 'nova', at: { x: 0, y: 3 } });
    expect(lineEvent_parse('Photon tubes misfire on torpedo 3')).toEqual({ kind: 'misfire' });
    expect(lineEvent_parse('191 unit hit on Klingon at 0,2')).toEqual({ kind: 'phaser', at: { x: 0, y: 2 } });
    expect(lineEvent_parse('HIT: 38 units from 0,2, shields absorb 89%, effective hit 4')).toEqual({ kind: 'incoming', hit: 38, from: { x: 0, y: 2 }, absorb: 89 });
    // the sensors damaged: the engine names no sector
    expect(lineEvent_parse('HIT: 38 units, shields absorb 89%, effective hit 4')).toEqual({ kind: 'incoming', hit: 38, from: null, absorb: 89 });
    expect(lineEvent_parse('HIT: 38 units from 0,2')).toEqual({ kind: 'incoming', hit: 38, from: { x: 0, y: 2 }, absorb: 0 });
    expect(lineEvent_parse('Klingon at 0,2 moves to 6,2')).toEqual({ kind: 'klingon-move', from: { x: 0, y: 2 }, to: { x: 6, y: 2 } });
    expect(lineEvent_parse('Klingon at 0,2 escapes to quadrant 6,6')).toEqual({ kind: 'klingon-escape', from: { x: 0, y: 2 }, quadrant: { x: 6, y: 6 } });
    expect(lineEvent_parse('RED ALERT: supernova occurring at 3,4')).toEqual({ kind: 'supernova', at: { x: 3, y: 4 } });
    expect(lineEvent_parse('  in quadrant 2,5.  Caution is advised')).toEqual({ kind: 'supernova-report', quadrant: { x: 2, y: 5 } });
    expect(lineEvent_parse('Stardate 3900.00: Klingon attack:')).toBeNull();
    expect(lineEvent_parse('Spock: Star at 0,3 failed to nova.')).toBeNull();
  });
});

describe('the frames\' clock', () => {
  it('plays frames in order, one at a time, and a skip finishes the rest at once', async () => {
    const queue: FrameQueue = new FrameQueue((): boolean => false);
    const order: string[] = [];
    queue.push({ kind: 'a', run: async (): Promise<void> => { order.push('a:start'); await queue.wait(30); order.push('a:end'); } });
    queue.push({ kind: 'b', run: async (instant: boolean): Promise<void> => { order.push(`b:${instant ? 'instant' : 'paced'}`); await queue.wait(30); } });
    queue.push({ kind: 'c', run: (instant: boolean): void => { order.push(`c:${instant ? 'instant' : 'paced'}`); } });
    expect(order).toEqual(['a:start']);
    expect(queue.busy_is()).toBe(true);
    await new Promise((resolve: () => void): void => { setTimeout(resolve, 5); });
    queue.skip();
    await queue.settle();
    expect(order).toEqual(['a:start', 'a:end', 'b:instant', 'c:instant']);
    expect(queue.played).toEqual({ a: 1, b: 1, c: 1 });
    // after the skip the clock runs at pace again
    queue.push({ kind: 'd', run: (instant: boolean): void => { order.push(`d:${instant ? 'instant' : 'paced'}`); } });
    await queue.settle();
    expect(order.at(-1)).toBe('d:paced');
  });

  it('reduced motion plays every frame instant; a tween steps to 1 and a skipped tween lands on 1', async () => {
    const reduced: FrameQueue = new FrameQueue((): boolean => true);
    const seen: boolean[] = [];
    reduced.push({ kind: 'x', run: (instant: boolean): void => { seen.push(instant); } });
    await reduced.settle();
    expect(seen).toEqual([true]);
    const queue: FrameQueue = new FrameQueue((): boolean => false);
    const shares: number[] = [];
    const tween: Promise<void> = queue.tween(40, (share: number): void => { shares.push(share); });
    queue.push({ kind: 'y', run: (): void => undefined });
    await tween;
    expect(shares.at(-1)).toBe(1);
    expect(shares.every((s: number, i: number): boolean => i === 0 || s >= (shares[i - 1] as number))).toBe(true);
  });
});

describe('the geometry', () => {
  it('a course is the C\'s: 0 up the scan, 90 to the right; a crossing leaves by the edge the line meets and enters by the matching one', () => {
    expect(course_between({ x: 9, y: 1 }, { x: 0, y: 1 })).toBe(0);
    expect(course_between({ x: 9, y: 1 }, { x: 9, y: 6 })).toBe(90);
    expect(course_between({ x: 0, y: 1 }, { x: 9, y: 1 })).toBe(180);
    expect(course_between({ x: 9, y: 6 }, { x: 9, y: 1 })).toBe(270);
    // quadrant 7,6 sector 9,1 to quadrant 7,5 sector 9,8: straight left, out of column 0, in at column 9
    const west = crossing_compute({ quadrant: { x: 7, y: 6 }, sector: { x: 9, y: 1 } }, { quadrant: { x: 7, y: 5 }, sector: { x: 9, y: 8 } });
    expect(west.exit.x).toBe(9);
    expect(west.exit.y).toBeCloseTo(-0.5 - 0.7, 5);
    expect(west.entry.x).toBe(9);
    expect(west.entry.y).toBeCloseTo(9.5 + 0.7, 5);
    // straight up out of row 0 into row 9 of the quadrant above
    const north = crossing_compute({ quadrant: { x: 7, y: 6 }, sector: { x: 2, y: 4 } }, { quadrant: { x: 6, y: 6 }, sector: { x: 7, y: 4 } });
    expect(north.exit.x).toBeCloseTo(-1.2, 5);
    expect(north.entry.x).toBeCloseTo(10.2, 5);
    expect(north.entry.y).toBe(4);
  });
});

describe('the bridge plays its lines', () => {
  it('a Klingon flies its `moves to` line keeping its mark, a kill clears it with a burst, a hit takes the absorbed share off the ring', async () => {
    const { bridge, cues } = bridge_make();
    const harness = bridge.harness_get();
    harness.event_take('games.trek.state', shown[0]);
    await bridge.frames_settle();
    expect(sector_kind(bridge, 0, 2)).toBe('tb-sector-klingon');
    const markBefore: string | null = bridge.root.querySelector('.tb-sector[data-x="0"][data-y="2"] use')?.getAttribute('href') ?? null;
    const ringBefore: number = Number((bridge.root.querySelector('.tb-ring') as SVGElement).dataset['percent']);
    harness.text_take('Klingon at 0,2 moves to 6,2\n');
    await bridge.frames_settle();
    expect(sector_kind(bridge, 0, 2)).toBe('tb-sector-empty');
    expect(sector_kind(bridge, 6, 2)).toBe('tb-sector-klingon');
    expect(bridge.root.querySelector('.tb-sector[data-x="6"][data-y="2"] use')?.getAttribute('href')).toBe(markBefore);
    harness.text_take('HIT: 38 units from 6,2, shields absorb 89%, effective hit 4\n');
    await bridge.frames_settle();
    const ringAfter: number = Number((bridge.root.querySelector('.tb-ring') as SVGElement).dataset['percent']);
    // the engine's arithmetic: trunc(38 × 89%) = 33 units come off the shield, and the ring shows the share that leaves
    const ship = bridge.readout_get()?.ship as { shield: number; shieldMax: number };
    expect(ringBefore).toBe(Math.round((100 * ship.shield) / ship.shieldMax));
    expect(ringAfter).toBe(Math.round((100 * (ship.shield - 33)) / ship.shieldMax));
    harness.text_take('   *** Klingon at 6,2 destroyed ***\n');
    await bridge.frames_settle();
    expect(sector_kind(bridge, 6, 2)).toBe('tb-sector-empty');
    expect(bridge.frames_get().played).toMatchObject({ 'klingon-move': 1, 'incoming': 1, 'kill': 1, 'state': 1 });
    expect(cues).toEqual(expect.arrayContaining(['klingon-pass', 'shield', 'hit', 'explosion']));
    // the engine's own readout is untouched by what the picture played
    expect(bridge.readout_get()?.klingons.map((k) => `${k.x},${k.y}`)).toEqual(['0,2']);
    bridge.root.remove();
  });

  it('a torpedo track is played point by point, and the points are frames only while a track prints', async () => {
    const { bridge, cues } = bridge_make();
    const harness = bridge.harness_get();
    harness.event_take('games.trek.state', shown[0]);
    await bridge.frames_settle();
    harness.text_take('Torpedo track:\n   9.5\t 1.5\n   8.5\t 1.8\n   7.5\t 2.0\n');
    harness.text_take('Spock: Star at 0,3 gone nova\n   *** Klingon at 0,2 destroyed ***\n');
    harness.text_take('   1.5\t 2.5\n');
    await bridge.frames_settle();
    const played = bridge.frames_get().played;
    expect(played).toMatchObject({ 'torpedo-head': 1, 'torpedo-point': 3, 'nova': 1, 'kill': 1 });
    expect(played['line']).toBe(1);
    expect(sector_kind(bridge, 0, 3)).toBe('tb-sector-empty');
    expect(sector_kind(bridge, 0, 2)).toBe('tb-sector-empty');
    expect(cues).toEqual(expect.arrayContaining(['torpedo', 'nova', 'explosion']));
    expect(bridge.root.querySelectorAll('.tb-motion')).toHaveLength(0);
    bridge.root.remove();
  });

  it('a press that acts skips the picture to its end: the pending frames land at once and the log is whole', async () => {
    (window as unknown as { matchMedia: (q: string) => { matches: boolean } }).matchMedia = (): { matches: boolean } => ({ matches: false });
    const cues: string[] = [];
    const bridge: TrekBridge = new TrekBridge({ voice: { pill: (): void => undefined, cue: (name: string): void => { cues.push(name); } }, leave: (): void => undefined }, 13);
    document.body.append(bridge.root);
    const harness = bridge.harness_get();
    harness.event_take('games.trek.state', shown[0]);
    await bridge.frames_settle();
    harness.text_take('Klingon at 0,2 moves to 6,2\nKlingon at 6,2 moves to 6,5\n   *** Klingon at 6,5 destroyed ***\n');
    expect(bridge.frames_get().busy).toBe(true);
    bridge.view_set('helm');
    await bridge.frames_settle();
    expect([...bridge.root.querySelectorAll('.tb-log-line')].map((l: Element): string => l.textContent ?? '')).toEqual(['Klingon at 0,2 moves to 6,2', 'Klingon at 6,2 moves to 6,5', '   *** Klingon at 6,5 destroyed ***']);
    expect(sector_kind(bridge, 6, 5)).toBe('tb-sector-empty');
    expect(bridge.root.querySelectorAll('.tb-motion')).toHaveLength(0);
    bridge.root.remove();
  });
});
