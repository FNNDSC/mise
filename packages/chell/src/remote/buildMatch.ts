/**
 * @file A remote chell says when it and the daemon it attached to are
 * different builds, and why the daemon went away when it says.
 *
 * A daemon keeps the code it started with; rebuild or upgrade under it and
 * a freshly started chell is newer than the kernel it drives, so a verb the
 * new chell knows can meet a kernel that does not. Said once, at attach.
 *
 * @module
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';


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

/**
 * What a remote chell says when the daemon tells it why it is going away.
 *
 * @param cause - Why: a door restart, an administrator's end, or a plain stop.
 * @returns The line.
 */
export function closingLine_of(cause: 'restart' | 'end' | 'stop'): string {
  if (cause === 'restart') return '[!] The calypso daemon is restarting (asked from ARGUS). Attach again in a moment.';
  if (cause === 'end') return '[!] The calypso daemon was ended by an administrator.';
  return '[!] The calypso daemon stopped.';
}

/** What this chell's own shipped notes say is newest: its release and first operator headline. */
export interface SurfaceNews {
  version: string;
  headline: string;
}

/**
 * Reads this chell's own `dist/notes.json` (written at build from its
 * CHANGELOG): when the daemon's code moved on disk, the surface is the one
 * that knows what the newer release brings — the daemon's own `notes` would
 * read the old one (a-readout-names-the-release-it-reads).
 *
 * @param notesPath - Where the notes are; the shipped file beside this module's dist by default.
 * @returns The newest release's version and first headline, or null.
 */
export function surfaceNews_read(notesPath: string = fileURLToPath(new URL('../notes.json', import.meta.url))): SurfaceNews | null {
  try {
    const notes = JSON.parse(readFileSync(notesPath, 'utf8')) as { version?: unknown; releases?: Array<{ changes?: Array<{ headline?: unknown; internal?: unknown }> }> };
    const headline: unknown = notes.releases?.[0]?.changes?.find((c): boolean => c.internal !== true)?.headline;
    if (typeof headline !== 'string' || typeof notes.version !== 'string') return null;
    return { version: notes.version, headline };
  } catch {
    return null;
  }
}

/** A headline longer than this is cut on the line; `notes` has the whole. */
const NEWS_LINE_MAX: number = 96;

/**
 * The lines a terminal prints when the daemon says its own code on disk has
 * moved since it started: the fact, the cure, and what the newer release brings.
 *
 * @param news - This surface's own newest release, when its notes are at hand.
 * @returns The lines.
 */
export function staleLines_of(news: SurfaceNews | null): string[] {
  const lines: string[] = [
    '[!] The calypso daemon is out of date: its code on disk has changed since it started. Restart it — RESTART in ARGUS, or `porter --end <you>` at its porter, then attach again.',
  ];
  if (news !== null) {
    const headline: string = news.headline.length > NEWS_LINE_MAX ? `${news.headline.slice(0, NEWS_LINE_MAX - 1).trimEnd()}…` : news.headline;
    lines.push(`    chell ${news.version} · ${headline} — \`notes\` after the restart`);
  }
  return lines;
}
