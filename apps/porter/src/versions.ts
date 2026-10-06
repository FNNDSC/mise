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
