#!/usr/bin/env node

/**
 * @file ChELL Entry Point
 *
 * @module
 */

import { fileURLToPath } from 'url';
import { realpathSync } from 'fs';
import { warnings_suppress } from './core/warnings.js';
import { chell_start } from './core/boot.js';

warnings_suppress();

const currentFile: string = fileURLToPath(import.meta.url);

// Compare real paths to handle symlinks (e.g. global install)
let isMain: boolean = false;
try {
  isMain = realpathSync(process.argv[1]) === realpathSync(currentFile);
} catch (e: unknown) {
  // Fallback or ignore
}

if (isMain) {
  chell_start();
}
