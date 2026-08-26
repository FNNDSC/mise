/**
 * @file Vite build configuration for the ARGUS web surface.
 *
 * The bundle is built with relative asset paths (`base: './'`) because it is
 * served by the CALYPSO daemon's static HTTP side from whatever port the
 * daemon bound; there is no fixed public origin to encode.
 *
 * @module
 */
import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
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
