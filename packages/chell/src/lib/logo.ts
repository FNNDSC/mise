/**
 * @file Boot-screen animation host for the mise brain.
 *
 * The art and its frame renderer live in brasa (`logo/brain`) so any surface
 * can draw them; this module owns the chell boot terminal's way of doing it:
 * printing the logo into the scrollback and pulsing it in place by counting
 * the rows printed beneath it (a stdout hook) and repainting cursor-relative.
 * The pulse stops itself the moment the logo scrolls off screen, where the
 * arithmetic would start painting over live output.
 *
 * @module
 */
import { logo_frameRender, logo_linesRender, logoRows_count } from '@fnndsc/brasa';

export { logo_frameRender, logo_linesRender };

let logoInterval: NodeJS.Timeout | null = null;
let logoFrameIndex: number = 0;

let originalWrite: typeof process.stdout.write | null = null;
let linesPrinted: number = 0;
/** Columns occupied by output not yet terminated by a newline. */
let pendingColumns: number = 0;

/**
 * Matches every ANSI escape, not only the colour codes {@link ANSI_PATTERN}
 * strips: anything that moves a cursor or sets a mode occupies no columns
 * either, and a width count that ignores it over-shoots.
 */
const ESCAPE_PATTERN: RegExp = /\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\)|[@-Z\\-_])/g;

/**
 * Counts the screen rows a run of printed text occupies.
 *
 * The animation repaints by moving the cursor up a fixed number of rows, so it
 * must know rows and not newlines. A line longer than the terminal is wrapped
 * by the terminal into several rows while contributing one newline; counting
 * newlines therefore under-shoots, and the animation paints over whatever was
 * printed. Long lines — a URL carrying a token, say — make that immediate.
 *
 * @param text - The text written to stdout, escapes included.
 * @returns The rows it occupied, advancing the pending-column position.
 */
export function rows_count(text: string): number {
  const columns: number = process.stdout.columns || 80;
  const segments: string[] = text.replace(ESCAPE_PATTERN, '').split('\n');
  let rows: number = 0;
  segments.forEach((segment: string, index: number): void => {
    const width: number = pendingColumns + segment.length;
    if (index < segments.length - 1) {
      // A completed line occupies at least one row, and one more for each
      // full width it wrapped past.
      rows += Math.max(1, Math.ceil(width / columns) || 1);
      pendingColumns = 0;
    } else {
      pendingColumns = width % columns;
      // Text that wrapped but has not yet ended still consumed rows.
      rows += Math.floor(width / columns);
    }
  });
  return rows;
}

/**
 * Starts hijacking process.stdout.write to count the screen rows printed
 * since the logo animation was launched.
 */
/** Whether the pulse is currently running. */
export function logo_isAnimating(): boolean {
  return logoInterval !== null;
}

/** Test seam: the rows counted since tracking began. */
export function rowsPrinted_peek(): number {
  return linesPrinted;
}

/** Test seam: starts row tracking without printing a logo first. */
export function rowsPrinted_track(): void {
  stdoutTrack_start();
}

/** Test seam: stops row tracking. */
export function rowsPrinted_untrack(): void {
  stdoutTrack_stop();
}

function stdoutTrack_start(): void {
  if (originalWrite) return;
  originalWrite = process.stdout.write.bind(process.stdout);
  linesPrinted = 0;
  pendingColumns = 0;
  process.stdout.write = ((chunk: string | Uint8Array, ...args: unknown[]): boolean => {
    const str: string = typeof chunk === 'string'
      ? chunk
      : (chunk && chunk.toString ? chunk.toString() : '');
    linesPrinted += rows_count(str);
    return (originalWrite as (...a: unknown[]) => boolean)(chunk, ...args);
  }) as typeof process.stdout.write;
}

/**
 * Writes without being counted.
 *
 * The animation repaints through stdout, and stdout is what the row counter
 * hijacks. Counting the animation's own output would feed the offset that
 * positions it: each repaint would push the next one further up the screen,
 * ten times a second, until the logo climbed over everything above it.
 *
 * @param text - The text to write.
 */
function write_untracked(text: string): void {
  if (originalWrite) {
    (originalWrite as (chunk: string) => boolean)(text);
  } else {
    process.stdout.write(text);
  }
}

/**
 * Stops hijacking process.stdout.write, restoring the original function handler.
 */
function stdoutTrack_stop(): void {
  if (originalWrite) {
    process.stdout.write = originalWrite as any;
    originalWrite = null;
  }
}

/**
 * Prints the static logo and begins tracking subsequent stdout lines.
 * Call this at boot to show the brain art; follow with logo_animatePulse() after login.
 *
 * @param useColor - True to enable colored rendering and prepare for pulsing.
 */
export function logo_print(useColor: boolean): void {
  const logoLines: string[] = logo_frameRender(0, true);
  logoLines.forEach((line: string) => console.log(line));
  console.log('');

  if (useColor && process.stdout.isTTY) {
    stdoutTrack_start();
  }
}

/**
 * Redraws the brain at the top of a cleared screen and brings it to life.
 *
 * The pulse repaints by moving the cursor up to where the logo is, so the logo
 * has to still be on screen. By the time a session has logged in, the logo and
 * the login output have usually scrolled past the top — and an animation that
 * cannot find its anchor paints at row zero instead, over whatever is there.
 *
 * Clearing and redrawing restores the anchor and gives boot output a full
 * screen to flow into beneath it. It also happens to be the gesture: the brain
 * is dead while credentials are checked, and lights up once they are good.
 *
 * @returns True when the screen was reset and the pulse started.
 */
export function logo_reviveOnScreen(): boolean {
  if (!process.stdout.isTTY) return false;
  logo_animateStop();
  stdoutTrack_stop();
  // Home the cursor and clear everything below it, so the logo is at row zero
  // with the whole screen underneath.
  process.stdout.write('\x1b[H\x1b[J');
  logo_print(true);
  logo_animatePulse();
  return true;
}

/**
 * Starts the pulsing brain activity animation in-place above already-printed output.
 * Must be called after logo_print(true); no-op if already running or non-TTY.
 */
export function logo_animatePulse(): void {
  if (logoInterval || !process.stdout.isTTY) return;

  const totalLines: number = logoRows_count();

  logoInterval = setInterval(() => {
    const upOffset: number = totalLines + 1 + linesPrinted;

    // The repaint is cursor-relative, which holds only while the logo is still
    // on screen. Once output has pushed it past the top, moving up clamps at
    // row zero and the logo is painted over whatever is visible there instead
    // — on a daemon boot, the address and token it had just printed. There is
    // no arithmetic that recovers a scrolled-away anchor, so the animation
    // stops while it is still correct.
    const rows: number = process.stdout.rows || 24;
    if (upOffset >= rows) {
      logo_animateStop();
      return;
    }

    logoFrameIndex++;
    // One buffered write per frame: interleaving a dozen small writes with
    // concurrent log output tears the repaint mid-brain.
    const frameLines: string[] = logo_frameRender(logoFrameIndex, false);
    write_untracked(
      '\x1b[s' +
      `\x1b[${upOffset}A\r` +
      frameLines.map((line: string): string => `\r${line}\x1b[1B`).join('') +
      '\x1b[u',
    );
  }, 100);
}

/**
 * Starts the brain activity pulsing node animation on the console.
 * Falls back to static plain rendering if non-TTY or color is disabled.
 *
 * @param useColor - True to enable colored pulsing, false for static plain rendering.
 */
export function logo_animateStart(useColor: boolean): void {
  logo_print(useColor);
  if (useColor && process.stdout.isTTY) {
    logo_animatePulse();
  }
}

/**
 * Stops the brain activity pulsing animation, rendering the final steady state.
 */
/**
 * Halts the pulse without touching the screen.
 *
 * The final-repaint in {@link logo_animateStop} positions itself by row
 * arithmetic that drifts over wrapped, ANSI-heavy output; on a daemon boot
 * that stamped the brain over the token and attach lines just printed. The
 * ready handoff (the console face taking the alternate screen) wants the
 * pulse simply gone, with the text record left exactly as it stands.
 */
export function logo_animateHalt(): void {
  if (logoInterval) {
    clearInterval(logoInterval);
    logoInterval = null;
  }
  stdoutTrack_stop();
}

export function logo_animateStop(): void {
  if (logoInterval) {
    clearInterval(logoInterval);
    logoInterval = null;

    const totalLines: number = logoRows_count();
    const upOffset: number = totalLines + 1 + linesPrinted;
    write_untracked('\x1b[s');
    write_untracked(`\x1b[${upOffset}A\r`);
    
    const finalLines: string[] = logo_frameRender(0, true); // Static steady state (holes blank)
    finalLines.forEach((line: string) => {
      write_untracked(`\r${line}\x1b[1B`);
    });
    
    write_untracked('\x1b[u');

    // Restore stdout write hook
    stdoutTrack_stop();
  }
}
