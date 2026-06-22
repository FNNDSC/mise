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
    __CHELL_VERSION__: JSON.stringify(version),
  },
  logLevel: 'info',
});

console.log(`bundled chell ${version} -> build/chell.cjs`);
