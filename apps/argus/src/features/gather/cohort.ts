/**
 * @file The cohort the session is working on: one truth, many reflections.
 *
 * A cohort is the session's, not a pane's — and not the surface's either:
 * the kernel holds it, and every `gather` verb answers with the whole of it
 * (`gather.cohort`). This is the surface's reflection of that answer. It is
 * read in the header band and, when it grows past what a band can show, in
 * a pane on the main panel at the same time; both views read this one
 * reflection, and it changes only when the kernel says the cohort did.
 * A press does not touch it: the press sends a verb, and the verb's answer
 * comes back here.
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
 * Membership is a map keyed by the series UID (a place's path for a
 * member that is not a series), which is how a PACS row asks whether its
 * series is gathered.
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
   * Takes the kernel's cohort as the one to show.
   *
   * Watchers hear only of a real change: the same answer arrives twice
   * (the verb's own result, and the session's broadcast of it), and a view
   * that repainted — or marked itself unsaved — on the echo would be
   * reacting to nothing.
   *
   * @param members - The members, in gather order.
   * @param name - The cohort's name, or null.
   * @param feed - The feed it was rooted in, or null.
   */
  public state_adopt(members: ReadonlyArray<T>, name: string | null, feed: CohortFeed | null): void {
    const next: string = JSON.stringify({ members, name, feed });
    const held: string = JSON.stringify({ members: [...this.members.values()], name: this.title, feed: this.landed });
    if (next === held) return;
    this.members.clear();
    for (const member of members) this.members.set(member.seriesUID, member);
    this.title = name;
    this.landed = feed;
    this.changed();
  }

  /** The cohort's name, once SAVE asked for one. */
  public name_get(): string | null {
    return this.title;
  }

  /** The feed rooted on the cohort, when one was. */
  public feed_get(): CohortFeed | null {
    return this.landed;
  }
}
