/**
 * @file Legacy single-file same-user daemon discovery.
 *
 * Retained for compatibility and its direct tests; current daemon launch and
 * ChELL attachment use identity-keyed berths from `berth.ts`. This older model
 * records only one daemon per OS user in a 0600 file.
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
 * The legacy per-user discovery file path.
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
