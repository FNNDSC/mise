/**
 * @file Kernel isolation — brasa may not import from any surface.
 *
 * brasa is the intent kernel. It processes an intent and returns typed
 * envelopes, and it does not know that surfaces exist: not what a WebSocket
 * is, not what a browser panel is, not what a terminal renderer is. An import
 * from chell, calypso or argus anywhere in brasa's sources inverts the
 * dependency and is an architectural violation, not a discussion.
 *
 * This is a hard check with no baseline. The count is zero and stays zero;
 * the brasa/chell split exists precisely to make that true, and until now it
 * rested entirely on vigilance.
 *
 * Enforces "Kernel isolation" in docs/principles.adoc. Run via
 * `npm run lint:kernel`.
 *
 * @module
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Packages brasa must never import: the surfaces and the daemon hosting them. */
const FORBIDDEN = ['@fnndsc/chell', '@fnndsc/calypso', '@fnndsc/argus'];

/** Matches an import or re-export naming one of the forbidden packages. */
const IMPORT_PATTERN = new RegExp(
  String.raw`(?:from|import)\s*\(?\s*['"](${FORBIDDEN.join('|')})(?:/[^'"]*)?['"]`,
  'g',
);

/**
 * Recursively collects .ts source files under a directory, skipping tests.
 *
 * @param {string} dir - Directory to walk.
 * @param {string[]} out - Accumulator for matched file paths.
 * @returns {string[]} The accumulator.
 */
function sourceFiles_collect(dir, out) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      sourceFiles_collect(full, out);
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
      out.push(full);
    }
  }
  return out;
}

const brasaSrc = new URL('../packages/brasa/src', import.meta.url).pathname;
const violations = [];

for (const file of sourceFiles_collect(brasaSrc, [])) {
  const text = readFileSync(file, 'utf8');
  IMPORT_PATTERN.lastIndex = 0;
  let match = IMPORT_PATTERN.exec(text);
  while (match !== null) {
    const line = text.slice(0, match.index).split('\n').length;
    violations.push(`  ${file.slice(brasaSrc.length - 'src'.length)}:${line}  imports ${match[1]}`);
    match = IMPORT_PATTERN.exec(text);
  }
}

if (violations.length > 0) {
  console.error(`kernel-isolation: ${violations.length} surface import(s) in brasa.`);
  console.error('brasa is the kernel: it processes intents and returns envelopes, and it');
  console.error('does not know surfaces exist. Move the surface-facing concern into the');
  console.error('surface, or introduce a seam brasa can depend on without inversion.');
  console.error('See "Kernel isolation" in docs/principles.adoc.');
  console.error(violations.join('\n'));
  process.exit(1);
}

console.log('kernel-isolation: brasa imports no surface.');
