/**
 * @file stratus cloud ratchet — only the OCI driver may import an `oci-*`
 * package, and stratus never imports a ChRIS package.
 *
 * stratus is one backend for every cloud, the cloud a driver inside it
 * (docs/stratus.adoc, D1). The tree, the verbs and the composition are
 * written against the driver interface; an `oci-*` import anywhere but
 * `src/cloud/oci/` would bind them to one cloud, and an import of cumin,
 * salsa or chili would bind the substrate session to CUBE. Both counts are
 * zero and stay zero: a hard check with no baseline, like `lint:fond`.
 *
 * Run via `npm run lint:stratus-deps`.
 *
 * @module
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

/** An import, re-export, require or dynamic import of an OCI SDK package. */
const OCI_PATTERN = /(?:from|import|require)\s*\(?\s*['"]oci-[^'"]*['"]/;
/** The same, of a ChRIS package. */
const CHRIS_PATTERN = /(?:from|import|require)\s*\(?\s*['"]@fnndsc\/(?:cumin|salsa|chili)(?:\/[^'"]*)?['"]/;
/** The one folder that may speak to the OCI SDK. */
const OCI_DRIVER = 'cloud/oci/';

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

const src = new URL('../packages/stratus/src', import.meta.url).pathname;
const files = sourceFiles_collect(src, []).map((file) => relative(src, file)).sort();
const ociOutsideDriver = files.filter((file) => !file.startsWith(OCI_DRIVER) && OCI_PATTERN.test(readFileSync(join(src, file), 'utf8')));
const chris = files.filter((file) => CHRIS_PATTERN.test(readFileSync(join(src, file), 'utf8')));

let failed = false;
if (ociOutsideDriver.length > 0) {
  console.error(`stratus-cloud-ratchet: ${ociOutsideDriver.length} file(s) outside ${OCI_DRIVER} import an oci-* package:`);
  console.error(ociOutsideDriver.map((file) => `  ${file}`).join('\n'));
  console.error('The cloud is a driver: put the SDK call behind CloudDriver, in cloud/oci/. See docs/stratus.adoc.');
  failed = true;
}
if (chris.length > 0) {
  console.error(`stratus-cloud-ratchet: ${chris.length} file(s) import a ChRIS package:`);
  console.error(chris.map((file) => `  ${file}`).join('\n'));
  console.error('A substrate session is outside any ChRIS; stratus depends on brasa core, fond, menu and calypso only.');
  failed = true;
}
if (failed) process.exit(1);
console.log(`stratus-cloud-ratchet: ${files.length} files; oci-* only under ${OCI_DRIVER}, no ChRIS package.`);
