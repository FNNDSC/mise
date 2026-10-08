/**
 * @file fond isolation — fond depends on nothing in @fnndsc.
 *
 * fond holds the pieces every layer needs, whatever the backend
 * (docs/backend-neutral.adoc). Its whole point is that a layer which is not
 * about CUBE can use it without loading CUBE's client, so an import of any
 * @fnndsc package from its sources, or a dependency in its package.json,
 * undoes it.
 *
 * A hard check with no baseline: the count is zero and stays zero. Run via
 * `npm run lint:fond`.
 *
 * @module
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Matches an import, re-export or require naming any @fnndsc package. */
const IMPORT_PATTERN = /(?:from|import|require)\s*\(?\s*['"](@fnndsc\/[^'"/]+)(?:\/[^'"]*)?['"]/g;

/**
 * Recursively collects .ts source files under a directory.
 *
 * @param {string} dir - Directory to walk.
 * @param {string[]} out - Accumulator for matched file paths.
 * @returns {string[]} The accumulator.
 */
function sourceFiles_collect(dir, out) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles_collect(full, out);
    else if (entry.name.endsWith('.ts')) out.push(full);
  }
  return out;
}

const fondRoot = new URL('../packages/fond/', import.meta.url).pathname;
const violations = [];

for (const file of sourceFiles_collect(join(fondRoot, 'src'), [])) {
  const text = readFileSync(file, 'utf8');
  IMPORT_PATTERN.lastIndex = 0;
  let match = IMPORT_PATTERN.exec(text);
  while (match !== null) {
    const line = text.slice(0, match.index).split('\n').length;
    violations.push(`  ${file.slice(fondRoot.length)}:${line}  imports ${match[1]}`);
    match = IMPORT_PATTERN.exec(text);
  }
}

const manifest = JSON.parse(readFileSync(join(fondRoot, 'package.json'), 'utf8'));
for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
  for (const name of Object.keys(manifest[field] ?? {})) {
    if (name.startsWith('@fnndsc/')) violations.push(`  package.json ${field}: ${name}`);
  }
}

if (violations.length > 0) {
  console.error(`fond-isolation: ${violations.length} @fnndsc dependency(ies) in fond.`);
  console.error('fond is the neutral base: it depends on nothing in @fnndsc, so a layer');
  console.error('that is not about CUBE can use it without loading CUBE. Move the concern');
  console.error('to the package that needs it. See docs/backend-neutral.adoc.');
  console.error(violations.join('\n'));
  process.exit(1);
}

console.log('fond-isolation: fond depends on nothing in @fnndsc.');
