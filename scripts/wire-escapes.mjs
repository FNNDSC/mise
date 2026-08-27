/**
 * @file Escape ratchet — terminal control codes written to the session sink.
 *
 * What crosses the daemon wire should be session state, not one surface's
 * rendering of it. A carriage return, an erase-line, or a cursor hide is
 * choreography for a character grid: every surface that is not a terminal has
 * to reconstruct meaning from it, and each one reconstructs it slightly
 * differently.
 *
 * docs/structured-progress.md states the rule — "Progress must cross the
 * daemon wire as facts, not as terminal escape-frame text". Issue #221 brought
 * the last producer, the spinner, into line: it now announces indeterminate
 * progress as a typed event and each surface draws waiting in its own idiom.
 * The count is zero, so this is effectively a hard check; the baseline is kept
 * because a future refactor may legitimately need to park a number here.
 *
 * Enforces "Surfaces are views, not applications" in docs/principles.adoc. Run
 * via `npm run lint:wire`.
 *
 * @module
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Sink writes carrying terminal escapes. Lower this whenever it drops. */
const BASELINE = 0;

/** A write to the session sink whose argument contains an escape or a return. */
const PATTERN = /sink_get\(\)\.\w*write\([^)]*\\(?:r|x1[bB])/g;

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

const packagesDir = new URL('../packages', import.meta.url).pathname;
const hits = [];

for (const pkg of readdirSync(packagesDir)) {
  let files;
  try {
    files = sourceFiles_collect(join(packagesDir, pkg, 'src'), []);
  } catch {
    continue; // package without a src dir
  }
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    PATTERN.lastIndex = 0;
    let match = PATTERN.exec(text);
    while (match !== null) {
      const line = text.slice(0, match.index).split('\n').length;
      hits.push(`  ${file.slice(packagesDir.length + 1)}:${line}`);
      match = PATTERN.exec(text);
    }
  }
}

const total = hits.length;

if (total > BASELINE) {
  console.error(`wire-escapes: ${total} sink write(s) carry terminal escapes, baseline is ${BASELINE}.`);
  console.error('Terminal choreography on the wire forces every non-terminal surface to');
  console.error('emulate a character grid. Emit a typed status event instead and let each');
  console.error('surface render it in its own idiom. See docs/structured-progress.md and');
  console.error('issue #221.');
  console.error(hits.join('\n'));
  process.exit(1);
}

if (total < BASELINE) {
  console.error(`wire-escapes: count fell to ${total} (baseline ${BASELINE}) — good.`);
  console.error(`Lower BASELINE to ${total} in scripts/wire-escapes.mjs as part of this change`);
  console.error('so the improvement locks in.');
  process.exit(1);
}

console.log(`wire-escapes: ${total} escape-carrying sink write(s), at baseline.`);
