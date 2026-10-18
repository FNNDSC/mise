/**
 * @file trek isolation — bsd-trek imports nothing of mise.
 *
 * bsd-trek is the trek game as a package anyone can install, and the
 * engine the session's `trek` and ARGUS's bridge both consume
 * (docs/trek.adoc). It is built inside mise as if it came from outside: its
 * sources import only their own modules, Node's, and the dependencies its
 * package.json names; its package.json names nothing of @fnndsc. Anything
 * the game needs from mise becomes part of mise's public contract instead
 * of a reach into its internals.
 *
 * A hard check with no baseline: the count is zero and stays zero. Run via
 * `npm run lint:trek`.
 *
 * @module
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Matches the module named by an import, re-export or require. */
const IMPORT_PATTERN = /(?:from|import|require)\s*\(?\s*['"]([^'"]+)['"]/g;

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

const trekRoot = new URL('../packages/trek/', import.meta.url).pathname;
const manifest = JSON.parse(readFileSync(join(trekRoot, 'package.json'), 'utf8'));
const declared = new Set(Object.keys(manifest.dependencies ?? {}));
const violations = [];

/**
 * Whether a module specifier is one bsd-trek may import.
 *
 * @param {string} spec - The specifier.
 * @returns {string | null} Why not, or null when it may.
 */
function specifier_refusal(spec) {
  if (spec.startsWith('node:')) return null;
  if (spec.startsWith('./')) return null;
  if (spec.startsWith('../')) return spec.startsWith('../package.json') ? null : 'reaches outside its own folder';
  if (spec.startsWith('@fnndsc/')) return 'imports mise';
  const name = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0];
  return declared.has(name) ? null : 'is not a declared dependency';
}

for (const file of sourceFiles_collect(join(trekRoot, 'src'), [])) {
  const text = readFileSync(file, 'utf8');
  IMPORT_PATTERN.lastIndex = 0;
  let match = IMPORT_PATTERN.exec(text);
  while (match !== null) {
    const why = specifier_refusal(match[1]);
    if (why !== null) {
      const line = text.slice(0, match.index).split('\n').length;
      violations.push(`  ${file.slice(trekRoot.length)}:${line}  ${match[1]} ${why}`);
    }
    match = IMPORT_PATTERN.exec(text);
  }
}

for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
  for (const name of Object.keys(manifest[field] ?? {})) {
    if (name.startsWith('@fnndsc/')) violations.push(`  package.json ${field}: ${name}`);
  }
}

if (violations.length > 0) {
  console.error(`trek-isolation: ${violations.length} import(s) bsd-trek may not make.`);
  for (const v of violations) console.error(v);
  process.exit(1);
}
console.log('trek-isolation: bsd-trek imports only itself, Node and its declared dependencies.');
