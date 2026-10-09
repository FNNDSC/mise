/**
 * @file An error stack message as an operator reads it.
 *
 * @module
 */
import { backendInstalled_get } from './backend.js';

/**
 * Strips the function-name stamp from an error stack message, unless the
 * backend is debugging.
 *
 * @param message - The message as the error stack holds it.
 * @returns The message an operator reads.
 *
 * @example
 * ```
 * error_stripDebugPrefix("[PacsVfsProvider.list                    ] | ls: error");
 * // "ls: error" unless debugging
 * ```
 */
export function error_stripDebugPrefix(message: string): string {
  if (backendInstalled_get()?.debug_get?.() === true) {
    return message;
  }
  return message.replace(/^\[[^\]]+\]\s*\|\s*/, '');
}
