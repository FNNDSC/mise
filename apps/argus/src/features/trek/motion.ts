/**
 * @file Motion on the bridge: the frames the picture plays and the queue
 * that is their clock.
 *
 * Nothing on the screen moves without an engine line or a state change
 * behind it. A torpedo follows the track the engine printed, point by
 * point; a Klingon flies the sectors its `moves to` line names; a beam
 * joins the two sectors a hit line names; a kill bursts when its line
 * arrives; a move joins the readout before to the readout after along the
 * course that was committed. The engine's lines are replayed in order, each
 * frame starting with its cue, and the ship's log scrolls at the pace of the
 * picture. A press that acts (a command pill, a view, Esc) jumps to the
 * final state, and reduced motion always does.
 *
 * This module holds the pure parts (the line parser, the queue, the
 * geometry) and the drawing primitives on the scan's SVG. The bridge
 * decides what each line means for its picture.
 *
 * @module
 */
import type { XY } from 'bsd-trek/host';
import { mark_place, mark_use, svg, type MarkKind } from './marks.js';

/** How long each frame takes, in milliseconds. */
export const PACE = {
  /** A torpedo from one printed point to the next. */
  torpedoPoint: 140,
  /** The ship or a Klingon across one sector. */
  sector: 170,
  /** A burst, from its flash to nothing. */
  burst: 800,
  /** A beam, lit and gone. */
  beam: 900,
  /** A long-range cell blooming. */
  bloom: 1000,
  /** The scan dimmed and redrawn on a quadrant crossing. */
  rescan: 350,
  /** A ring's flare. */
  flare: 900,
  /** A comet tail's fade after the last point. */
  tail: 300,
} as const;

/** What a line of the engine's means for the picture. */
export type LineEvent =
  | { kind: 'torpedo-head' }
  | { kind: 'torpedo-point'; at: { x: number; y: number } }
  | { kind: 'torpedo-end' }
  | { kind: 'kill'; at: XY }
  | { kind: 'nova'; at: XY }
  | { kind: 'misfire' }
  | { kind: 'phaser'; at: XY }
  | { kind: 'incoming'; hit: number; from: XY | null; absorb: number }
  | { kind: 'klingon-move'; from: XY; to: XY }
  | { kind: 'klingon-escape'; from: XY; quadrant: XY }
  | { kind: 'supernova'; at: XY }
  | { kind: 'supernova-report'; quadrant: XY };

/** The engine's lines the picture replays, most specific first. */
const LINE_EVENTS: ReadonlyArray<[RegExp, (m: RegExpExecArray) => LineEvent]> = [
  [/^Torpedo track(?:, torpedo number \d+)?:/, (): LineEvent => ({ kind: 'torpedo-head' })],
  [/^\s*(\d+\.\d)\s+(\d+\.\d)\s*$/, (m): LineEvent => ({ kind: 'torpedo-point', at: { x: Number(m[1]), y: Number(m[2]) } })],
  [/^Torpedo missed|^Torpedo disappears into a black hole/, (): LineEvent => ({ kind: 'torpedo-end' })],
  [/\*\*\* Klingon at (\d+),(\d+) destroyed \*\*\*/, (m): LineEvent => ({ kind: 'kill', at: xy_extract(m, 1) })],
  [/^Starbase at (\d+),(\d+) destroyed/, (m): LineEvent => ({ kind: 'kill', at: xy_extract(m, 1) })],
  [/^Inhabited starsystem .* at (\d+),(\d+) destroyed/, (m): LineEvent => ({ kind: 'kill', at: xy_extract(m, 1) })],
  [/^Unknown object . at (\d+),(\d+) destroyed/, (m): LineEvent => ({ kind: 'kill', at: xy_extract(m, 1) })],
  [/Star at (\d+),(\d+) gone nova/, (m): LineEvent => ({ kind: 'nova', at: xy_extract(m, 1) })],
  [/^Photon tubes misfire/, (): LineEvent => ({ kind: 'misfire' })],
  [/^(\d+) unit hit on Klingon at (\d+),(\d+)/, (m): LineEvent => ({ kind: 'phaser', at: xy_extract(m, 2) })],
  [/^HIT: (\d+) units(?: from (\d+),(\d+))?(?:, shields absorb (\d+)%)?/, (m): LineEvent => ({ kind: 'incoming', hit: Number(m[1]), from: m[2] === undefined ? null : xy_extract(m, 2), absorb: m[4] === undefined ? 0 : Number(m[4]) })],
  [/^Klingon at (\d+),(\d+) moves to (\d+),(\d+)/, (m): LineEvent => ({ kind: 'klingon-move', from: xy_extract(m, 1), to: xy_extract(m, 3) })],
  [/^Klingon at (\d+),(\d+) escapes to quadrant (\d+),(\d+)/, (m): LineEvent => ({ kind: 'klingon-escape', from: xy_extract(m, 1), quadrant: xy_extract(m, 3) })],
  [/RED ALERT: supernova occurring at (\d+),(\d+)/, (m): LineEvent => ({ kind: 'supernova', at: xy_extract(m, 1) })],
  [/^\s*in quadrant (\d+),(\d+)\.\s+Caution is advised/, (m): LineEvent => ({ kind: 'supernova-report', quadrant: xy_extract(m, 1) })],
];

/**
 * Two captured numbers as a point.
 *
 * @param m - The match.
 * @param index - The first capture.
 * @returns The point.
 */
function xy_extract(m: RegExpExecArray, index: number): XY {
  return { x: Number(m[index]), y: Number(m[index + 1]) };
}

/**
 * What a line of the engine's means for the picture, if anything.
 *
 * A bare pair of decimals is a torpedo's point only while a track is printing; the caller knows that.
 *
 * @param line - One line of the ship's log.
 * @returns The event, or null for a line the picture does not play.
 */
export function lineEvent_parse(line: string): LineEvent | null {
  for (const [pattern, make] of LINE_EVENTS) {
    const m: RegExpExecArray | null = pattern.exec(line);
    if (m !== null) return make(m);
  }
  return null;
}

/** One frame: what it is, and how it runs, at pace or at once. */
export interface Frame {
  /** What the frame plays, for the tally. */
  kind: string;
  /** Plays it; `instant` means jump to the end state with no waiting. */
  run: (instant: boolean) => Promise<void> | void;
}

/**
 * The frames' clock: plays them in order, one at a time; a skip finishes every pending frame at once.
 */
export class FrameQueue {
  private readonly frames: Frame[] = [];
  private running: boolean = false;
  private skipping: boolean = false;
  private readonly waiting: Set<() => void> = new Set<() => void>();
  /** How many frames of each kind have played, for a smoke scenario or a test. */
  public readonly played: Record<string, number> = {};

  /**
   * @param reduced - Whether the viewer asked for reduced motion; read at each frame.
   */
  constructor(private readonly reduced: () => boolean = motionReduced_is) {}

  /**
   * Queues a frame; it plays after the ones before it.
   *
   * @param frame - The frame.
   */
  public push(frame: Frame): void {
    this.frames.push(frame);
    void this.pump();
  }

  /**
   * Finishes every pending frame at once: the one playing ends its waits, the rest run instant.
   */
  public skip(): void {
    if (this.frames.length === 0 && !this.running) return;
    this.skipping = true;
    for (const wake of this.waiting) wake();
    this.waiting.clear();
  }

  /**
   * Whether anything is pending or playing.
   *
   * @returns True while frames remain.
   */
  public busy_is(): boolean {
    return this.running || this.frames.length > 0;
  }

  /**
   * How many frames wait behind the one playing.
   *
   * @returns The count.
   */
  public pending_count(): number {
    return this.frames.length;
  }

  /**
   * Whether a skip is in force: a frame mid-way jumps to its end.
   *
   * @returns True while skipping.
   */
  public skipping_is(): boolean {
    return this.skipping;
  }

  /**
   * Resolves once every frame has played, for a test or a scenario that reads the picture.
   *
   * @returns When the queue is idle.
   */
  public async settle(): Promise<void> {
    while (this.busy_is()) await new Promise<void>((resolve: () => void): void => { setTimeout(resolve, 1); });
  }

  /**
   * Waits, unless skipping; a skip wakes every waiter at once.
   *
   * @param ms - How long.
   * @returns After the wait.
   */
  public wait(ms: number): Promise<void> {
    if (this.skipping || ms <= 0) return Promise.resolve();
    return new Promise((resolve: () => void): void => {
      const timer = setTimeout((): void => { this.waiting.delete(wake); resolve(); }, ms);
      const wake = (): void => { clearTimeout(timer); resolve(); };
      this.waiting.add(wake);
    });
  }

  /**
   * Steps a value from 0 to 1 over a span, a frame at a time, until done or skipped.
   *
   * @param ms - The span.
   * @param step - Called with the share done, 0 to 1; called with 1 last.
   * @returns After the last step.
   */
  public async tween(ms: number, step: (share: number) => void): Promise<void> {
    const started: number = now_ms();
    while (!this.skipping) {
      const share: number = Math.min(1, (now_ms() - started) / Math.max(1, ms));
      step(share);
      if (share >= 1) return;
      await frame_next(this);
    }
    step(1);
  }

  private async pump(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      while (this.frames.length > 0) {
        const frame: Frame = this.frames.shift() as Frame;
        this.played[frame.kind] = (this.played[frame.kind] ?? 0) + 1;
        const instant: boolean = this.skipping || this.reduced();
        try { await frame.run(instant); } catch { /* a frame that fails to draw stops nothing after it */ }
      }
    } finally {
      this.running = false;
      this.skipping = false;
    }
  }
}

/**
 * Whether the viewer asked for reduced motion.
 *
 * @returns True when the media query matches; false where there is no such query.
 */
export function motionReduced_is(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * The time now, for a tween.
 *
 * @returns Milliseconds.
 */
function now_ms(): number {
  return typeof performance === 'object' ? performance.now() : Date.now();
}

/**
 * The next animation frame, or a short wait where there are none; a skip cuts it.
 *
 * @param queue - The queue, for its skip.
 * @returns After the frame.
 */
function frame_next(queue: FrameQueue): Promise<void> {
  if (typeof requestAnimationFrame === 'function') {
    return new Promise((resolve: () => void): void => { requestAnimationFrame((): void => resolve()); });
  }
  return queue.wait(16);
}

/** The scan's point for a sector: the C's x runs down, y across. */
export function scanPoint_convert(at: { x: number; y: number }): [number, number] {
  return [at.y + 0.5, at.x + 0.5];
}

/**
 * The C's course from one point to another, in degrees: 0 up the scan (x decreasing), 90 to the right, clockwise.
 *
 * @param from - Where from.
 * @param to - Where to.
 * @returns Degrees, 0 up to 360.
 */
export function course_between(from: { x: number; y: number }, to: { x: number; y: number }): number {
  return ((Math.atan2(to.y - from.y, -(to.x - from.x)) * 180) / Math.PI + 360) % 360;
}

/**
 * Where a straight move leaves one quadrant and enters another, in each quadrant's own sector coordinates.
 *
 * The C walks the line between the two positions, so the exit is where that line crosses the first quadrant's edge and the entry where it crosses the last one's; quadrants between are flown over.
 *
 * @param from - The quadrant and sector before.
 * @param to - The quadrant and sector after.
 * @param sectors - Sectors per quadrant side.
 * @returns The exit point in the first quadrant and the entry point in the last, both possibly fractional and just past the edge.
 */
export function crossing_compute(from: { quadrant: XY; sector: XY }, to: { quadrant: XY; sector: XY }, sectors: number = 10): { exit: { x: number; y: number }; entry: { x: number; y: number } } {
  const a = { x: from.quadrant.x * sectors + from.sector.x, y: from.quadrant.y * sectors + from.sector.y };
  const b = { x: to.quadrant.x * sectors + to.sector.x, y: to.quadrant.y * sectors + to.sector.y };
  const d = { x: b.x - a.x, y: b.y - a.y };
  // the share of the way at which the line meets each quadrant's edge (the edge is half a sector beyond the last sector's centre)
  const box_t = (quadrant: XY, origin: { x: number; y: number }, leaving: boolean): number => {
    let t: number = leaving ? Infinity : -Infinity;
    for (const axis of ['x', 'y'] as const) {
      if (d[axis] === 0) continue;
      const low: number = quadrant[axis] * sectors - 0.5;
      const high: number = quadrant[axis] * sectors + sectors - 0.5;
      const tLow: number = (low - origin[axis]) / d[axis];
      const tHigh: number = (high - origin[axis]) / d[axis];
      if (leaving) t = Math.min(t, Math.max(tLow, tHigh));
      else t = Math.max(t, Math.min(tLow, tHigh));
    }
    return Number.isFinite(t) ? Math.max(0, Math.min(1, t)) : (leaving ? 1 : 0);
  };
  const tExit: number = box_t(from.quadrant, a, true);
  const tEntry: number = box_t(to.quadrant, a, false);
  const nudge: number = 0.7;
  const exit = { x: a.x + d.x * tExit - from.quadrant.x * sectors, y: a.y + d.y * tExit - from.quadrant.y * sectors };
  const entry = { x: a.x + d.x * tEntry - to.quadrant.x * sectors, y: a.y + d.y * tEntry - to.quadrant.y * sectors };
  const length: number = Math.hypot(d.x, d.y) || 1;
  // a little past each edge, so the mark leaves the picture and comes back into it
  return {
    exit: { x: exit.x + (d.x / length) * nudge, y: exit.y + (d.y / length) * nudge },
    entry: { x: entry.x - (d.x / length) * nudge, y: entry.y - (d.y / length) * nudge },
  };
}

/** A layer of motion over the scan, cleared when its frame ends. */
export function layer_make(scan: SVGElement, className: string = ''): SVGElement {
  const layer: SVGElement = svg('g', { class: `tb-motion ${className}`.trim() });
  scan.append(layer);
  return layer;
}

/** The side of a mark on the scan, in sectors, and where it starts in its cell. */
const MARK_SIZE: number = 0.7;

/**
 * Slides a mark along a straight track: a dashed track laid for the whole way, a pulse running it, the mark moving with the pulse and pointing along it.
 *
 * @param scan - The scan.
 * @param queue - The clock.
 * @param mark - What slides: its kind and a Klingon's mark.
 * @param from - The sector it leaves, possibly fractional.
 * @param to - The sector it reaches, possibly fractional or past the edge.
 * @param options - `hostile` draws the track in the Klingons' colour; `heading` fixes the mark's rotation instead of the track's own course.
 * @param instant - Jump to the end at once.
 * @returns After the mark arrives; the layer is removed.
 */
export async function slide_play(scan: SVGElement, queue: FrameQueue, mark: { kind: MarkKind; variant: string | null }, from: { x: number; y: number }, to: { x: number; y: number }, options: { hostile?: boolean; heading?: number } = {}, instant: boolean = false): Promise<void> {
  if (instant) return;
  const layer: SVGElement = layer_make(scan, 'tb-motion-slide');
  const [x1, y1] = scanPoint_convert(from);
  const [x2, y2] = scanPoint_convert(to);
  const hostile: string = options.hostile === true ? ' tb-hostile' : '';
  layer.append(svg('line', { class: `tb-track${hostile}`, x1, y1, x2, y2 }));
  const pulseWide: SVGElement = svg('line', { class: `tb-pulse tb-pulse-wide${hostile}`, x1, y1, x2: x1, y2: y1 });
  const pulseCore: SVGElement = svg('line', { class: `tb-pulse tb-pulse-core${hostile}`, x1, y1, x2: x1, y2: y1 });
  const course: number = options.heading ?? course_between(from, to);
  const sprite: SVGElement = mark_use(mark.kind, { cx: x1, cy: y1, size: MARK_SIZE }, mark.variant, course);
  sprite.classList.add(`tb-sector-${mark.kind}`);
  layer.append(pulseWide, pulseCore, sprite);
  const sectors: number = Math.max(1, Math.hypot(to.x - from.x, to.y - from.y));
  await queue.tween(sectors * PACE.sector, (share: number): void => {
    const cx: number = x1 + (x2 - x1) * share;
    const cy: number = y1 + (y2 - y1) * share;
    const back: number = Math.max(0, share - 0.12);
    const bx: number = x1 + (x2 - x1) * back;
    const by: number = y1 + (y2 - y1) * back;
    for (const pulse of [pulseWide, pulseCore]) { pulse.setAttribute('x1', String(bx)); pulse.setAttribute('y1', String(by)); pulse.setAttribute('x2', String(cx)); pulse.setAttribute('y2', String(cy)); }
    mark_place(sprite, cx, cy, course);
  });
  layer.remove();
}

/**
 * Lights a beam between two sectors: a phaser from the ship, or a Klingon's shot at it.
 *
 * @param scan - The scan.
 * @param queue - The clock.
 * @param from - Where it starts.
 * @param to - Where it lands.
 * @param hostile - A Klingon's beam.
 * @param instant - Jump to the end at once.
 * @returns After the beam is gone.
 */
export async function beam_play(scan: SVGElement, queue: FrameQueue, from: XY, to: XY, hostile: boolean, instant: boolean = false): Promise<void> {
  if (instant) return;
  const layer: SVGElement = layer_make(scan, 'tb-motion-beam');
  const [x1, y1] = scanPoint_convert(from);
  const [x2, y2] = scanPoint_convert(to);
  const cls: string = hostile ? ' tb-hostile' : '';
  layer.append(svg('line', { class: `tb-beam${cls}`, x1, y1, x2, y2 }), svg('line', { class: `tb-beam tb-beam-core${cls}`, x1, y1, x2, y2 }));
  await queue.wait(PACE.beam);
  layer.remove();
}

/** The bursts, by what burst. */
export type BurstKind = 'kill' | 'nova' | 'misfire' | 'supernova';

/**
 * Bursts at a sector, after the ARGUS node flare: a core that blooms, a halo that reaches out and settles, spikes that fly.
 *
 * @param scan - The scan.
 * @param queue - The clock.
 * @param at - The sector.
 * @param kind - What burst: a kill is white, a nova the star's colour with more spikes, a misfire red and short, a supernova wide.
 * @param instant - Jump to the end at once.
 * @returns After the burst is gone.
 */
export async function burst_play(scan: SVGElement, queue: FrameQueue, at: XY, kind: BurstKind, instant: boolean = false): Promise<void> {
  if (instant) return;
  const layer: SVGElement = layer_make(scan, `tb-motion-burst tb-burst tb-burst-${kind}`);
  const [cx, cy] = scanPoint_convert(at);
  const ms: number = kind === 'misfire' ? PACE.burst * 0.6 : kind === 'supernova' ? PACE.burst * 1.6 : PACE.burst;
  (layer as SVGElement & { style: CSSStyleDeclaration }).style.setProperty('--tb-ms', `${ms}ms`);
  layer.append(svg('circle', { class: 'tb-burst-halo', cx, cy, r: 0.1 }));
  const spikes: SVGElement = svg('g', { class: 'tb-burst-spikes' });
  const count: number = kind === 'nova' || kind === 'supernova' ? 12 : 8;
  const reach: number = kind === 'misfire' ? 0.6 : kind === 'supernova' ? 1.8 : kind === 'nova' ? 1.1 : 0.95;
  for (let i: number = 0; i < count; i++) {
    const a: number = (i / count) * Math.PI * 2 + (count === 8 ? Math.PI / 8 : 0);
    spikes.append(svg('line', { class: 'tb-burst-spike', x1: cx + Math.cos(a) * 0.12, y1: cy + Math.sin(a) * 0.12, x2: cx + Math.cos(a) * reach, y2: cy + Math.sin(a) * reach }));
  }
  layer.append(spikes, svg('circle', { class: 'tb-burst-core', cx, cy, r: 0.04 }));
  await queue.wait(ms);
  layer.remove();
}

/**
 * Flares the ship's shield ring outward, as a hit lands on it.
 *
 * @param scan - The scan.
 * @param queue - The clock.
 * @param instant - Jump to the end at once.
 * @returns After the flare is gone.
 */
export async function ringFlare_play(scan: SVGElement, queue: FrameQueue, instant: boolean = false): Promise<void> {
  if (instant) return;
  const ring: SVGElement | null = scan.querySelector<SVGElement>('.tb-ring');
  if (ring === null) return;
  const flare: SVGElement = svg('circle', { class: 'tb-motion tb-ring-flare', cx: ring.getAttribute('cx') ?? 0, cy: ring.getAttribute('cy') ?? 0, r: 0.46 });
  scan.append(flare);
  await queue.wait(PACE.flare);
  flare.remove();
}

/** A photon torpedo in flight: an orange-red sphere with a white heart and flat pulses, trailing a comet tail over the last printed points. */
export class Torpedo {
  private readonly layer: SVGElement;
  private readonly tail: SVGElement;
  private readonly photon: SVGElement;
  private readonly points: Array<[number, number]> = [];

  /**
   * Fires one from a sector.
   *
   * @param scan - The scan.
   * @param from - The sector it leaves.
   */
  constructor(scan: SVGElement, from: XY) {
    this.layer = layer_make(scan, 'tb-motion-torpedo');
    this.tail = svg('g', { class: 'tb-tail' });
    this.photon = svg('g', { class: 'tb-photon' });
    this.photon.append(svg('circle', { class: 'tb-photon-halo', cx: 0, cy: 0, r: 0.34 }));
    const pulses: SVGElement = svg('g', { class: 'tb-photon-pulses' });
    for (let i: number = 0; i < 10; i++) {
      const arm: SVGElement = svg('g', { transform: `rotate(${i * 36})` });
      arm.append(svg('rect', { x: 0.08, y: -0.016, width: 0.2 + (i % 3) * 0.05, height: 0.032, rx: 0.006 }));
      pulses.append(arm);
    }
    this.photon.append(pulses, svg('circle', { class: 'tb-photon-core', cx: 0, cy: 0, r: 0.12 }));
    this.layer.append(this.tail, this.photon);
    const [cx, cy] = scanPoint_convert(from);
    this.points.push([cx, cy]);
    this.photon.setAttribute('transform', `translate(${cx} ${cy})`);
  }

  /**
   * Flies to the next printed point, the tail following.
   *
   * @param queue - The clock.
   * @param at - The point, in the C's fractional sector coordinates.
   * @param instant - Jump there at once.
   * @returns After it arrives.
   */
  public async point_reach(queue: FrameQueue, at: { x: number; y: number }, instant: boolean = false): Promise<void> {
    // the C prints the centre of a sector as n.5; the scan's unit square has its centre there too
    const [cx, cy] = [at.y, at.x];
    this.points.push([cx, cy]);
    this.photon.setAttribute('transform', `translate(${cx} ${cy})`);
    this.tail.replaceChildren();
    const recent: Array<[number, number]> = this.points.slice(-4);
    for (let i: number = 1; i < recent.length; i++) {
      const [ax, ay] = recent[i - 1] as [number, number];
      const [bx, by] = recent[i] as [number, number];
      this.tail.append(svg('line', { class: 'tb-tail-segment', x1: ax, y1: ay, x2: bx, y2: by, 'stroke-width': 0.03 + 0.03 * i, opacity: 0.25 + 0.25 * i }));
    }
    if (!instant) await queue.wait(PACE.torpedoPoint);
  }

  /**
   * The torpedo is spent: the tail fades and the layer goes.
   *
   * @param queue - The clock.
   * @param instant - Go at once.
   * @returns After the layer is removed.
   */
  public async end(queue: FrameQueue, instant: boolean = false): Promise<void> {
    this.photon.remove();
    if (!instant) await queue.wait(PACE.tail);
    this.layer.remove();
  }
}

/**
 * Dims the scan for a rescan, or lifts the dimming.
 *
 * @param scan - The scan.
 * @param dim - Whether to dim.
 */
export function rescan_set(scan: SVGElement, dim: boolean): void {
  scan.classList.toggle('tb-rescan', dim);
}

/**
 * Blooms a long-range cell, as a node flares: the quadrant the ship has entered, or one a Klingon fled to.
 *
 * @param cell - The cell.
 * @param hostile - A Klingon's arrival, in their colour.
 */
export function lrsBloom_play(cell: HTMLElement, hostile: boolean): void {
  cell.classList.remove('tb-bloom', 'tb-bloom-hostile');
  // restart the animation when the same cell blooms again
  void cell.offsetWidth;
  cell.classList.add('tb-bloom');
  if (hostile) cell.classList.add('tb-bloom-hostile');
  cell.addEventListener('animationend', (): void => cell.classList.remove('tb-bloom', 'tb-bloom-hostile'), { once: true });
}
