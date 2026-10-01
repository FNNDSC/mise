#!/usr/bin/env node
/**
 * @file The `porter` entry: the mise display manager.
 *
 * Reads its configuration from the environment, stands a process host on
 * this machine, and listens. `porter --status` lists the sessions a running
 * porter's state directory holds; `porter --end <who>` ends one of them.
 *
 * @module
 */
import { porterConfig_resolve, porterStateDir_resolve, chellEntry_locate, type PorterConfig } from './config.js';
import { ProcessHost } from './host/processHost.js';
import { porterApp_build, type PorterApp } from './app.js';
import type { SessionSighting } from './host/sessionHost.js';
import { berthKey_compute } from '@fnndsc/calypso/berth';

/**
 * Lists the sessions the state directory holds, without starting anything.
 *
 * Needs only the state directory (and the chell the host is built around,
 * which a listing never runs): no CUBE, no port, no secret.
 *
 * @param stateDir - Where the state directory is.
 */
async function status_print(stateDir: string): Promise<void> {
  const host: ProcessHost = new ProcessHost({ stateDir, chellEntry: process.env['PORTER_CHELL'] ?? chellEntry_locate() });
  const sightings: SessionSighting[] = await host.sessions_adopt();
  console.log(`state: ${stateDir}`);
  if (sightings.length === 0) {
    console.log('no sessions');
    return;
  }
  for (const sighting of sightings) {
    const state: string = sighting.alive ? 'answering' : 'gone';
    // The pid is what the daemon wrote when it started. On a gone row it
    // names a process that is not there — a berth outlives a daemon killed
    // with -9 — and printed bare it read as one the listing had just made.
    const pid: string = sighting.berth.pid === undefined
      ? ''
      : sighting.alive ? `  pid ${sighting.berth.pid}` : `  pid ${sighting.berth.pid} (stale: the berth outlived it)`;
    console.log(`${berthKey_compute(sighting.identity)}  ${state.padEnd(9)}  ${sighting.berth.url.padEnd(24)}  ${sighting.identity}${pid}`);
  }
}

/**
 * Ends one session: the daemon is sent SIGTERM, its state directory stays,
 * and the operator's next login boots a fresh one on the kernel this
 * porter now carries. An adopted session keeps the kernel it was born
 * with across every porter upgrade — a session from last week answers a
 * surface from today with last week's answers — and until now the only
 * way to move it on was to find its pid by hand.
 *
 * @param stateDir - Where the state directory is.
 * @param who - The session's berth key, its identity (`user@cube`), or the
 *   user alone when one session carries that user.
 */
async function session_end(stateDir: string, who: string): Promise<void> {
  const host: ProcessHost = new ProcessHost({ stateDir, chellEntry: process.env['PORTER_CHELL'] ?? chellEntry_locate() });
  const sightings: SessionSighting[] = await host.sessions_adopt();
  const matches: SessionSighting[] = sightings.filter((sighting: SessionSighting): boolean =>
    sighting.identity === who || berthKey_compute(sighting.identity) === who || sighting.identity.startsWith(`${who}@`));
  if (matches.length === 0) {
    console.error(`[!] no session for ${who}; 'porter --status' lists them`);
    process.exit(1);
  }
  if (matches.length > 1) {
    console.error(`[!] ${who} names ${matches.length} sessions; use the berth key:`);
    for (const sighting of matches) console.error(`    ${berthKey_compute(sighting.identity)}  ${sighting.identity}`);
    process.exit(1);
  }
  const target: SessionSighting = matches[0] as SessionSighting;
  if (!target.alive) {
    console.log(`${berthKey_compute(target.identity)}  gone already  ${target.identity}`);
    return;
  }
  const ended: boolean = await host.evict(target.identity);
  console.log(`${berthKey_compute(target.identity)}  ${ended ? 'ended' : 'could not be ended'}  ${target.identity}${target.berth.pid !== undefined ? `  pid ${target.berth.pid}` : ''}`);
  if (ended) console.log('    state kept; the next login boots a fresh session on this porter\'s kernel');
}

async function porter_start(): Promise<void> {
  if (process.argv.includes('--status')) {
    await status_print(porterStateDir_resolve(process.env));
    return;
  }
  const endAt: number = process.argv.indexOf('--end');
  if (endAt >= 0) {
    const who: string | undefined = process.argv[endAt + 1];
    if (who === undefined || who.startsWith('--')) {
      console.error('[!] porter --end <berth key | user | user@cube>');
      process.exit(1);
    }
    await session_end(porterStateDir_resolve(process.env), who);
    return;
  }
  let config: PorterConfig;
  try {
    config = porterConfig_resolve(process.env);
  } catch (error: unknown) {
    console.error(`[!] ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
  const host: ProcessHost = new ProcessHost({ stateDir: config.stateDir, chellEntry: config.chellEntry });
  const sweepText: string | undefined = process.env['PORTER_SWEEP_SECONDS'];
  const built: PorterApp = await porterApp_build({
    config,
    host,
    logger: false,
    log: (line: string): void => { console.log(`[+] ${line}`); },
    // Not documented: the sweep's cadence only matters to a test of it.
    ...(sweepText !== undefined && Number(sweepText) > 0 ? { sweepMs: Number(sweepText) * 1000 } : {}),
  });
  await built.app.listen({ host: config.host, port: config.port });
  console.log(`[+] PORTER at http://${config.host}:${config.port}/ for ${config.cubeUrl}`);
  console.log(`    state:  ${config.stateDir}`);
  console.log(`    chell:  ${config.chellEntry}`);
  console.log(`    idle:   sessions end after ${config.idleHours} h with nobody on them; their state directories stay`);
  if (config.secretGenerated) {
    console.log('    secret: made up for this run — set PORTER_SECRET so a restart does not ask every browser again');
  }
  const stop = async (): Promise<void> => {
    await built.app.close();
    process.exit(0);
  };
  process.once('SIGINT', (): void => { void stop(); });
  process.once('SIGTERM', (): void => { void stop(); });
}

void porter_start();
