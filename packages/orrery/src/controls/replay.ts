/**
 * @file The replay: a space's history played back in the order it arrived.
 *
 * Every node the surface can date has an arrival time. A replay runs from
 * the first arrival to the last in a fixed stretch of wall time (scaled by
 * a speed), and says, frame by frame, which nodes have arrived since the
 * last frame and which have left (a seek backwards). A node that arrives
 * flashes, and the flash fades; the camera is untouched, the positions are
 * the final ones, and a node with no arrival time stands throughout.
 *
 * Pure: a clock the caller can drive, no renderer.
 *
 * @module
 */

/** How long, in wall time, a replay at speed 1 takes from first arrival to last. */
export const REPLAY_WALL_MS: number = 30_000;
/** How long an arrival's flash lasts, in wall time. */
export const REPLAY_FLASH_MS: number = 900;

/**
 * One frame's news.
 *
 * @property at - The replay's moment, in the arrivals' own units (epoch ms).
 * @property arrived - Nodes that arrived since the last frame.
 * @property departed - Nodes that are no longer there (a seek backwards).
 * @property done - The replay has reached the last arrival.
 */
export interface ReplayFrame {
  at: number;
  arrived: string[];
  departed: string[];
  done: boolean;
}

/**
 * A replay's clock.
 */
export class ReplayClock {
  private readonly order: Array<{ id: string; at: number }>;
  private readonly first: number;
  private readonly last: number;
  /** How many of `order` are shown. */
  private shown: number = 0;
  /** The replay's moment. */
  private moment: number;
  private speed: number = 1;
  private running: boolean = false;
  private lastWall: number;
  private readonly flashes: Map<string, number> = new Map();

  /**
   * @param arrivals - When each node arrived (any monotonic unit; epoch ms
   *   for dates). Nodes absent from it stand throughout.
   * @param clock - Wall-clock milliseconds; `Date.now` unless a test drives time.
   */
  constructor(arrivals: ReadonlyMap<string, number>, private readonly clock: () => number = Date.now) {
    this.order = [...arrivals].map(([id, at]: [string, number]) => ({ id, at })).sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : 1));
    this.first = this.order[0]?.at ?? 0;
    this.last = this.order[this.order.length - 1]?.at ?? 0;
    this.moment = this.first;
    this.lastWall = clock();
  }

  /** @returns The first and last arrivals. */
  public span(): [number, number] {
    return [this.first, this.last];
  }

  /** @returns Every node with an arrival, in arrival order. */
  public ids(): string[] {
    return this.order.map((entry) => entry.id);
  }

  /** @returns Whether the replay is advancing. */
  public playing(): boolean {
    return this.running;
  }

  /** @returns The replay's moment. */
  public at(): number {
    return this.moment;
  }

  /**
   * Plays on, at a speed: 1 crosses the whole history in {@link REPLAY_WALL_MS}.
   *
   * @param speed - How much faster than 1; a replay at its end starts over.
   */
  public play(speed: number = this.speed): void {
    this.speed = Math.max(0.05, speed);
    if (this.moment >= this.last && this.shown >= this.order.length) this.seek(this.first);
    this.running = true;
    this.lastWall = this.clock();
  }

  /** Holds the replay where it is. */
  public pause(): void {
    this.running = false;
  }

  /**
   * Moves the replay to a moment. Nodes arrived by then are shown at once,
   * without a flash; nodes that arrive after it are hidden again.
   *
   * @param at - The moment, clamped to the span.
   * @returns What changed.
   */
  public seek(at: number): ReplayFrame {
    this.moment = Math.max(this.first, Math.min(this.last, at));
    const arrived: string[] = [];
    const departed: string[] = [];
    while (this.shown < this.order.length && (this.order[this.shown] as { at: number }).at <= this.moment) {
      arrived.push((this.order[this.shown] as { id: string }).id);
      this.shown += 1;
    }
    while (this.shown > 0 && (this.order[this.shown - 1] as { at: number }).at > this.moment) {
      this.shown -= 1;
      const id: string = (this.order[this.shown] as { id: string }).id;
      departed.push(id);
      this.flashes.delete(id);
    }
    return { at: this.moment, arrived, departed, done: this.moment >= this.last };
  }

  /**
   * Advances by the wall time since the last frame, if playing. What arrives
   * begins to flash; a replay that reaches the last arrival pauses there.
   *
   * @returns This frame's news.
   */
  public step(): ReplayFrame {
    const wall: number = this.clock();
    const elapsed: number = wall - this.lastWall;
    this.lastWall = wall;
    if (!this.running) return { at: this.moment, arrived: [], departed: [], done: this.moment >= this.last };
    const perWall: number = (this.last - this.first) / REPLAY_WALL_MS * this.speed;
    // A history of one moment is crossed at once.
    const frame: ReplayFrame = this.seek(perWall > 0 ? this.moment + elapsed * perWall : this.last);
    for (const id of frame.arrived) this.flashes.set(id, wall);
    if (frame.done) this.running = false;
    return frame;
  }

  /**
   * The nodes still flashing, and how bright: 1 as they arrive, fading to 0
   * over {@link REPLAY_FLASH_MS}. A flash that has faded is forgotten, and
   * reported once at 0 so its light can be put back.
   *
   * @returns Each flashing node's brightness.
   */
  public flashing(): Map<string, number> {
    const wall: number = this.clock();
    const out: Map<string, number> = new Map();
    for (const [id, began] of this.flashes) {
      const t: number = (wall - began) / REPLAY_FLASH_MS;
      if (t >= 1) {
        this.flashes.delete(id);
        out.set(id, 0);
      } else {
        out.set(id, 1 - t);
      }
    }
    return out;
  }
}
