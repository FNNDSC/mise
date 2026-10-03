/**
 * @file A hand pick holds against a follow it superseded.
 *
 * The DAG pane follows the session's cwd into a feed (a "requested" graph)
 * and the operator can pick a feed by hand (a "pinned" one). Both ask the
 * session for a graph, and the answers come back in whatever order the lane
 * finishes them: a follow asked first but answered last landed after the
 * pick and took the pane as if it were the pick — the operator chose 134
 * and was shown 21. The pick remembers the follow it superseded, and that
 * follow's answer, should it arrive while another feed is pinned, is dropped.
 *
 * @module
 */

/** Remembers the one follow a hand pick superseded. */
export class FollowGuard {
  private abandoned: number | null = null;

  /**
   * A hand pick is made while a follow may be on its way.
   *
   * @param requested - The follow still awaited, or null.
   * @param picked - The feed picked by hand.
   */
  public pick(requested: number | null, picked: number): void {
    this.abandoned = requested !== null && requested !== picked ? requested : null;
  }

  /**
   * Whether an arriving answer is the superseded follow's while another feed
   * is pinned; such an answer is dropped, once.
   *
   * @param feedId - The feed the answer is for.
   * @param pinned - The feed pinned by hand, or null.
   * @returns True when the answer should be dropped.
   */
  public drops(feedId: number, pinned: number | null): boolean {
    if (this.abandoned !== feedId || pinned === null || pinned === feedId) return false;
    this.abandoned = null;
    return true;
  }
}
