/**
 * @file The lane: which lines may run now, by what session state each one
 * changes.
 *
 * Lines share one session (its directory, its variables, its cohort), so a
 * line that changes a piece of it runs alone with that piece. Each line says
 * what it holds: the pieces it changes, or all of them when it cannot say. A
 * line holding nothing (a read) runs beside anything; lines holding pieces
 * in common take turns, first come first served, and a line never overtakes
 * an earlier one it would conflict with, so a writer is not starved by a
 * stream of reads. A line gives up what it holds while it waits on a person
 * (a question, an editor): waiting is not working, and the session is free
 * until the answer comes, when the asker takes its place in line again
 * (#1273).
 *
 * @module
 */

/** What a line holds: named pieces of session state, or all of them. */
export type LockSet = ReadonlySet<string> | 'all';

/** Every piece of session state: what a line that cannot say holds. */
export const LOCKS_ALL: LockSet = 'all';

/** One line's hold on what it asked for, given back by {@link Lane.release}. */
export interface Hold {
  readonly want: LockSet;
}

/** Whether two lines may not run at the same time. */
function locks_conflict(a: LockSet, b: LockSet): boolean {
  if (a === 'all') return b === 'all' || b.size > 0;
  if (b === 'all') return a.size > 0;
  for (const piece of a) if (b.has(piece)) return true;
  return false;
}

/** Turns over named pieces of session state. */
export class Lane {
  private readonly holds: Set<Hold> = new Set();
  private readonly line: Array<{ hold: Hold; grant: () => void }> = [];

  /**
   * Waits until nothing running, nor anyone earlier in line, holds what the
   * line wants.
   *
   * @param want - What the line holds while it runs.
   * @returns Resolves with the hold, once granted.
   */
  public acquire(want: LockSet = LOCKS_ALL): Promise<Hold> {
    const hold: Hold = { want };
    if (this.grantable(hold, this.line.length)) {
      this.holds.add(hold);
      return Promise.resolve(hold);
    }
    return new Promise<Hold>((resolve: (granted: Hold) => void): void => {
      this.line.push({ hold, grant: (): void => resolve(hold) });
    });
  }

  /**
   * Gives up a hold: whoever in line can now run, runs.
   *
   * @param hold - What {@link acquire} granted.
   */
  public release(hold: Hold): void {
    if (!this.holds.delete(hold)) return;
    for (let at: number = 0; at < this.line.length;) {
      const waiter: { hold: Hold; grant: () => void } = this.line[at];
      if (this.grantable(waiter.hold, at)) {
        this.line.splice(at, 1);
        this.holds.add(waiter.hold);
        waiter.grant();
      } else {
        at += 1;
      }
    }
  }

  /**
   * Runs work holding what it wants, and gives the hold up after, however
   * it ends.
   *
   * @param work - The work.
   * @param want - What it holds.
   * @returns What the work returns.
   */
  public async run<T>(work: () => Promise<T>, want: LockSet = LOCKS_ALL): Promise<T> {
    const hold: Hold = await this.acquire(want);
    try {
      return await work();
    } finally {
      this.release(hold);
    }
  }

  /** How many wait in line. */
  public get waiting(): number {
    return this.line.length;
  }

  /** Whether any line holds anything. */
  public get busy(): boolean {
    return this.holds.size > 0;
  }

  /**
   * Whether a hold may be granted now: nothing held conflicts with it, nor
   * does anyone ahead of it in line.
   *
   * @param hold - The hold asked for.
   * @param ahead - How many of the line stand before it.
   * @returns True when it may run.
   */
  private grantable(hold: Hold, ahead: number): boolean {
    for (const held of this.holds) if (locks_conflict(held.want, hold.want)) return false;
    for (let at: number = 0; at < ahead; at += 1) if (locks_conflict(this.line[at].hold.want, hold.want)) return false;
    return true;
  }
}
