/**
 * @file Same-user daemon discovery.
 *
 * The daemon writes its URL and attach token to a user-only-readable file so a
 * `chell --remote` client running as the same user can find it without the
 * token crossing any other channel. This mirrors the local-daemon model: the
 * perimeter is the loopback bind plus a token whose only distribution is a
 * 0600 file on the same machine.
 *
 * @module
 */
import { writeFileSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { userInfo } from 'os';

/** What the discovery file records. */
export interface Discovery {
  url: string;
  token: string;
}

/**
 * The per-user discovery file path.
 *
 * @returns The path the daemon writes and a client reads.
 */
export function discovery_path(): string {
  return join(tmpdir(), `chell-calypso-${userInfo().username}.json`);
}

/**
 * Writes the discovery file, readable only by the current user.
 *
 * @param discovery - The URL and token to record.
 */
export function discovery_write(discovery: Discovery): void {
  writeFileSync(discovery_path(), JSON.stringify(discovery), { mode: 0o600 });
}

/**
 * Reads the discovery file.
 *
 * @returns The recorded URL and token, or null when no daemon has advertised.
 */
export function discovery_read(): Discovery | null {
  const path: string = discovery_path();
  if (!existsSync(path)) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf-8'));
    if (
      typeof parsed === 'object' && parsed !== null &&
      typeof (parsed as Discovery).url === 'string' &&
      typeof (parsed as Discovery).token === 'string'
    ) {
      return parsed as Discovery;
    }
    return null;
  } catch {
    return null;
  }
}
