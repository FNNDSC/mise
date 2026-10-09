/**
 * @file `notes`: what the installed releases changed, for the operator
 * (epic #897).
 *
 * Each of the packages an operator can touch — argus, brasa, chell,
 * calypso, porter — ships `dist/notes.json`, written at build from its
 * CHANGELOG.md (scripts/notes-build.mjs). This command reads the ones
 * installed where the kernel runs, so a TTY and a browser read the same
 * disk the daemon runs from (a-readout-names-the-release-it-reads), groups
 * them by the day they were released, and answers a `session.notes` model
 * beneath the text. A change written "Internal: …" is ours alone and is
 * hidden unless `--all` asks.
 *
 * @module
 */
import { createRequire } from 'node:module';
import * as fs from 'node:fs';
import path from 'node:path';
import { SESSION_NOTES_MODEL_KIND, type NotesChange, type NotesEntry, type NotesRelease, type SessionNotes, CommandEnvelope, envelope_ok, envelope_error } from '@fnndsc/menu';
import chalk from 'chalk';

/** The packages whose notes an operator reads, in the order a release lists them. */
export const NOTES_PACKAGES: ReadonlyArray<string> = ['@fnndsc/argus', '@fnndsc/brasa', '@fnndsc/chell', '@fnndsc/calypso', '@fnndsc/porter'];

/** What one package's `dist/notes.json` holds. */
export interface PackageNotes {
  package: string;
  version: string;
  releases: Array<{ version: string; date: string | null; merge?: string | null; bump: 'major' | 'minor' | 'patch'; changes: Array<{ headline: string; body: string; internal: boolean }> }>;
}

/** Reads one package's shipped notes; null when the package or its notes are not installed. */
export type NotesLoader = (name: string) => PackageNotes | null;

/** The default loader: node resolution from here, so a hoisted or nested install both answer. */
export function notes_load(name: string): PackageNotes | null {
  try {
    const req = createRequire(import.meta.url);
    const manifest: string = req.resolve(`${name}/package.json`);
    const text: string = fs.readFileSync(path.join(path.dirname(manifest), 'dist', 'notes.json'), 'utf8');
    return JSON.parse(text) as PackageNotes;
  } catch {
    return null;
  }
}

/** `@fnndsc/argus` → `argus`. */
export function package_short(name: string): string {
  return name.replace(/^@[^/]+\//, '');
}

/**
 * Gathers the installed packages' notes into releases, newest first.
 *
 * A release is one Version Packages merge: every package it published
 * shares the merge hash, so two releases on one day stay two. A version
 * without a merge (built without history) stands as a release of its own,
 * after the dated ones.
 *
 * @param loader - Reads one package's notes.
 * @returns The releases and the installed versions.
 */
export function notes_gather(loader: NotesLoader = notes_load): { releases: NotesRelease[]; installed: Record<string, string> } {
  const byMerge: Map<string, NotesRelease> = new Map();
  const undated: NotesRelease[] = [];
  const installed: Record<string, string> = {};
  for (const name of NOTES_PACKAGES) {
    const notes: PackageNotes | null = loader(name);
    if (notes === null) continue;
    const short: string = package_short(name);
    installed[short] = notes.version;
    for (const release of notes.releases) {
      const entry: NotesEntry = {
        package: short,
        version: release.version,
        bump: release.bump,
        changes: release.changes.map((c): NotesChange => ({ package: short, headline: c.headline, body: c.body, internal: c.internal })),
      };
      const merge: string | null = release.merge ?? null;
      if (release.date === null || merge === null) { undated.push({ date: release.date, merge, entries: [entry] }); continue; }
      const group: NotesRelease = byMerge.get(merge) ?? { date: release.date, merge, entries: [] };
      group.entries.push(entry);
      byMerge.set(merge, group);
    }
  }
  // Newest first: by day, and within a day in the order the packages list
  // them (a later merge is read first by argus, the surface, which comes first).
  const dated: NotesRelease[] = [...byMerge.values()].sort((a: NotesRelease, b: NotesRelease): number => ((a.date as string) < (b.date as string) ? 1 : (a.date as string) > (b.date as string) ? -1 : 0));
  return { releases: [...dated, ...undated], installed };
}

/** What the flags ask for. */
export interface NotesAsk {
  /** Releases to show: a count, or every release on or after a date; 1 when unsaid. */
  since: number | string;
  /** Internal changes too. */
  all: boolean;
  /** The bodies beneath the headlines. */
  long: boolean;
}

/** Reads the flags; a refusal names the flag. */
export function notesArgs_parse(args: string[]): NotesAsk | { refusal: string } {
  const ask: NotesAsk = { since: 1, all: false, long: false };
  for (let i: number = 0; i < args.length; i++) {
    const a: string = args[i] as string;
    if (a === '--all' || a === '-a') ask.all = true;
    else if (a === '--long' || a === '-l') ask.long = true;
    else if (a === '--since' || a === '-s') {
      const v: string | undefined = args[++i];
      if (v === undefined) return { refusal: 'notes: --since wants a count or a date (YYYY-MM-DD)' };
      if (/^\d+$/.test(v)) ask.since = Number(v);
      else if (/^\d{4}-\d{2}-\d{2}$/.test(v)) ask.since = v;
      else return { refusal: `notes: --since wants a count or a date (YYYY-MM-DD), not '${v}'` };
    } else if (a.startsWith('-')) return { refusal: `notes: unknown flag '${a}' (--since N|DATE, --all, --long)` };
    else return { refusal: `notes: takes no argument '${a}' (--since N|DATE, --all, --long)` };
  }
  return ask;
}

/** The releases the ask selects, internal changes dropped unless asked for. */
export function notes_select(releases: NotesRelease[], ask: NotesAsk): NotesRelease[] {
  const chosen: NotesRelease[] = typeof ask.since === 'number'
    ? releases.slice(0, Math.max(1, ask.since))
    : releases.filter((r: NotesRelease): boolean => r.date !== null && r.date >= (ask.since as string));
  return chosen.map((r: NotesRelease): NotesRelease => ({
    date: r.date,
    merge: r.merge,
    entries: r.entries.map((e: NotesEntry): NotesEntry => ({ ...e, changes: ask.all ? e.changes : e.changes.filter((c: NotesChange): boolean => !c.internal) })),
  }));
}

/** One release's heading: the date and every package that moved. */
export function release_title(release: NotesRelease): string {
  const moved: string = release.entries.map((e: NotesEntry): string => `${e.package} ${e.version}`).join(' · ');
  return `${release.date ?? 'undated'} · ${moved}`;
}

/** The text: a heading per release, a row per headline, the body beneath when asked. */
export function notes_render(releases: NotesRelease[], ask: NotesAsk): string {
  if (releases.length === 0) return `${chalk.gray('no release notes installed here')}\n`;
  const lines: string[] = [];
  for (const release of releases) {
    lines.push(chalk.bold.yellow(release_title(release)));
    for (const entry of release.entries) {
      for (const change of entry.changes) {
        const tag: string = chalk.cyan(entry.package.padEnd(8));
        lines.push(`  ${tag} ${change.internal ? chalk.gray(change.headline) : change.headline}`);
        if (ask.long && change.body !== '') {
          for (const row of change.body.split('\n')) lines.push(`           ${chalk.gray(row)}`);
        }
      }
      if (entry.changes.length === 0) lines.push(`  ${chalk.cyan(entry.package.padEnd(8))} ${chalk.gray('(internal changes only; notes --all shows them)')}`);
    }
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
}

/** `notes [--since N|DATE] [--all] [--long]` */
export async function builtin_notes(args: string[], loader: NotesLoader = notes_load): Promise<CommandEnvelope> {
  const ask: NotesAsk | { refusal: string } = notesArgs_parse(args);
  if ('refusal' in ask) return envelope_error('', undefined, `${ask.refusal}\n`);
  const gathered = notes_gather(loader);
  const shown: NotesRelease[] = notes_select(gathered.releases, ask);
  const model: SessionNotes = { source: 'daemon', installed: gathered.installed, releases: shown, total: gathered.releases.length, all: ask.all };
  const foot: string = gathered.releases.length > shown.length && typeof ask.since === 'number'
    ? chalk.gray(`${gathered.releases.length - shown.length} earlier release${gathered.releases.length - shown.length === 1 ? '' : 's'}: notes --since N, or a date\n`)
    : '';
  return envelope_ok(`${notes_render(shown, ask)}${foot}`, { kind: SESSION_NOTES_MODEL_KIND, data: model });
}

/** The NEWS file on the static VFS: every release, headlines only. */
export function news_text(loader: NotesLoader = notes_load): string {
  const gathered = notes_gather(loader);
  const ask: NotesAsk = { since: gathered.releases.length, all: false, long: false };
  return notes_render(notes_select(gathered.releases, ask), ask).replace(/\x1b\[[0-9;]*m/g, '');
}
