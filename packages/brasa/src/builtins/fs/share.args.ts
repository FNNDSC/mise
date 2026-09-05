/**
 * @file Shared `share` command-line grammar.
 *
 * Deliberately dependency-free: the engine graph cannot be loaded under
 * jest, so a grammar buried in the builtin is a grammar nothing can test.
 * The same reason `cat.args.ts` stands apart from `cat.ts`.
 *
 * @module
 */

/** What the operator asked `share` to do. */
export interface ShareArgs {
  /** The feed, by id or by any path that names one. */
  target: string | null;
  /** The identity to share with; absent means "say who it is shared with". */
  username: string | null;
}

/** How `share` is spelled, for help and for errors. */
export const SHARE_USAGE: string = 'share: usage: share <feed> [with] <username>';

/**
 * Reads a `share` invocation.
 *
 * @param args - Raw argument tokens.
 * @returns The target and the identity, either of which may be absent.
 */
export function shareArgs_parse(args: string[]): ShareArgs {
  // `share feed_12 someone` and `share feed_12 with someone` say the same
  // thing; `with` reads naturally aloud and carries no meaning.
  const words: string[] = args.filter((word: string): boolean => word !== 'with');
  return {
    target: words[0] ?? null,
    username: words[1] ?? null,
  };
}

/**
 * Resolves a feed id from an id, a `feed_N` name, or a path holding one.
 *
 * The path form matches the `/feeds/feed_<id>/` shape wherever it appears,
 * so a path under `/SHARED` resolves by the same rule as one under a home
 * folder.
 *
 * @param target - What the operator typed.
 * @returns The feed id, or null when nothing in it names a feed.
 */
export function shareTarget_resolve(target: string): number | null {
  const bare: number = Number(target);
  if (Number.isInteger(bare) && bare > 0) return bare;
  const named: RegExpMatchArray | null = target.match(/^feed_(\d+)$/);
  if (named !== null) return Number(named[1]);
  const inPath: RegExpMatchArray | null = target.match(/\/feeds\/feed_(\d+)(?:\/|$)/);
  return inPath !== null ? Number(inPath[1]) : null;
}
