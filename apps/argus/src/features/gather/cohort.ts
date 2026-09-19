/**
 * @file The cohort the session is working on: one truth, many reflections.
 *
 * A cohort is the session's, not a pane's. It is read in the header band,
 * and — when it grows past what a band can show — in a pane on the main
 * panel at the same time. Those are two views of ONE set, so the set does
 * not live in either of them: a panel that owned its own members would
 * make the second view a copy, and a copy drifts. The panels render this
 * and mutate this; it tells them when it changed.
 *
 * @module
 */

/** Where a cohort's members have landed, once a feed was rooted on them. */
export interface CohortFeed {
  feedId: number;
  rootInstanceId: number;
  path: string;
}

/** One gathered thing, keyed by the series it names. */
export interface CohortMember {
  seriesUID: string;
}

/**
 * The session's cohort.
 *
 * Membership is a map keyed by the series UID, which is what makes
 * gathering idempotent: taking the same series twice merges what the
 * second sighting knows rather than holding it twice.
 */
export class Cohort<T extends CohortMember> {
  private readonly members: Map<string, T> = new Map();
  private title: string | null = null;
  private landed: CohortFeed | null = null;
  private readonly watchers: Set<() => void> = new Set();

  /**
   * Tells a view to repaint when the cohort changes.
   *
   * @param watch - Called after every change.
   * @returns A function that stops watching.
   */
  public watch(watch: () => void): () => void {
    this.watchers.add(watch);
    return (): void => { this.watchers.delete(watch); };
  }

  /** Says what changed to everyone reading it. */
  private changed(): void {
    for (const watch of [...this.watchers]) watch();
  }

  /** The members, in gather order. */
  public members_get(): ReadonlyArray<T> {
    return [...this.members.values()];
  }

  /** How many the cohort holds. */
  public size(): number {
    return this.members.size;
  }

  /** Whether the cohort holds this one. */
  public has(seriesUID: string): boolean {
    return this.members.has(seriesUID);
  }

  /**
   * Takes one in, merging what a later sighting knows.
   *
   * @param member - The thing gathered.
   */
  public take(member: T): void {
    const held: T | undefined = this.members.get(member.seriesUID);
    this.members.set(member.seriesUID, held === undefined ? member : { ...held, ...member });
    this.changed();
  }

  /**
   * Takes one out.
   *
   * @param seriesUID - Which.
   * @returns Whether it was there.
   */
  public drop(seriesUID: string): boolean {
    const had: boolean = this.members.delete(seriesUID);
    if (had) this.changed();
    return had;
  }

  /** Takes them all out, leaving the cohort standing and empty. */
  public clear(): void {
    if (this.members.size === 0) return;
    this.members.clear();
    this.changed();
  }

  /** The cohort's name, once SAVE asked for one. */
  public name_get(): string | null {
    return this.title;
  }

  /**
   * Names the cohort.
   *
   * @param name - What it is called.
   */
  public name_set(name: string): void {
    this.title = name;
    this.changed();
  }

  /** The feed rooted on the cohort, when one was. */
  public feed_get(): CohortFeed | null {
    return this.landed;
  }

  /**
   * Records the feed the cohort was rooted in.
   *
   * @param feed - The feed.
   */
  public feed_set(feed: CohortFeed): void {
    this.landed = feed;
    this.changed();
  }
}
