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
export type SavedSessionStatus = 'restored' | 'no-context' | 'no-token' | 'no-client' | 'invalid-token' | 'unreachable';

/** The result of {@link sessionFromSaved_connect}. */
export interface SavedSessionResult {
  status: SavedSessionStatus;
  context: SingleContext;
  /** The server's error message (`invalid-token`), or what met the request (`unreachable`). */
  error?: string;
}

/** How long the saved token's check waits before asking a silent CUBE again. */
export const SAVED_TOKEN_RETRY_MS: number = 2000;

/** Whether a request got no answer at all (not a refusal: nothing came back). */
function answer_none(error: unknown): boolean {
  const message: string = error instanceof Error ? error.message : String(error);
  return /^No server response!$|^fetch failed$|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|socket hang up/.test(message);
}

/**
 * Restores a session from saved credentials, without any prompting.
 *
 * On any failure the session is put into offline mode. The caller narrates the
 * outcome; a daemon treats anything but `restored` as "not connected".
 *
 * @returns The restore outcome and the resolved context.
 */
export async function sessionFromSaved_connect(): Promise<SavedSessionResult> {
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
    // The check reads `users/`, not the API root: the root is the feed
    // list, which can outlast the check for an identity that sees
    // thousands of feeds (#1280).
    const url: string = context.URL;
    try {
      await session.connection.token_check(url, token);
    } catch (first: unknown) {
      // No answer at all is not a refusal: asked once more before the
      // session gives up on it.
      if (!answer_none(first)) throw first;
      await new Promise((resolve: (value: unknown) => void): unknown => setTimeout(resolve, SAVED_TOKEN_RETRY_MS));
      await session.connection.token_check(url, token);
    }
    return { status: 'restored', context };
  } catch (error: unknown) {
    session.offline = true;
    const message: string = error instanceof Error ? error.message : String(error);
    return { status: answer_none(error) ? 'unreachable' : 'invalid-token', context, error: message };
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
export async function sessionWithToken_connect(user: string, url: string, token: string): Promise<TokenSessionResult> {
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
