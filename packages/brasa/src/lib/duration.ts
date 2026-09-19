/**
 * @file How the language reads a duration.
 *
 * `expect --within` and `play --pace` are the same notion of time, so they
 * read it with the same function: a second parser beside this one is a
 * second set of durations that mean something slightly else, and a manifest
 * that says `20m` in two places must mean twenty minutes in both.
 *
 * @module
 */

/** How long each unit lasts, in milliseconds. */
const UNIT_MS: Record<string, number> = { ms: 1, s: 1000, m: 60000, h: 3600000 };

/**
 * Reads a duration the way an operator writes one.
 *
 * @param text - A duration such as `30s`, `20m`, `2h`, `250ms`, or bare seconds.
 * @returns Milliseconds, or null when the text is not a duration.
 */
export function duration_parse(text: string): number | null {
  const match: RegExpMatchArray | null = text.trim().match(/^(\d+(?:\.\d+)?)(ms|s|m|h)?$/);
  if (match === null) return null;
  return Number(match[1]) * UNIT_MS[match[2] ?? 's'];
}
