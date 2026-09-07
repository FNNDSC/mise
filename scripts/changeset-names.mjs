/**
 * @file Changeset names — every package a changeset bumps must exist.
 *
 * A changeset naming a package the workspace does not have is accepted by
 * every check in CI and fails at exactly one moment: the release, after the
 * merge, when `changeset version` refuses the whole run. Twelve changesets
 * written over three sessions said `argus` where the workspace says
 * `@fnndsc/argus`, and the first anyone heard of it was a failed publish.
 *
 * Run via `npm run lint:changesets`.
 *
 * @module
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;

/**
 * Reads every workspace package's declared name.
 *
 * @returns {Set<string>} The names a changeset may legitimately bump.
 */
function workspaceNames_read() {
  const names = new Set();
  for (const group of ['packages', 'apps']) {
    let entries;
    try {
      entries = readdirSync(join(root, group), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      try {
        const manifest = JSON.parse(readFileSync(join(root, group, entry.name, 'package.json'), 'utf8'));
        if (typeof manifest.name === 'string') names.add(manifest.name);
      } catch {
        // A directory without a manifest is not a workspace package.
      }
    }
  }
  return names;
}

const known = workspaceNames_read();
const offences = [];
let bumps = 0;

for (const file of readdirSync(join(root, '.changeset'))) {
  if (!file.endsWith('.md') || file === 'README.md') continue;
  const text = readFileSync(join(root, '.changeset', file), 'utf8');
  const front = text.split('---')[1] ?? '';
  for (const line of front.split('\n')) {
    const named = line.match(/^\s*["']([^"']+)["']\s*:\s*(major|minor|patch)\s*$/);
    if (!named) continue;
    bumps += 1;
    if (!known.has(named[1])) {
      offences.push(`  .changeset/${file}: '${named[1]}' is not a workspace package`);
    }
  }
}

if (offences.length > 0) {
  console.error(`changeset-names: ${offences.length} changeset entr(ies) name a package that does not exist.`);
  console.error(`Known packages: ${[...known].sort().join(', ')}`);
  console.error(offences.join('\n'));
  process.exit(1);
}

console.log(`changeset-names: ${bumps} bump(s) across ${known.size} workspace packages, all resolvable.`);
