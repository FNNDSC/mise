/**
 * Bundles the compiled chell entry into a single self-contained CommonJS file
 * suitable for wrapping into a standalone executable with pkg.
 *
 * Why a prebundle: chell is ESM with runtime module resolution; collapsing it to
 * one CJS file lets us shim `import.meta.url`, inline the version, and inline all
 * workspace/npm dependencies so the executable needs no node_modules at runtime.
 */

import { build } from 'esbuild';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(here, '..');
const version = JSON.parse(
  readFileSync(resolve(pkgRoot, 'package.json'), 'utf-8')
).version;

// Every stack package's version, inlined so the standalone binary can report
// them: there are no package.json files on disk at runtime. Keyed by package
// name to match version.ts's __STACK_VERSIONS__ lookup.
const stackVersions = {};
for (const pkg of ['chell', 'brasa', 'chili', 'salsa', 'cumin', 'calypso']) {
  stackVersions[`@fnndsc/${pkg}`] = JSON.parse(
    readFileSync(resolve(pkgRoot, '..', pkg, 'package.json'), 'utf-8')
  ).version;
}

await build({
  entryPoints: [resolve(pkgRoot, 'dist/index.js')],
  outfile: resolve(pkgRoot, 'build/chell.cjs'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  // CJS output has no import.meta; provide a __filename-based shim.
  banner: {
    js: "const __import_meta_url = require('url').pathToFileURL(__filename).href;",
  },
  define: {
    'import.meta.url': '__import_meta_url',
    __STACK_VERSIONS__: JSON.stringify(stackVersions),
  },
  logLevel: 'info',
});

console.log(`bundled chell ${version} -> build/chell.cjs`);
