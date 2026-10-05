/**
 * @file Release notes, shipped: a package's CHANGELOG.md (what changesets
 * write) read into `dist/notes.json` at build, so the surface can show an
 * operator what a release changed (epic #897).
 *
 * One source, one shape. Each changeset's first sentence is the operator's
 * headline and the rest unfolds beneath it; a headline that begins
 * "Internal:" marks a change the surface hides by default. A release's
 * date is the day its Version Packages merge landed on this branch's
 * first-parent line, read from git; without history (a shallow checkout,
 * a tarball) the date is null and the surface groups by version alone.
 *
 * Runs from the package directory: `node ../../scripts/notes-build.mjs`.
 *
 * @module
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const packageDir = process.cwd();
const manifest = JSON.parse(readFileSync(path.join(packageDir, 'package.json'), 'utf8'));
const changelogPath = path.join(packageDir, 'CHANGELOG.md');

/** The words the headline convention marks as the operator's. */
export const HEADLINE_INTERNAL = /^internal:/i;

/**
 * Splits one changeset's prose into the operator headline and the rest.
 *
 * The headline is the first sentence of the first paragraph: up to the
 * first full stop followed by a space or the end, with a backticked span
 * kept whole (a sentence may name `a.command`).
 *
 * @param {string} text - The changeset prose, paragraphs joined by blank lines.
 * @returns {{ headline: string, body: string }} The split.
 */
export function prose_split(text) {
  const first = (text.split(/\n\s*\n/)[0] ?? '').replace(/\s+/g, ' ').trim();
  let depth = false;
  let cut = first.length;
  for (let i = 0; i < first.length; i++) {
    const c = first[i];
    if (c === '`') depth = !depth;
    if (!depth && (c === '.' || c === ';') && (i === first.length - 1 || first[i + 1] === ' ')) { cut = i + 1; break; }
  }
  const headline = first.slice(0, cut).trim();
  const rest = `${first.slice(cut).trim()}${text.includes('\n\n') ? `\n\n${text.split(/\n\s*\n/).slice(1).join('\n\n')}` : ''}`.trim();
  return { headline, body: rest };
}

/**
 * Reads a CHANGELOG.md as changesets write it: `## version`, then
 * `### Major|Minor|Patch Changes`, then `- hash: prose` bullets whose
 * continuation lines are indented.
 *
 * @param {string} markdown - The file.
 * @returns {Array<{ version: string, bump: string, changes: Array<{ hash: string|null, headline: string, body: string, internal: boolean }> }>} Newest first, as the file is.
 */
export function changelog_parse(markdown) {
  const releases = [];
  const RANK = { patch: 0, minor: 1, major: 2 };
  let release = null;
  let bullet = null;
  const bullet_close = () => {
    if (bullet === null || release === null) return;
    const { headline, body } = prose_split(bullet.lines.join('\n').trim());
    release.changes.push({ hash: bullet.hash, headline, body, internal: HEADLINE_INTERNAL.test(headline) });
    bullet = null;
  };
  for (const line of markdown.split('\n')) {
    const version = line.match(/^## (\d+\.\d+\.\d+\S*)\s*$/);
    if (version) { bullet_close(); release = { version: version[1], bump: 'patch', changes: [] }; releases.push(release); continue; }
    const kind = line.match(/^### (Major|Minor|Patch) Changes/);
    if (kind) {
      bullet_close();
      // A release's bump is its biggest: minor and patch changes together make a minor release.
      const bump = kind[1].toLowerCase();
      if (release && RANK[bump] > RANK[release.bump]) release.bump = bump;
      continue;
    }
    const start = line.match(/^- (?:([0-9a-f]{7,40}): )?(.*)$/);
    if (start && release !== null) { bullet_close(); bullet = { hash: start[1] ?? null, lines: [start[2]] }; continue; }
    if (bullet !== null) {
      if (line.trim() === '') bullet.lines.push('');
      else if (/^\s{2,}/.test(line)) bullet.lines.push(line.replace(/^\s{2}/, ''));
      else bullet_close();
    }
  }
  bullet_close();
  return releases;
}

/**
 * The date each version heading first appeared on this branch's
 * first-parent line: the Version Packages merge that released it.
 *
 * @param {string} file - The CHANGELOG path.
 * @returns {Map<string, string>} version → ISO date; empty without history.
 */
function dates_read(file) {
  const dates = new Map();
  let log;
  try {
    log = execFileSync('git', ['log', '--first-parent', '--reverse', '--format=%H\t%cI', '--', file], { cwd: packageDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return dates;
  }
  const relative = path.relative(execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: packageDir, encoding: 'utf8' }).trim(), file);
  for (const row of log.split('\n').filter(Boolean)) {
    const [hash, date] = row.split('\t');
    let text;
    try {
      text = execFileSync('git', ['show', `${hash}:${relative}`], { cwd: packageDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    } catch {
      continue;
    }
    for (const m of text.matchAll(/^## (\d+\.\d+\.\d+\S*)\s*$/gm)) {
      if (!dates.has(m[1])) dates.set(m[1], date.slice(0, 10));
    }
  }
  return dates;
}

if (process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  const releases = existsSync(changelogPath) ? changelog_parse(readFileSync(changelogPath, 'utf8')) : [];
  const dates = existsSync(changelogPath) ? dates_read(changelogPath) : new Map();
  const notes = {
    package: manifest.name,
    version: manifest.version,
    built: new Date().toISOString(),
    releases: releases.map((r) => ({ version: r.version, date: dates.get(r.version) ?? null, bump: r.bump, changes: r.changes })),
  };
  const distDir = path.join(packageDir, 'dist');
  mkdirSync(distDir, { recursive: true });
  writeFileSync(path.join(distDir, 'notes.json'), `${JSON.stringify(notes)}\n`);
  const dated = notes.releases.filter((r) => r.date !== null).length;
  console.log(`notes-build: ${manifest.name} ${notes.releases.length} releases, ${dated} dated, ${notes.releases.reduce((n, r) => n + r.changes.length, 0)} changes → dist/notes.json`);
}
