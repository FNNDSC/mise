/**
 * @file What code this porter ships, and whether a session's daemon runs
 * older code than it.
 *
 * A porter reinstalled leaves the daemons it started running the code they
 * booted on. Their berths say what that was (calypso writes its versions
 * at boot); this porter knows what it ships. A login that would mount the
 * older one restarts it first, so a login never lands on a kernel older
 * than the door's.
 *
 * @module
 */
import { createRequire } from 'node:module';
import type { Berth } from '@fnndsc/calypso/berth';

/** The packages whose versions decide whether a daemon is behind the door. */
export const DOOR_PACKAGES: ReadonlyArray<string> = ['@fnndsc/brasa', '@fnndsc/calypso', '@fnndsc/chell'];

/**
 * The versions this porter's tree holds for the daemon's packages.
 *
 * @returns Short package name (`brasa`) → version; a package that does not resolve is left out.
 */
export function installed_read(): Record<string, string> {
  const req = createRequire(import.meta.url);
  const versions: Record<string, string> = {};
  for (const name of DOOR_PACKAGES) {
    try {
      const manifest = req(`${name}/package.json`) as { version?: unknown };
      if (typeof manifest.version === 'string') versions[name.replace(/^@[^/]+\//, '')] = manifest.version;
    } catch {
      // Not in this tree: it cannot be compared, so it does not decide.
    }
  }
  return versions;
}

/**
 * Whether a berth's daemon runs older code than the door ships.
 *
 * A berth with no versions predates the field, and so predates this porter:
 * behind. A version the daemon reports that differs from the door's is
 * behind; one the door cannot name does not decide.
 *
 * @param berth - The session's berth.
 * @param installed - What the door ships, from {@link installed_read}.
 * @returns The packages that differ (`brasa 0.31.5 → 0.33.0`), empty when the daemon is current.
 */
export function berth_behind(berth: Berth, installed: Record<string, string>): string[] {
  // A door that can name no versions of its own can call nobody behind.
  if (Object.keys(installed).length === 0) return [];
  if (berth.versions === undefined) return ['versions unknown (a daemon from before the door kept them)'];
  const behind: string[] = [];
  for (const [name, version] of Object.entries(installed)) {
    const running: string | undefined = berth.versions[name];
    if (running !== undefined && running !== version) behind.push(`${name} ${running} → ${version}`);
  }
  return behind;
}

/**
 * What `porter --version` says: the door's own version, then the session
 * code it serves (brasa, calypso, chell) — the code a login would put a
 * daemon on, and so whether a session older than it restarts. One aligned
 * `name  version` line each, as `chell --version` prints its stack.
 *
 * @param installed - What the door ships, from {@link installed_read}.
 * @param own - The door's version; read from its package by default.
 * @returns The report.
 */
export function versionReport_build(installed: Record<string, string> = installed_read(), own: string = porterVersion_read()): string {
  const rows: Array<[string, string]> = [['porter', own], ...Object.entries(installed)];
  const width: number = Math.max(...rows.map(([name]: [string, string]): number => name.length));
  return rows.map(([name, version]: [string, string]): string => `${name.padEnd(width)}  ${version}`).join('\n');
}

/** The door's own version, from its package.json (one level above dist/ and src/). */
export function porterVersion_read(): string {
  try {
    const manifest = createRequire(import.meta.url)('../package.json') as { version?: unknown };
    return typeof manifest.version === 'string' ? manifest.version : 'unknown';
  } catch {
    return 'unknown';
  }
}
