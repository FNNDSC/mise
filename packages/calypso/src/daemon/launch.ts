/**
 * @file The `chell --daemon` launcher.
 *
 * Hosts the already-created chell engine behind a CALYPSO daemon. Two host
 * concerns are handled here that the transport-agnostic daemon (in calypso)
 * cannot: color is forced on (a daemon has no TTY, so chalk would otherwise
 * strip it, and the rendered text must carry color for a remote terminal to
 * reproduce the local experience), and the engine's live sink output is
 * routed through the command's origin surface rather than rendered on the
 * daemon's own console.
 *
 * @module
 */
import { hostname } from 'node:os';
import * as path from 'node:path';
import chalk from 'chalk';
import { CalypsoDaemon } from './server.js';
import { webRoot_resolve } from './static.js';
import { token_generate } from './token.js';
import type { BrasaEngine } from '@fnndsc/brasa';
import { sink_set, type OutputSink } from '@fnndsc/brasa';
import type { ProgressEvent } from '@fnndsc/brasa';
import { surface_set, type Surface, type PromptRequest, type LocalEditRequest, type LocalEditResult } from '@fnndsc/brasa';
import { sessionPromptContext_build, type SessionPromptContext } from '@fnndsc/brasa';
import { welcomeLine_build, versionReport_build, versions_get, buildHash_get, fortune_random } from '@fnndsc/brasa';
import { chrisContext } from '@fnndsc/cumin';
import { identity_forSession, berth_write, berth_read, berth_path, berthUrl_isAlive, DISCONNECTED_IDENTITY, type Berth } from './berth.js';

/** The daemon sink forwards live command output to the executing surface. */
export class DaemonSink implements OutputSink {
  constructor(private readonly daemon: CalypsoDaemon) {}

  /** @inheritdoc */
  public data_write(chunk: string | Buffer): void { this.output_write('data', chunk); }
  /** @inheritdoc */
  public err_write(chunk: string | Buffer): void { this.output_write('err', chunk); }
  /** @inheritdoc */
  public status_write(text: string): void { this.daemon.output_current('status', text); }
  /** @inheritdoc */
  public progress_write(event: ProgressEvent): void { this.daemon.progress_current(event); }

  private output_write(channel: 'data' | 'err', chunk: string | Buffer): void {
    const text: string = typeof chunk === 'string' ? chunk : chunk.toString('utf-8');
    this.daemon.output_current(channel, text);
  }
}

/**
 * Builds the surface a daemon-hosted engine talks to.
 *
 * Interactivity is a surface capability: prompts, pipeline segments, shell
 * escapes, and local editing reach the surface running the command through
 * the daemon's brokers, without knowing the transport. Nothing ever spawns
 * on the daemon host.
 *
 * @param daemon - The daemon whose brokers deliver the capability requests.
 * @returns The surface to install with `surface_set` on the daemon host.
 */
export function daemonSurface_create(daemon: CalypsoDaemon): Surface {
  return {
    capabilities: {
      hiddenInput: true,
      localEdit: true,
      tty: true,
      pipeSegments: true,
      shellCommands: true,
    },
    prompt: (request: PromptRequest): Promise<string> =>
      daemon.prompt_current(request.message, request.hidden ?? false),
    pipeSegment: (command: string, input: Buffer): Promise<Buffer> =>
      daemon.pipe_current(command, input),
    shellCommand: (command: string): Promise<number> =>
      daemon.shell_current(command),
    localEdit: (request: LocalEditRequest): Promise<LocalEditResult> =>
      daemon.edit_current(request.content, request.extension),
  };
}

/**
 * Starts the daemon over an engine and advertises it for same-user discovery.
 *
 * @param engine - The engine to host (already created and connected by boot).
 * @param beforeListen - Optional host preparation run after the duplicate guard
 *   and before the socket binds or the berth is published.
 * @returns A promise that resolves once the daemon is listening; the process
 *   then stays alive on the WebSocket server.
 */
export async function daemon_launch(
  engine: BrasaEngine,
  beforeListen?: () => Promise<void>,
): Promise<void> {
  // Force color into the engine's rendered text: no TTY here to auto-detect.
  if (chalk.level < 1) {
    chalk.level = 3;
  }

  // Key the berth by the CUBE identity this daemon hosts, so several daemons —
  // one per identity — can advertise on one machine. A daemon with no restored
  // session (disconnected standalone start) falls back to a sentinel identity,
  // matching the disconnected prompt context, so it stays discoverable.
  const cubeUrl: string | null = await chrisContext.ChRISURL_get();
  const cubeUser: string | null = await chrisContext.ChRISuser_get();
  const identity: string = identity_forSession(cubeUser, cubeUrl);

  // Guard against a split-brain second daemon for this identity: if one is
  // already live, point the operator at it and refuse rather than host a rival
  // and orphan the running one's berth. This covers both launch paths (chell
  // --daemon and the standalone calypso binary), since both land here.
  const existing: Berth | null = berth_read(identity);
  if (existing && (await berthUrl_isAlive(existing.url))) {
    const attachHint: string = identity === DISCONNECTED_IDENTITY ? '' : ` ${identity}`;
    console.error(chalk.red(`[!] A CALYPSO daemon for ${identity} is already running at ${existing.url}`));
    console.error(chalk.gray(`    attach with:  chell --remote${attachHint}`));
    process.exit(1);
  }

  if (beforeListen) {
    await beforeListen();
  }

  const token: string = token_generate();
  // The web surface (argus) is served from the same port as the wire when a
  // built bundle is found: an explicit CALYPSO_WEB_ROOT wins, and a monorepo
  // checkout's bundle is picked up from the working directory so a dev-tree
  // `chell --daemon` serves the surface with no configuration at all.
  const webRoot: string | null = webRoot_resolve([
    process.env['CALYPSO_WEB_ROOT'],
    path.join(process.cwd(), 'apps', 'argus', 'dist'),
  ]);
  // Loopback is the posture; CALYPSO_BIND is a deliberate, per-launch
  // opt-out for demos on a trusted network. The attach token still gates
  // every session, but the web bundle and the wire become reachable from
  // any host that can route here.
  const bindHost: string = process.env['CALYPSO_BIND'] ?? '127.0.0.1';
  const daemon: CalypsoDaemon = new CalypsoDaemon({
    engine,
    token,
    host: bindHost,
    port: 0,
    ...(webRoot !== null ? { webRoot } : {}),
    // Only the daemon holds the session context, so it renders the themed
    // prompt and pushes it to surfaces.
    promptProvider: (): Promise<SessionPromptContext> => sessionPromptContext_build(),
    // Report this process's own versions and build hash so attaching surfaces
    // greet with the daemon's truth rather than their local install's.
    stack: { ...versions_get(), build: buildHash_get() },
  });
  sink_set(new DaemonSink(daemon));
  surface_set(daemonSurface_create(daemon));

  const port: number = await daemon.start();
  const url: string = `ws://127.0.0.1:${port}`;
  const berth: Berth = { identity, url, token };
  berth_write(berth);

  const attachHint: string = identity === DISCONNECTED_IDENTITY ? '' : ` ${identity}`;
  console.log(chalk.bold.cyan(welcomeLine_build('calypso')));
  for (const line of versionReport_build().split('\n')) {
    console.log(chalk.gray(`    ${line}`));
  }
  console.log(chalk.gray(fortune_random(4)));
  console.log(chalk.green(`[+] CALYPSO daemon listening on ${url}`));
  console.log(chalk.gray(`    identity:  ${identity}`));
  console.log(chalk.gray(`    token:     ${token}`));
  console.log(chalk.gray(`    berth:     ${berth_path(identity)}`));
  console.log(chalk.gray(`    attach a surface with:  chell --remote${attachHint}`));
  if (webRoot !== null) {
    // A wildcard bind has no routable form for a URL; name the machine so
    // the printed address works from another host.
    const displayHost: string = bindHost === '0.0.0.0' ? hostname() : bindHost;
    console.log(chalk.green(`[+] ARGUS web surface at http://${displayHost}:${port}/?token=${token}`));
    console.log(chalk.gray(`    serving:   ${webRoot}`));
  }
}
