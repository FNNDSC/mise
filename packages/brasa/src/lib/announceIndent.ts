/**
 * @file Where a boot step's label starts.
 *
 * A step is announced while it runs and again when it finishes. Both lines
 * describe the same step, so their labels must begin in the same column;
 * otherwise the readout jitters as each step settles.
 *
 * The finished line is rendered by the host as a status tag padded to a
 * fixed width, a space, then the label. The running line has to reproduce
 * that column without knowing the tag. An animated spinner draws a frame
 * and a space of its own and owes only the remainder; a plain log line
 * draws nothing and owes the whole width.
 *
 * Kept free of imports so it can be unit tested: the wider engine graph
 * cannot be loaded under jest.
 *
 * @module
 */

/** Columns an animated spinner draws for itself: one glyph and one space. */
export const SPINNER_GLYPH_WIDTH: number = 2;

/**
 * Spaces a running announcement must emit before its label.
 *
 * @param statusWidth - Width of the host's status-tag column.
 * @param animated - Whether a spinner glyph precedes the text.
 * @returns Leading spaces, never negative.
 */
export function announceIndent_get(statusWidth: number, animated: boolean): number {
  const target: number = statusWidth + 1;
  return Math.max(target - (animated ? SPINNER_GLYPH_WIDTH : 0), 0);
}
