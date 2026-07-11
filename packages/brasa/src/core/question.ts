/**
 * @file Shared question helpers for builtins.
 *
 * Thin adapters over the active {@link Surface}'s prompt operation. Builtins
 * (and the salsa admin-prompt flow, which is handed these functions) call
 * `repl_question` / `repl_questionHidden` and remain unaware of how the host
 * actually reads input — a local readline interface, or a request to a remote
 * surface. The host installs the surface (see `./cliSurface.js`); until it
 * does, the default surface fails these calls with a clear message rather
 * than hanging on a standard input that is not there.
 *
 * @module
 */

import { surface_get } from './surface.js';

/**
 * Asks a question through the active surface.
 *
 * @param prompt - The question string to display.
 * @returns The trimmed user answer.
 */
export function repl_question(prompt: string): Promise<string> {
  return surface_get().prompt({ message: prompt });
}

/**
 * Asks for a secret (no echo) through the active surface.
 *
 * @param prompt - The prompt string to display.
 * @returns The trimmed secret string.
 */
export function repl_questionHidden(prompt: string): Promise<string> {
  return surface_get().prompt({ message: prompt, hidden: true });
}
