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
import chalk from 'chalk';
import { daemon_launch, type DaemonLaunchInfo } from './daemon/launch.js';
import { daemonConsole_run } from './daemon/consoleSession.js';
import { hostControl_parseArgv, type HostControlPolicy } from './daemon/hostControl.js';
import { LocalBerthResolver, berthUrl_isAlive, type Berth } from './daemon/berth.js';

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

  const parsedPolicy = hostControl_parseArgv(process.argv, process.env);
  if ('error' in parsedPolicy) {
    console.error(`[!] ${parsedPolicy.error}`);
    process.exit(1);
  }
  const policy: HostControlPolicy = parsedPolicy.policy;
  const info: DaemonLaunchInfo = await daemon_launch(engine, undefined, { hostControl: policy });
  // The boot ends at a login, the same as `chell --daemon`: on a TTY the
  // daemon's own terminal becomes its first surface, an ordinary
  // `chell --remote` spawned onto it. Off a TTY (systemd, nohup) there is
  // no terminal to attach, so the daemon just keeps listening.
  if (process.stdin.isTTY === true && process.stdout.isTTY === true) {
    await daemonConsole_run({ identity: info.identity, url: info.url, token: info.token });
  }
}

/**
 * Prints how to attach to each live daemon.
 *
 * A daemon prints its addresses once, at launch, into a terminal it then
 * occupies. The facts survive in the berth — url and token, mode 0600 in the
 * user's runtime directory — so they are reprinted from there rather than
 * copied somewhere more convenient and less private. `/tmp` would be more
 * convenient; it is also world-readable, and the token is a credential.
 */
async function berths_print(): Promise<void> {
  const resolver: LocalBerthResolver = new LocalBerthResolver(
    (berth: Berth): Promise<boolean> => berthUrl_isAlive(berth.url),
  );
  const berths: Berth[] = await resolver.list();
  if (berths.length === 0) {
    console.error(chalk.yellow('No calypso is running.'));
    console.error(chalk.gray("Start one with:  calypso <user>@<url>"));
    return;
  }
  for (const berth of berths) {
    const web: string = berth.url.replace(/^ws/, 'http');
    console.log(chalk.bold.cyan(berth.identity));
    console.log(chalk.green(`  ARGUS:   ${web}/?token=${berth.token}`));
    console.log(chalk.gray(`  attach:  chell --remote --attach ${berth.url} --token ${berth.token}`));
  }
}

const currentFile: string = fileURLToPath(import.meta.url);
let isMain: boolean = false;
try {
  isMain = realpathSync(process.argv[1]) === realpathSync(currentFile);
} catch {
  // Not invoked as a script.
}

if (isMain) {
  // One flag, not a subcommand grammar: this binary hosts a daemon, and the
  // only other thing anyone needs from it is where the running ones are.
  void (process.argv.includes('--berths') ? berths_print() : calypso_start());
}
