/**
 * @file Debugging in a ChRIS session: the CUBE connection's own flag.
 *
 * @module
 */
import type { Backend } from '../core/backend.js';
import { session } from '../session/index.js';

/** Whether the CUBE connection is debugging, or null until its configuration exists. */
export const chrisDebug_get: NonNullable<Backend['debug_get']> = (): boolean | null =>
  (session.connection?.config ? Boolean(session.connection.config.debug) : null);

/** Turns the CUBE connection's debugging on or off, once its configuration exists. */
export const chrisDebug_set: NonNullable<Backend['debug_set']> = (on: boolean): void => {
  if (session.connection?.config) session.connection.config.debug = on;
};
