/**
 * @file chell's daemon-console entry, over the console the daemon package
 * owns.
 *
 * The console loop, the cage and the reattach grammar live in calypso, since
 * both the standalone `calypso` binary and `chell --daemon` end their boot
 * this way. chell's one difference is the surface it launches: it spawns
 * itself — this build, at this path — rather than whatever `chell` the path
 * happens to resolve, so the console is never a different chell than the
 * daemon it sits on.
 *
 * @module
 */
import { fileURLToPath } from 'node:url';
import {
  daemonConsole_run as consoleSession_run,
  consoleDeps_live,
  type DaemonConsoleTarget,
  type SurfaceLaunch,
} from '@fnndsc/calypso';

export type { DaemonConsoleTarget };

/** This chell build's own entry, spawned as the console surface. */
export const CHELL_ENTRY: string = fileURLToPath(new URL('../index.js', import.meta.url));

/** Launch the surface as this very chell, not one resolved from the path. */
const CHELL_LAUNCH: SurfaceLaunch = { exec: process.execPath, prefixArgs: [CHELL_ENTRY] };

/**
 * Runs the daemon console on chell's own terminal, spawning this chell as
 * the surface.
 *
 * @param target - The daemon to attach to.
 * @returns Resolves when the operator will not attach again.
 */
export async function daemonConsole_run(target: DaemonConsoleTarget): Promise<void> {
  return consoleSession_run(target, consoleDeps_live(CHELL_LAUNCH));
}
