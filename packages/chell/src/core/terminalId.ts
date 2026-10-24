/**
 * @file The terminal a chell draws, when a daemon runs it as a browser's
 * console: the daemon hands it the terminal's id in CHELL_TERMINAL, and the
 * chell says it on attach so the daemon knows whose console it is.
 *
 * @module
 */
/**
 * The terminal id a daemon handed this chell, when it runs as a browser's
 * terminal: a hex id, never the bare flag older daemons set.
 *
 * @param value - CHELL_TERMINAL as found.
 * @returns The id, or null when this chell is no terminal's.
 */
export function terminalId_parse(value: string | undefined): string | null {
  return value !== undefined && /^[0-9a-f]{8,}$/.test(value) ? value : null;
}

