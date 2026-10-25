/**
 * @file Which surface a line came from.
 *
 * One session serves several surfaces at once: a console, a browser, a
 * second terminal. What a line leaves behind for the operator who typed it
 * (the listing `@3` counts) belongs to that operator's surface, not to the
 * session: a listing one surface reads must not renumber the rows another
 * is about to act on (#1273).
 *
 * The host names the origin when it hands the kernel a line; a line run
 * inside it (a manifest's, a capture's) inherits it. A line with no host
 * behind it (a test, a headless script) has the default origin.
 *
 * @module
 */

import { AsyncLocalStorage } from 'node:async_hooks';

/** The origin of a line no host named. */
export const ORIGIN_DEFAULT: string = '';

const originScope: AsyncLocalStorage<string> = new AsyncLocalStorage<string>();

/**
 * Runs an operation as lines from one origin.
 *
 * @param origin - The surface the line came from.
 * @param operation - The work.
 * @returns What the operation returns.
 */
export async function lineOrigin_run<T>(origin: string, operation: () => Promise<T>): Promise<T> {
  return await originScope.run(origin, operation);
}

/**
 * The origin of the line running now.
 *
 * @returns The surface it came from, or {@link ORIGIN_DEFAULT}.
 */
export function lineOrigin_get(): string {
  return originScope.getStore() ?? ORIGIN_DEFAULT;
}
