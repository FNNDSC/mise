/**
 * @file Whether the calypso daemon's own code is still the code on its disk.
 *
 * A daemon keeps the code it started with. Upgrade the install or rebuild the
 * checkout under it and every surface that attaches from then on talks to an
 * older kernel than the one on disk — a control the new code knows meets a
 * process that does not. The daemon is the one place that can say so
 * exactly: it fingerprints its own packages when it starts, reads the
 * fingerprint again from disk, and calls itself stale when they differ.
 *
 * The fingerprint is each package's version and the content of its compiled
 * `dist/*.js`. Content, not file times: a reinstall of the same version
 * rewrites every file's time without changing a byte, and that must not call
 * a daemon stale; a rebuild of a checkout at the same commit changes bytes
 * without changing a version, and that must. A few megabytes, hashed in tens
 * of milliseconds, once a minute — a stat of local files, not CUBE traffic.
 *
 * @module
 */
import { createHash, type Hash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import * as path from 'node:path';

/** The packages a daemon runs; whichever of them resolve are fingerprinted. */
export const DAEMON_PACKAGES: readonly string[] = [
  '@fnndsc/brasa',
  '@fnndsc/calypso',
  '@fnndsc/chell',
  '@fnndsc/chili',
  '@fnndsc/cumin',
  '@fnndsc/menu',
  '@fnndsc/salsa',
];

/** How often a daemon reads its disk again. */
export const CODE_CHECK_MS: number = 60_000;

/**
 * The directories of the daemon's packages, resolved from this module and
 * from the process's entry (a chell launched the daemon; calypso itself does
 * not depend on chell).
 *
 * @param entry - The process's entry script, `process.argv[1]` by default.
 * @returns Each package's directory, in `DAEMON_PACKAGES` order.
 */
export function daemonPackageRoots_find(entry: string | undefined = process.argv[1]): string[] {
  const resolvers: Array<(specifier: string) => string> = [createRequire(import.meta.url).resolve];
  if (entry !== undefined) resolvers.push(createRequire(path.resolve(entry)).resolve);
  const roots: string[] = [];
  for (const name of DAEMON_PACKAGES) {
    for (const resolve of resolvers) {
      try {
        roots.push(path.dirname(resolve(`${name}/package.json`)));
        break;
      } catch {
        // Not resolvable this way; try the next, or leave it out.
      }
    }
  }
  return roots;
}

/**
 * Every `.js` file under a directory, sorted, as paths relative to it.
 *
 * @param root - The directory.
 * @returns The files; none when the directory is missing.
 */
async function scripts_list(root: string): Promise<string[]> {
  const found: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    let entries: Array<{ name: string; isDirectory: () => boolean }>;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full: string = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.name.endsWith('.js')) found.push(path.relative(root, full));
    }
  };
  await walk(root);
  return found.sort();
}

/**
 * Fingerprints the code in some package directories: each one's
 * `package.json` and every compiled script under its `dist`.
 *
 * @param roots - The package directories.
 * @returns A hex digest; equal digests mean identical code.
 */
export async function codeFingerprint_read(roots: readonly string[]): Promise<string> {
  const hash: Hash = createHash('sha1');
  for (const root of roots) {
    hash.update(`\0${path.basename(root)}\0`);
    try {
      hash.update(await readFile(path.join(root, 'package.json')));
    } catch {
      hash.update('no package.json');
    }
    const dist: string = path.join(root, 'dist');
    for (const file of await scripts_list(dist)) {
      hash.update(`\0${file}\0`);
      try {
        hash.update(await readFile(path.join(dist, file)));
      } catch {
        // Vanished between the listing and the read: a build is under way,
        // and the next reading sees how it ended.
        hash.update('gone');
      }
    }
  }
  return hash.digest('hex');
}

/** A started watch on the daemon's own code. */
export interface CodeWatch {
  /** Reads the disk now; resolves to whether the daemon is stale. */
  check: () => Promise<boolean>;
  /** Stops the clock. */
  stop: () => void;
}

/**
 * Watches the daemon's own code: fingerprints it now, then reads the disk
 * again on a slow clock (and whenever `check` is called), telling `flipped`
 * each time the answer changes.
 *
 * @param flipped - Told the new answer when it changes.
 * @param roots - The package directories; the daemon's own by default.
 * @param intervalMs - The clock.
 * @returns The watch.
 */
export async function codeWatch_start(
  flipped: (stale: boolean) => void,
  roots: readonly string[] = daemonPackageRoots_find(),
  intervalMs: number = CODE_CHECK_MS,
): Promise<CodeWatch> {
  const started: string = await codeFingerprint_read(roots);
  let stale: boolean = false;
  const check = async (): Promise<boolean> => {
    const now: boolean = (await codeFingerprint_read(roots)) !== started;
    if (now !== stale) {
      stale = now;
      flipped(stale);
    }
    return stale;
  };
  const timer: NodeJS.Timeout = setInterval((): void => { void check().catch((): void => undefined); }, intervalMs);
  // The clock must not hold the process open on its own.
  timer.unref();
  return { check, stop: (): void => clearInterval(timer) };
}
