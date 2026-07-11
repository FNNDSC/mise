#!/usr/bin/env node
/**
 * @file The `calypso` daemon entry.
 *
 * Starts the session daemon on its own: create a brasa engine, restore a saved
 * session, and host the engine over a WebSocket for surfaces to attach. The
 * daemon is non-interactive — it runs from credentials already saved by the
 * CLI. If none are present it still starts (attachable, but offline until a
 * surface connects), telling the operator to log in with `chell` first.
 *
 * @module
 */

import { fileURLToPath } from 'node:url';
import { realpathSync } from 'node:fs';
import { engine_create, sessionConnect_fromSaved, type BrasaEngine, type SavedSessionResult } from '@fnndsc/brasa';
import { daemon_launch } from './daemon/launch.js';

/**
 * Creates the engine, restores the saved session, and hosts the daemon.
 *
 * @returns A promise that resolves once the daemon is listening; the process
 *   then stays alive on the WebSocket server.
 */
async function calypso_start(): Promise<void> {
  const engine: BrasaEngine = await engine_create();

  const result: SavedSessionResult = await sessionConnect_fromSaved();
  if (result.status === 'restored') {
    console.error(`[+] Session restored: ${result.context.user}@${result.context.URL}`);
  } else {
    console.error(`[!] No active session (${result.status}). Log in with 'chell' first; hosting offline.`);
  }

  await daemon_launch(engine);
}

const currentFile: string = fileURLToPath(import.meta.url);
let isMain: boolean = false;
try {
  isMain = realpathSync(process.argv[1]) === realpathSync(currentFile);
} catch {
  // Not invoked as a script.
}

if (isMain) {
  void calypso_start();
}
