/**
 * @file Cast ratchet — the repository's `as unknown as` count may only fall.
 *
 * Counts occurrences of `as unknown as` across all package sources (tests
 * excluded) and compares against the committed baseline. A count above the
 * baseline is a regression and fails. A count below the baseline also fails,
 * with instructions to lower the baseline in the same change, so the ratchet
 * clicks down and improvements cannot silently erode.
 *
 * The adapter seam (packages/cumin/src/chrisapi/adapter.ts) is the only
 * module licensed to hold such casts long-term; everything else burns down
 * on-touch. Run via `npm run lint:casts`.
 *
 * @module
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** The committed cast count. Lower it whenever the real count drops. */
const BASELINE = 44;

const PATTERN = /as unknown as/g;

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
let total = 0;

for (const pkg of readdirSync(packagesDir)) {
  let files;
  try {
    files = sourceFiles_collect(join(packagesDir, pkg, 'src'), []);
  } catch {
    continue; // package without a src dir
  }
  for (const file of files) {
    const count = (readFileSync(file, 'utf8').match(PATTERN) ?? []).length;
    if (count > 0) {
      hits.push(`  ${count}  ${file.slice(packagesDir.length + 1)}`);
      total += count;
    }
  }
}

if (total > BASELINE) {
  console.error(`cast-ratchet: ${total} 'as unknown as' casts found, baseline is ${BASELINE}.`);
  console.error('New casts against the chrisapi boundary belong in cumin/src/chrisapi/adapter.ts');
  console.error('(the licensed seam) or behind the typed contract, not at call sites.');
  console.error(hits.join('\n'));
  process.exit(1);
}

if (total < BASELINE) {
  console.error(`cast-ratchet: count fell to ${total} (baseline ${BASELINE}) — good.`);
  console.error(`Lower BASELINE to ${total} in scripts/cast-ratchet.mjs as part of this change`);
  console.error('so the improvement locks in.');
  process.exit(1);
}

console.log(`cast-ratchet: ${total} casts, at baseline.`);
