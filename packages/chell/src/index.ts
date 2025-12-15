#!/usr/bin/env node

/**
 * @file ChELL Entry Point
 *
 * @module
 */

// Suppress DEP0169 warning from axios/proxy-from-env dependency.
// proxy-from-env 1.1.0 (pulled via axios) still uses url.parse(), which triggers
// a deprecation warning in Node. This suppression is safe to remove once that
// dependency migrates to the WHATWG URL API or axios drops it.
const originalEmitWarning = process.emitWarning;
process.emitWarning = function (warning: string | Error, ...args: any[]): void {
  if (
    typeof warning === 'string' &&
    (warning.includes('DEP0169') || warning.includes('url.parse()'))
  ) {
    return;
  }
  return originalEmitWarning.call(process, warning, ...args);
};

import { fileURLToPath } from 'url';
import { realpathSync } from 'fs';
import { chell_start } from './chell.js';

const currentFile = fileURLToPath(import.meta.url);

// Compare real paths to handle symlinks (e.g. global install)
let isMain = false;
try {
  isMain = realpathSync(process.argv[1]) === realpathSync(currentFile);
} catch (e) {
  // Fallback or ignore
}

if (isMain) {
  chell_start();
}
