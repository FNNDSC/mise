/**
 * @file What a refused roster says, with the number left to the figure that moves.
 *
 * The daemon refuses `proc feeds` while its index warms with a reason that
 * carries the count as it stood at that instant — `still warming
 * (300/210012, 0%)`. Painted as-is beside the live figure the prompt
 * context keeps moving, it was a number that never moved next to one that
 * did, and read as the truth. One figure, the live one; the reason keeps
 * its words.
 *
 * @module
 */

/**
 * Strips ANSI colour from a refusal and drops the count in its parenthesis.
 *
 * @param raw - The daemon's rendered refusal, ANSI and all.
 * @returns The first line of the reason, without a trailing `(n/total, p%)`.
 */
export function refusalReason_strip(raw: string): string {
  // eslint-disable-next-line no-control-regex
  const plain: string = raw.replace(/\[[0-9;]*m/g, '');
  const first: string = plain.split('\n').find((line: string): boolean => line.trim().length > 0)?.trim() ?? '';
  return first.replace(/\s*\((?:[\d,]+\/[\d,]+(?:,\s*\d+%)?|initializing)\)(?=\.?$)/, '');
}
