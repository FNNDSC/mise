/**
 * Regenerates the bundled fortune dataset from classic fortune-mod datfiles.
 *
 * The `fortune` builtin is fully self-contained — it bundles its data rather
 * than reading host files or spawning a subprocess — so the content is vendored
 * here into a TypeScript module at authoring time. This script parses the
 * traditional `%`-delimited datfiles and emits `src/builtins/sys/fortunes.data.ts`.
 *
 * Usage (datfiles default to the ones installed by the `fortune-mod` package):
 *   node scripts/fortunes_generate.mjs [datfile ...]
 *
 * The datfiles are classic BSD `fortune` content, freely distributed since the
 * 1980s (BSD lineage: Regents of the University of California / Ken Arnold and
 * community contributors). They are not committed to this repo; only the parsed
 * dataset is.
 */
import { readFileSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const here = dirname(fileURLToPath(import.meta.url));
const DEFAULT_DATFILES = ['fortunes', 'linux'].map((f) => `/usr/share/fortune/${f}`);
const datfiles = process.argv.length > 2 ? process.argv.slice(2) : DEFAULT_DATFILES;

const seen = new Set();
const fortunes = [];
for (const path of datfiles) {
  const raw = readFileSync(path, 'utf-8');
  for (const entry of raw.split(/\n%\n/)) {
    const text = entry.replace(/\s+$/, '');
    if (text.length === 0 || seen.has(text)) continue;
    seen.add(text);
    fortunes.push(text);
  }
}

const header = `/**
 * @file Bundled classic "fortune" cookies.
 *
 * Vendored from the traditional fortune-mod datfiles so the \`fortune\` builtin is
 * fully self-contained: no host files, no subprocess — it works identically in a
 * local shell, over a CALYPSO daemon, and in the standalone binary. This content
 * is classic BSD \`fortune\` material, freely distributed since the 1980s (BSD
 * lineage: Regents of the University of California / Ken Arnold and community
 * contributors).
 *
 * Regenerate with \`node scripts/fortunes_generate.mjs\`; do not edit by hand.
 *
 * @module
 */

/** The bundled fortune cookies, one entry per fortune. */
export const FORTUNES: readonly string[] = `;

writeFileSync(
  resolve(here, '..', 'src', 'builtins', 'sys', 'fortunes.data.ts'),
  `${header}${JSON.stringify(fortunes, null, 2)};\n`,
);
console.log(`wrote ${fortunes.length} fortunes from ${datfiles.length} datfile(s)`);
