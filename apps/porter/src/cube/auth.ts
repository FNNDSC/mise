/**
 * @file The one thing the door does with a password: trade it for a token.
 *
 * CUBE is the identity provider. The porter posts the operator's password to
 * `auth-token/` once, keeps the token it gets back for the session it
 * starts, and holds no password anywhere — not in memory past this call,
 * not on disk, not on a child's argv.
 *
 * @module
 */

/** What CUBE said to a login. */
export interface TokenMint {
  /** The token, when CUBE issued one. */
  token: string | null;
  /** Why not, when it did not: CUBE's status, or the network's word. */
  reason?: string;
}

/** The shape of `fetch` this module needs, so a test can stand one in. */
export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

/**
 * Trades a password for a CUBE token.
 *
 * @param cubeUrl - The CUBE API base, trailing slash included.
 * @param username - The operator's CUBE username.
 * @param password - The operator's password; used here and nowhere else.
 * @param fetchLike - The HTTP client; the global `fetch` by default.
 * @returns The token, or the reason there is none.
 */
export async function cubeToken_mint(
  cubeUrl: string,
  username: string,
  password: string,
  fetchLike: FetchLike = fetch as unknown as FetchLike,
): Promise<TokenMint> {
  let response: { ok: boolean; status: number; json(): Promise<unknown> };
  try {
    response = await fetchLike(`${cubeUrl}auth-token/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
  } catch (error: unknown) {
    return { token: null, reason: `CUBE unreachable: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (!response.ok) {
    return { token: null, reason: response.status === 400 || response.status === 401 ? 'CUBE refused the login' : `CUBE answered ${response.status}` };
  }
  const body: unknown = await response.json();
  const token: unknown = typeof body === 'object' && body !== null ? (body as { token?: unknown }).token : undefined;
  if (typeof token !== 'string' || token.length === 0) {
    return { token: null, reason: 'CUBE answered without a token' };
  }
  return { token };
}
