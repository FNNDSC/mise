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

/** What the command line asks for. */
export type PorterAsk =
  | { mode: 'serve' }
  | { mode: 'status' }
  | { mode: 'end'; who: string }
  | { mode: 'help' };

/** The usage, one line per word the entry takes. */
export const PORTER_USAGE: string = [
  'porter                      serve the door (PORTER_CUBE_URL, PORTER_PORT, … from the environment)',
  'porter --status             the sessions this porter carries (--sessions says the same)',
  'porter --end <who>          end one session: its berth key, user, or user@cube',
  'porter --help               this',
].join('\n');

/**
 * Reads the command line. A word the entry does not know is refused by
 * name: left to fall through it once started a second door that adopted
 * the live sessions before dying on the port.
 *
 * @param argv - The words after the entry (process.argv.slice(2)).
 * @returns What was asked, or the refusal.
 */
export function porterArgs_parse(argv: ReadonlyArray<string>): PorterAsk | { refusal: string } {
  if (argv.length === 0) return { mode: 'serve' };
  const [word, ...rest] = argv;
  if (word === '--help' || word === '-h') return { mode: 'help' };
  if (word === '--status' || word === '--sessions') {
    return rest.length === 0 ? { mode: 'status' } : { refusal: `${word} takes no argument ('${rest[0] ?? ''}')` };
  }
  if (word === '--end') {
    const who: string | undefined = rest[0];
    if (who === undefined || who.startsWith('--')) return { refusal: '--end wants <berth key | user | user@cube>' };
    if (rest.length > 1) return { refusal: `--end takes one name ('${rest[1] ?? ''}' is extra)` };
    return { mode: 'end', who };
  }
  return { refusal: `unknown word '${word ?? ''}'` };
}

async function porter_start(): Promise<void> {
  const ask: PorterAsk | { refusal: string } = porterArgs_parse(process.argv.slice(2));
  if ('refusal' in ask) {
    console.error(`[!] porter: ${ask.refusal}\n${PORTER_USAGE}`);
    process.exit(1);
  }
  if (ask.mode === 'help') { console.log(PORTER_USAGE); return; }
  if (ask.mode === 'status') { await status_print(porterStateDir_resolve(process.env)); return; }
  if (ask.mode === 'end') { await session_end(porterStateDir_resolve(process.env), ask.who); return; }
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
  // The port first, the sessions after: a porter that cannot hold its door
  // has no business claiming what the one holding it carries.
  await built.adopt();
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

if (process.argv[1] !== undefined && /\/porter\.js$/.test(process.argv[1])) void porter_start();
