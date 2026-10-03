/**
 * @file A remote chell says when it and the daemon it attached to are
 * different builds.
 *
 * A daemon keeps the code it started with; rebuild or upgrade under it and
 * a freshly started chell is newer than the kernel it drives, so a verb the
 * new chell knows can meet a kernel that does not. Said once, at attach.
 *
 * @module
 */

/** Builds that name no commit, and so cannot be compared. */
const UNCOMPARABLE: ReadonlySet<string> = new Set(['dev', 'unknown', '']);

/**
 * The warning a remote chell prints when its build and the daemon's differ.
 *
 * @param local - This chell's build hash.
 * @param daemon - The daemon's build hash.
 * @returns The line, or null when they agree or either names no commit.
 */
export function buildMismatch_line(local: string, daemon: string): string | null {
  if (UNCOMPARABLE.has(local) || UNCOMPARABLE.has(daemon) || local === daemon) return null;
  return `[!] This chell (${local}) and the calypso daemon (${daemon}) are different builds. Restart the calypso daemon.`;
}
