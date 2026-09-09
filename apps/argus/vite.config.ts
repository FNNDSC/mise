/**
 * @file Vite build configuration for the ARGUS web surface.
 *
 * The bundle is built with relative asset paths (`base: './'`) because it is
 * served by the CALYPSO daemon's static HTTP side from whatever port the
 * daemon bound; there is no fixed public origin to encode.
 *
 * @module
 */
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const require: NodeRequire = createRequire(import.meta.url);

/**
 * The checkout's short git hash, or 'unhashed' outside a git checkout (a
 * published tarball build). Stamped into the bundle for the about face.
 */
function gitHash_read(): string {
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
  } catch {
    return 'unhashed';
  }
}

export default defineConfig({
  base: './',
  // Cornerstone3D's documented Vite recipe: the image loader carries its own
  // workers and wasm codecs, and dicom-parser is CommonJS.
  optimizeDeps: {
    exclude: ['@cornerstonejs/dicom-image-loader'],
    include: ['dicom-parser'],
  },
  worker: { format: 'es' },
  resolve: {
    alias: {
      // vtk.js's XML reader and writer import xmlbuilder2 (CommonJS), whose
      // class hierarchy breaks under Vite's interop at module init and takes
      // the whole surface down; the image pane never reads or writes VTK XML.
      xmlbuilder2: fileURLToPath(new URL('./src/features/image/xmlbuilder2-stub.ts', import.meta.url)),
    },
  },
  define: {
    __ARGUS_GIT__: JSON.stringify(gitHash_read()),
    __ARGUS_BUILT__: JSON.stringify(new Date().toISOString().slice(0, 16).replace('T', ' ')),
    __ARGUS_MENU__: JSON.stringify(
      (require('@fnndsc/menu/package.json') as { version: string }).version,
    ),
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    commonjsOptions: {
      // The protocol import chain reaches CommonJS dist files (cumin's
      // constants) through workspace symlinks, whose real paths live outside
      // node_modules; widen the CJS interop to cover them.
      include: [/node_modules/, /packages\/(cumin|brasa)\/dist/],
    },
  },
});
