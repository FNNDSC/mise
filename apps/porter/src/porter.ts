#!/usr/bin/env node
/**
 * @file The `porter` entry: the mise display manager.
 *
 * Reads its configuration from the environment, stands a process host on
 * this machine, and listens. `porter --status` lists the sessions a running
 * porter's state directory holds.
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
    console.log(`${berthKey_compute(sighting.identity)}  ${state.padEnd(9)}  ${sighting.berth.url.padEnd(24)}  ${sighting.identity}${sighting.berth.pid !== undefined ? `  pid ${sighting.berth.pid}` : ''}`);
  }
}

async function porter_start(): Promise<void> {
  if (process.argv.includes('--status')) {
    await status_print(porterStateDir_resolve(process.env));
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
