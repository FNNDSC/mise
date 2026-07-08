/**
 * @file The attach token: generation, discovery file, and constant-time
 * comparison.
 *
 * The daemon's attach perimeter is the proven local-daemon model: a random
 * token generated at startup, required in every attach handshake, compared in
 * constant time. The token is printed and written to a user-readable file so
 * a same-user surface can discover it without it crossing an untrusted
 * channel. Remote access is an operator concern (an SSH tunnel or TLS proxy
 * in front, with the token still gating attach inside it).
 *
 * @module
 */
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { writeFileSync } from 'node:fs';

/**
 * Generates a fresh attach token: 256 bits of randomness, hex-encoded.
 *
 * @returns The token string.
 */
export function token_generate(): string {
  return randomBytes(32).toString('hex');
}

/**
 * Writes the token to a file readable only by the current user (mode 0600),
 * for same-user discovery.
 *
 * @param token - The token to write.
 * @param path - The destination file path.
 */
export function token_writeFile(token: string, path: string): void {
  writeFileSync(path, `${token}\n`, { mode: 0o600 });
}

/**
 * Compares a provided token against the expected one in constant time, so a
 * mismatch reveals nothing through timing. Unequal lengths fail fast (and are
 * not themselves secret).
 *
 * @param expected - The daemon's token.
 * @param provided - The token a surface presented at attach.
 * @returns True when the tokens match exactly.
 */
export function token_matches(expected: string, provided: string): boolean {
  const expectedBytes: Buffer = Buffer.from(expected, 'utf-8');
  const providedBytes: Buffer = Buffer.from(provided, 'utf-8');
  if (expectedBytes.length !== providedBytes.length) {
    return false;
  }
  return timingSafeEqual(expectedBytes, providedBytes);
}
