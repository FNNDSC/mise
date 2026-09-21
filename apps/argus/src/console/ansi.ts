/**
 * @file The console's ANSI rendering, as ARGUS has always imported it.
 *
 * The converter and the palette moved to the wire package so the porter's
 * greeter can render a daemon's boot rows the way this console renders its
 * transcript; what stays here is the one part that needs a DOM.
 *
 * @module
 */
import { CONSOLE_PALETTE } from '@fnndsc/menu/ansi';

export { ansi_toHtml, html_escape, CONSOLE_PALETTE, type ConsoleColour } from '@fnndsc/menu/ansi';

/**
 * Publishes the console's palette as `--console-<name>` custom properties,
 * so a surface that lists what the console lists (the browser) can wear
 * the console's colours by token rather than by a second copy of the hex.
 *
 * @param target - The element to write the properties on (the root).
 */
export function consolePalette_publish(target: HTMLElement): void {
  for (const [name, hex] of Object.entries(CONSOLE_PALETTE)) {
    target.style.setProperty(`--console-${name}`, hex);
  }
}
