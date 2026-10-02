/**
 * @file The replay as the scene runs it: a clock over the arrivals, what
 * has arrived shown among the stars, what left hidden, flashes fading.
 *
 * The clock itself is `controls/replay`; this is the scene-side track that
 * applies the clock's frames to the star field and tells the host each
 * moment. Composed by the scene through small ports.
 */
import { ReplayClock, type ReplayFrame } from '../controls/index.js';
import type { StarField } from '../draw/index.js';

/** What the track reads and moves. */
export interface ReplayPorts {
  /** The stars the replay shows and hides. */
  stars: StarField;
  /** Redraws the scene without a settle (the hand-off off under a replay, on after). */
  redraw: () => void;
  /** The replay moved: its moment and whether it still plays. */
  moved?: (at: number, playing: boolean) => void;
  /** The wall clock (a test hands in its own). */
  now?: () => number;
}

/** Where a replay stands. */
export interface ReplayStanding {
  playing: boolean;
  at: number;
  span: [number, number];
}

/** One replay under way: its clock, the arrivals, and what is shown. */
interface Running {
  clock: ReplayClock;
  arrivals: ReadonlyMap<string, number>;
  shown: Set<string>;
}

/** The scene's replay. */
export class ReplayTrack {
  private running: Running | null = null;

  /**
   * @param ports - What the track reads and moves.
   */
  constructor(private readonly ports: ReplayPorts) {}

  /** @returns Whether a replay runs. */
  public active(): boolean {
    return this.running !== null;
  }

  /**
   * Begins a replay over the arrivals: redrawn with the hand-off off (a
   * solid feed would stand before it arrived), every dated node hidden,
   * then the clock plays.
   *
   * @param arrivals - Node id to its moment.
   * @param speed - The clock's speed.
   */
  public begin(arrivals: ReadonlyMap<string, number>, speed: number = 1): void {
    const clock: ReplayClock = new ReplayClock(arrivals, this.ports.now ?? Date.now);
    this.running = { clock, arrivals, shown: new Set() };
    this.ports.redraw();
    this.paintAll();
    clock.play(speed);
  }

  /**
   * Plays on (or again from the start, at the end).
   *
   * @param speed - A new speed, or the one it had.
   */
  public play(speed?: number): void {
    this.running?.clock.play(speed);
  }

  /** Holds the replay where it is. */
  public pause(): void {
    this.running?.clock.pause();
  }

  /**
   * Moves the replay to a moment: what had arrived by then shown, the rest hidden.
   *
   * @param at - The moment, in the arrivals' units.
   */
  public seek(at: number): void {
    if (this.running === null) return;
    this.apply(this.running.clock.seek(at));
  }

  /** Ends the replay: the space redrawn whole, the hand-off back. */
  public stop(): void {
    if (this.running === null) return;
    this.running = null;
    this.ports.redraw();
  }

  /**
   * Where the replay stands, or null when none runs.
   *
   * @returns Whether it plays, its moment, and its span.
   */
  public state(): ReplayStanding | null {
    if (this.running === null) return null;
    return { playing: this.running.clock.playing(), at: this.running.clock.at(), span: this.running.clock.span() };
  }

  /** One frame of the replay: arrivals shown, departures hidden, flashes faded. */
  public step(): void {
    const running: Running | null = this.running;
    if (running === null) return;
    const wasPlaying: boolean = running.clock.playing();
    const frame: ReplayFrame = running.clock.step();
    this.apply(frame);
    for (const [id, strength] of running.clock.flashing()) this.ports.stars.flash_set(id, strength);
    this.ports.stars.flush();
    if (wasPlaying || frame.arrived.length > 0) this.ports.moved?.(frame.at, running.clock.playing());
  }

  /** Paints every dated node as the replay has it: shown if arrived, else hidden. */
  public paintAll(): void {
    const running: Running | null = this.running;
    if (running === null) return;
    const hidden: string[] = [...running.arrivals.keys()].filter((id: string): boolean => !running.shown.has(id));
    this.ports.stars.presence_set(hidden, 0);
    this.ports.stars.presence_set(running.shown, 1);
    this.ports.stars.threads_present((id: string): boolean => running.shown.has(id) || !running.arrivals.has(id));
    this.ports.stars.flush();
  }

  /** Shows what arrived and hides what left, threads following. */
  private apply(frame: ReplayFrame): void {
    const running: Running | null = this.running;
    if (running === null || (frame.arrived.length === 0 && frame.departed.length === 0)) return;
    for (const id of frame.arrived) running.shown.add(id);
    for (const id of frame.departed) {
      running.shown.delete(id);
      this.ports.stars.flash_set(id, 0);
    }
    this.ports.stars.presence_set(frame.arrived, 1);
    this.ports.stars.presence_set(frame.departed, 0);
    this.ports.stars.threads_present((id: string): boolean => running.shown.has(id) || !running.arrivals.has(id));
    this.ports.stars.flush();
  }
}
