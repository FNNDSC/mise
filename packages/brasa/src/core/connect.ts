/**
 * @file Headless session connect: restore a ChRIS connection from saved creds.
 *
 * This is the non-interactive half of establishing a session — load the saved
 * context and validate its token against the server. It carries no terminal
 * output of its own: it returns a status a frontend narrates (the CLI prints
 * progress; a daemon logs or exits). Interactive login (prompting for a URL and
 * password) is a frontend concern and lives with the CLI, not here. A token a
 * door already minted is the other headless way in, and it is here too.
 *
 * @module
 */

import { session } from '../session/index.js';
import { context_getSingle } from '@fnndsc/salsa';
import { SingleContext, Client, chrisContext, Context, type TokenConnectOutcome } from '@fnndsc/cumin';

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

/**
 * The outcome of a token hand-over.
 *
 * - `connected` — the server accepted the token; the session is this identity's.
 * - `refused` — the server did not; the session is offline and `error` says why.
 */
export interface TokenSessionResult {
  status: 'connected' | 'refused';
  context: SingleContext;
  /** What the server said, when the status is `refused`. */
  error?: string;
}

/**
 * Connects a session from a CUBE token a door already minted, without prompting.
 *
 * A login front on a shared host exchanges the operator's password for a
 * token itself and hands the token to the session it spawns; the session
 * never sees a password. The token is proved against the server before the
 * context is written, so a refusal changes nothing on disk. On acceptance
 * the context is set the way a credentialed boot sets it: the identity, and
 * no feed or plugin — the working directory is the identity's own and is
 * not touched, so a session that was evicted comes back where it was.
 *
 * @param user - The CUBE username the token was minted for.
 * @param url - The CUBE API base the token was minted against.
 * @param token - The token.
 * @returns Connected, or refused with the server's reason.
 */
export async function sessionConnect_withToken(user: string, url: string, token: string): Promise<TokenSessionResult> {
  const outcome: TokenConnectOutcome = await session.connection.connection_connectWithToken({ user, url, token });
  if (!outcome.connected) {
    session.offline = true;
    return { status: 'refused', context: await context_getSingle(), error: outcome.reason };
  }
  session.offline = false;
  await chrisContext.current_set(Context.ChRISuser, user);
  await chrisContext.current_set(Context.ChRISURL, url);
  await chrisContext.current_set(Context.ChRISfeed, '');
  await chrisContext.current_set(Context.ChRISplugin, '');
  return { status: 'connected', context: await context_getSingle() };
}
