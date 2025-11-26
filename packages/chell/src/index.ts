#!/usr/bin/env node

/**
 * @file ChELL Entry Point
 *
 * @module
 */
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
