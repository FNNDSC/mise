/**
 * @file Test stand-in for `@fnndsc/brasa` inside calypso's jest runs.
 *
 * The real package carries the pre-rendered brain art as one very long
 * encoded line, which jest's CommonJS export scanner cannot digest. Calypso's
 * tests only need the brain's shape — a stable frame of known geometry — so
 * this stub supplies one. The art itself is characterized in brasa's own
 * suite (`tests/brain.test.ts` there).
 */

/** Rows the fake brain occupies; small enough to fit test terminals. */
const FAKE_ROWS: number = 30;
/** Columns the fake brain occupies. */
const FAKE_COLUMNS: number = 60;

/** A deterministic fake frame; the index is embedded so frames differ. */
export function logo_frameRender(frameIndex: number, _isStaticEndState: boolean = false): string[] {
  return Array.from(
    { length: FAKE_ROWS },
    (_unused: unknown, row: number): string => `  BRAIN r${row} f${frameIndex}`,
  );
}

/** The fake frame's plain lines. */
export function logo_linesRender(_colorize: boolean, _reverse: boolean = false): string[] {
  return logo_frameRender(0);
}

/** The fake frame height. */
export function logoRows_count(): number {
  return FAKE_ROWS;
}

/** The fake frame width. */
export function logoColumns_count(): number {
  return FAKE_COLUMNS;
}
