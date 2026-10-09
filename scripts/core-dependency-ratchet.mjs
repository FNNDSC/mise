/**
 * @file Core dependency ratchet — the brasa core files that import a ChRIS
 * package (cumin, salsa or chili) or the ChRIS backend's own folder may only
 * fall in number.
 *
 * brasa's core (everything in its sources but the builtins and the ChRIS
 * backend's own `chris/` folder) is meant to know no backend
 * (docs/backend-neutral.adoc). Today some of it still reaches into the ChRIS
 * packages; this counts those files against the committed baseline. More than
 * the baseline is a regression and fails. Fewer also fails, with the
 * instruction to lower the baseline in the same change, so the ratchet clicks
 * down and an improvement cannot silently erode. Type-only imports count too:
 * a type has a neutral home (menu, fond) or it belongs to the backend. An
 * import of `chris/` counts as well, so moving a file into the backend lowers
 * the count only when the core stops reaching for it. The package entry
 * (`index.ts`) is not core: it is where the ChRIS backend is installed.
 *
 * Run via `npm run lint:core-deps`.
 *
 * @module
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

/** The committed count. Lower it whenever the real count drops. */
const BASELINE = 6;

/** An import, re-export or dynamic import naming a ChRIS package. */
const PATTERN = /(?:from|import)\s*\(?\s*['"]@fnndsc\/(?:cumin|salsa|chili)(?:\/[^'"]*)?['"]/;

/** An import, re-export or dynamic import of the ChRIS backend's folder. */
const BACKEND_PATTERN = /(?:from|import)\s*\(?\s*['"](?:\.\.?\/)+chris\/[^'"]*['"]/;

/** Folders and files of brasa's sources that are not its core. */
const NOT_CORE = ['builtins', 'chris', 'index.ts'];

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

const src = new URL('../packages/brasa/src', import.meta.url).pathname;
const offenders = sourceFiles_collect(src, [])
  .map((file) => relative(src, file))
  .filter((file) => !NOT_CORE.includes(file.split('/')[0]))
  .filter((file) => {
    const text = readFileSync(join(src, file), 'utf8');
    return PATTERN.test(text) || BACKEND_PATTERN.test(text);
  })
  .sort();

if (offenders.length > BASELINE) {
  console.error(`core-dependency-ratchet: ${offenders.length} brasa core files import a ChRIS package or chris/, baseline is ${BASELINE}.`);
  console.error('The core is meant to know no backend: give the new import a neutral home (menu, fond)');
  console.error('or move the code into the ChRIS backend (builtins/, chris/). See docs/backend-neutral.adoc.');
  console.error(offenders.map((file) => `  ${file}`).join('\n'));
  process.exit(1);
}
if (offenders.length < BASELINE) {
  console.error(`core-dependency-ratchet: count fell to ${offenders.length} (baseline ${BASELINE}) — good.`);
  console.error(`Lower BASELINE in scripts/core-dependency-ratchet.mjs to ${offenders.length} in this change.`);
  process.exit(1);
}
console.log(`core-dependency-ratchet: ${offenders.length} brasa core files import a ChRIS package or chris/, at baseline.`);
