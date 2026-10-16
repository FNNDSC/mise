/**
 * @file The lane: the session runs one command at a time, and the lane is
 * whose turn it is.
 *
 * Commands share one session (its directory, its context, its index), so
 * they take turns, first come first served. A command holds the lane while
 * it works and gives it up while it waits on a person (a question, an
 * editor): waiting is not working, and the session is free for the next
 * command until the answer comes, when the asker takes its place in line
 * again.
 *
 * @module
 */

/** A first-come, first-served turn. */
export class Lane {
  private held: boolean = false;
  private readonly line: Array<() => void> = [];

  /**
   * Waits for the turn.
   *
   * @returns Resolves holding the lane.
   */
  public acquire(): Promise<void> {
    if (!this.held) {
      this.held = true;
      return Promise.resolve();
    }
    return new Promise<void>((resolve: () => void): void => {
      this.line.push(resolve);
    });
  }

  /** Gives up the turn: the next in line takes it, or the lane is free. */
  public release(): void {
    const next: (() => void) | undefined = this.line.shift();
    if (next !== undefined) {
      next();
    } else {
      this.held = false;
    }
  }

  /**
   * Runs work in its turn and gives the turn up after, however it ends.
   *
   * @param work - The work.
   * @returns What the work returns.
   */
  public async run<T>(work: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await work();
    } finally {
      this.release();
    }
  }

  /** How many wait for the turn. */
  public get waiting(): number {
    return this.line.length;
  }

  /** Whether someone has the turn. */
  public get busy(): boolean {
    return this.held;
  }
}
