/**
 * @file Headless session connect: restore a ChRIS connection from saved creds.
 *
 * This is the non-interactive half of establishing a session — load the saved
 * context and validate its token against the server. It carries no terminal
 * output of its own: it returns a status a frontend narrates (the CLI prints
 * progress; a daemon logs or exits). Interactive login (prompting for a URL and
 * password) is a frontend concern and lives with the CLI, not here.
 *
 * @module
 */

import { session } from '../session/index.js';
import { context_getSingle } from '@fnndsc/salsa';
import { SingleContext, Client } from '@fnndsc/cumin';

/**
 * The outcome of a saved-session restore.
 *
 * - `restored` — a saved token validated against the server.
 * - `no-context` — no saved user/URL to restore.
 * - `no-token` — a saved context but no token; connect again to obtain one.
 * - `no-client` — a token, but a client could not be created.
 * - `invalid-token` — a token that the server rejected (expired/invalid).
 */
export type SavedSessionStatus = 'restored' | 'no-context' | 'no-token' | 'no-client' | 'invalid-token';

/** The result of {@link sessionConnect_fromSaved}. */
export interface SavedSessionResult {
  status: SavedSessionStatus;
  context: SingleContext;
  /** The server error message when the status is `invalid-token`. */
  error?: string;
}

/**
 * Restores a session from saved credentials, without any prompting.
 *
 * On any failure the session is put into offline mode. The caller narrates the
 * outcome; a daemon treats anything but `restored` as "not connected".
 *
 * @returns The restore outcome and the resolved context.
 */
export async function sessionConnect_fromSaved(): Promise<SavedSessionResult> {
  const context: SingleContext = await context_getSingle();

  if (!context.user || !context.URL) {
    return { status: 'no-context', context };
  }

  const token: string | null = await session.connection.authToken_get(true);
  if (!token) {
    session.offline = true;
    return { status: 'no-token', context };
  }

  try {
    const client: Client | null = await session.connection.client_get();
    if (!client) {
      session.offline = true;
      return { status: 'no-client', context };
    }
    await client.getUser();
    return { status: 'restored', context };
  } catch (error: unknown) {
    session.offline = true;
    return { status: 'invalid-token', context, error: error instanceof Error ? error.message : String(error) };
  }
}
