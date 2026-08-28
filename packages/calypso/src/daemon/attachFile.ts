/**
 * @file The attach note: a daemon's addresses, written where they can be read.
 *
 * A daemon prints its ARGUS link and attach command once, into a terminal it
 * then occupies with a live boot animation. Selecting text out from under a
 * repainting screen is awkward, and scrollback is lost the moment anyone
 * clears it — so the same lines are also written to a file.
 *
 * The file carries the attach token, which is a credential, and `/tmp` is
 * world-readable. Three things follow, and none is optional:
 *
 * * it is created `0600`, so the mode rather than the directory protects it;
 * * it is created exclusively (`wx`), so a symlink planted at the path by
 *   another user makes the write fail rather than land somewhere chosen by
 *   them; and
 * * it is removed when the daemon exits, so a dead session's token does not
 *   linger.
 *
 * `calypso --berths` reads the same facts from the berth, which is `0600` in
 * the user's own runtime directory. That remains the safer route; this one is
 * the convenient one.
 *
 * @module
 */

import { chmodSync, openSync, writeSync, closeSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { userInfo } from 'node:os';

/**
 * The path this daemon's attach note occupies.
 *
 * Per OS user rather than per session, so it can be named in a message and
 * found again without reading one. A second daemon for a second CUBE identity
 * overwrites it; `calypso --berths` lists them all.
 *
 * @returns An absolute path in the system temporary directory.
 */
export function attachFile_path(): string {
  return join(tmpdir(), `calypso-${userInfo().username}.attach`);
}

/**
 * Writes the attach note, replacing any note this user left before.
 *
 * @param lines - The addresses to record, one per line.
 * @returns The path written, or null when it could not be written safely.
 */
export function attachFile_write(lines: string[]): string | null {
  const path: string = attachFile_path();
  try {
    // Remove our own stale note first, then create exclusively: if anything
    // reappears at the path in between, the create fails rather than writing
    // through whatever is there.
    rmSync(path, { force: true });
    const handle: number = openSync(path, 'wx', 0o600);
    try {
      writeSync(handle, `${lines.join('\n')}\n`);
    } finally {
      closeSync(handle);
    }
    // openSync's mode is subject to umask; set it outright.
    chmodSync(path, 0o600);
    return path;
  } catch {
    // A note is a convenience. Failing to write one must never stop a daemon
    // from starting, and the addresses were printed regardless.
    return null;
  }
}

/** Removes the attach note, so a dead session's token does not linger. */
export function attachFile_remove(): void {
  try {
    rmSync(attachFile_path(), { force: true });
  } catch {
    // Nothing useful to say at exit about a file that may already be gone.
  }
}
