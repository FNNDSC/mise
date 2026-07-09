#!/usr/bin/env node

/**
 * @file The `calypso` entry point — chell's session daemon as its own command.
 *
 * `calypso` is `chell --daemon` under a dedicated name: it hosts one engine over
 * a loopback WebSocket for remote surfaces to attach to. It deliberately shares
 * chell's entire connection surface — the `user@url` shorthand, `--user`, and
 * the hidden password prompt — by forcing daemon mode into the argument vector
 * and delegating to the same bootstrap. Attach a surface with `chell --remote`.
 *
 * @module
 */

import { fileURLToPath } from 'url';
import { realpathSync } from 'fs';
import { warnings_suppress } from './core/warnings.js';
import { chell_start } from './core/boot.js';

warnings_suppress();

const currentFile: string = fileURLToPath(import.meta.url);

// Compare real paths to handle symlinks (e.g. global install).
let isMain: boolean = false;
try {
  isMain = realpathSync(process.argv[1]) === realpathSync(currentFile);
} catch {
  // Fallback or ignore.
}

/**
 * Returns an argv with daemon mode forced on, leaving every other argument
 * (the connection target, `--user`, startup toggles) untouched so chell's
 * parser handles them exactly as it does for `chell`.
 *
 * @param argv - The process argument vector.
 * @returns The argv guaranteed to request daemon mode.
 */
function daemonArgv_build(argv: string[]): string[] {
  if (argv.includes('--daemon')) {
    return argv;
  }
  return [...argv.slice(0, 2), '--daemon', ...argv.slice(2)];
}

if (isMain) {
  void chell_start(daemonArgv_build(process.argv));
}
