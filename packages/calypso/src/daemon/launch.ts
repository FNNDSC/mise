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
import { bundledWebRoot_find, webRoot_resolve } from './static.js';
import { token_generate } from './token.js';
import type { BrasaEngine } from '@fnndsc/brasa';
import { sink_set, type OutputSink } from '@fnndsc/brasa';
import type { ProgressEvent } from '@fnndsc/brasa';
import { surface_set, type Surface, type SurfaceCapabilities, type PromptRequest, type LocalEditRequest, type LocalEditResult } from '@fnndsc/brasa';
import type { FileDeliverRequest, FileDeliverResult } from '@fnndsc/menu';
import { procIndex_snapshot, sessionPromptContext_build, type SessionPromptContext } from '@fnndsc/brasa';
import { welcomeLine_build, versionReport_build, versions_get, buildHash_get, fortune_random } from '@fnndsc/brasa';
import { chrisContext } from '@fnndsc/cumin';
import { identity_forSession, berth_write, berth_read, berth_path, berthUrl_isAlive, DISCONNECTED_IDENTITY, type Berth } from './berth.js';
import { attachFile_write, attachFile_remove } from './attachFile.js';
import { HOST_CONTROL_OFF, hostControl_describe, hostControl_guard, hostControl_tiers, hostPipe_run, hostShell_run, type HostControlPolicy } from './hostControl.js';

/** What a launched daemon hands back to its host (the console face's feed). */
export interface DaemonLaunchInfo {
  /** The CUBE identity this daemon hosts. */
  identity: string;
  /** The WebSocket wire address. */
  url: string;
  /** The attach token gating every session. */
  token: string;
  /** The berth file advertising this daemon. */
  berthPath: string;
  /** The ARGUS web-surface address, when a bundle is served. */
  argusUrl: string | null;
  /** The running daemon, for live telemetry. */
  daemon: CalypsoDaemon;
  /** The declared host-control policy. */
  hostControl: HostControlPolicy;
  /** The bind address, for the face's exposure line. */
  bindHost: string;
}

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
 * escapes, local editing and file delivery reach the surface running the
 * command through the daemon's brokers, without knowing the transport. Nothing
 * ever spawns on the daemon host, and nothing is ever written to its disk.
 *
 * @param daemon - The daemon whose brokers deliver the capability requests.
 * @returns The surface to install with `surface_set` on the daemon host.
 */
export function daemonSurface_create(daemon: CalypsoDaemon, policy: HostControlPolicy = HOST_CONTROL_OFF): Surface {
  return {
    // A daemon has no capabilities of its own to offer. Those that vary by
    // surface are read from whichever one is executing, as it declared them on
    // attach — a browser and a remote shell differ, and answering for both
    // would either archive a directory a shell wanted whole or hand a browser
    // a tree it cannot hold.
    get capabilities(): SurfaceCapabilities {
      const attached = daemon.capabilities_current();
      return {
        hiddenInput: true,
        localEdit: true,
        tty: true,
        pipeSegments: true,
        shellCommands: true,
        fileDelivery: attached?.fileDelivery ?? false,
        // The daemon's disk belongs to nobody attending this session — unless
        // the operator who started it declared otherwise with the `files`
        // tier of --host-control, in which case it is theirs by declaration.
        engineFilesystem: policy.tiers.has('files'),
        localFilesystem: attached?.localFilesystem ?? false,
      };
    },
    prompt: (request: PromptRequest): Promise<string> =>
      daemon.prompt_current({
        message: request.message,
        hidden: request.hidden ?? false,
        ...(request.wants === undefined ? {} : { wants: request.wants }),
        ...(request.path === undefined ? {} : { path: request.path }),
        ...(request.commit === undefined ? {} : { commit: request.commit }),
      }),
    // Under host control the host wins: the segment or the shell runs here,
    // output on the session bus like any command's. Otherwise both relay to
    // the surface that typed them.
    pipeSegment: (command: string, input: Buffer): Promise<Buffer> =>
      policy.tiers.has('pipes') ? hostPipe_run(command, input) : daemon.pipe_current(command, input),
    shellCommand: (command: string): Promise<number> =>
      policy.tiers.has('shell')
        ? hostShell_run(command, (channel: 'data' | 'err', chunk: string): void => { daemon.output_current(channel, chunk); })
        : daemon.shell_current(command),
    localEdit: (request: LocalEditRequest): Promise<LocalEditResult> =>
      daemon.edit_current(request.content, request.extension),
    fileDeliver: (request: FileDeliverRequest): Promise<FileDeliverResult> =>
      daemon.deliver_current(request),
  };
}

/**
 * Starts the daemon over an engine and advertises it for same-user discovery.
 *
 * @param engine - The engine to host (already created and connected by boot).
 * @param beforeListen - Optional host preparation run after the duplicate guard
 *   and before the socket binds or the berth is published.
 * @returns The launched daemon's addresses and handle, once it is listening;
 *   the process then stays alive on the WebSocket server.
 */
/**
 * What a launcher decided beyond the engine.
 *
 * @property hostControl - The declared host-control policy (off by default).
 */
export interface DaemonLaunchOptions {
  hostControl?: HostControlPolicy;
}

export async function daemon_launch(
  engine: BrasaEngine,
  beforeListen?: () => Promise<void>,
  options: DaemonLaunchOptions = {},
): Promise<DaemonLaunchInfo> {
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
    console.error(chalk.red(`[!] Calypso is already running for ${identity} at ${existing.url}`));
    console.error(chalk.gray(`    attach with:  chell --remote${attachHint}`));
    process.exit(1);
  }

  if (beforeListen) {
    await beforeListen();
  }

  const token: string = token_generate();
  // The web surface (argus) is served from the same port as the wire when a
  // built bundle is found: an explicit CALYPSO_WEB_ROOT wins, then the working
  // directory, then the checkout enclosing this module — so a dev-tree
  // `chell --daemon` serves the surface from any directory, with no
  // configuration at all.
  const webRoot: string | null = webRoot_resolve([
    process.env['CALYPSO_WEB_ROOT'],
    path.join(process.cwd(), 'apps', 'argus', 'dist'),
    bundledWebRoot_find() ?? undefined,
  ]);
  // Loopback is the posture; CALYPSO_BIND is a deliberate, per-launch
  // opt-out for demos on a trusted network. The attach token still gates
  // every session, but the web bundle and the wire become reachable from
  // any host that can route here.
  const bindHost: string = process.env['CALYPSO_BIND'] ?? '127.0.0.1';
  const hostControl: HostControlPolicy = options.hostControl ?? HOST_CONTROL_OFF;
  const refusal: string | null = hostControl_guard(hostControl, bindHost);
  if (refusal !== null) {
    console.error(chalk.red(`[!] ${refusal}`));
    process.exit(1);
  }
  const daemon: CalypsoDaemon = new CalypsoDaemon({
    engine,
    token,
    host: bindHost,
    port: 0,
    ...(webRoot !== null ? { webRoot } : {}),
    // Only the daemon holds the session context, so it renders the themed
    // prompt and pushes it to surfaces.
    telemetryProvider: procIndex_snapshot,
    promptProvider: async (last): Promise<SessionPromptContext> => ({
      ...(await sessionPromptContext_build(
        last !== undefined
          ? { lastCommandDurationMs: last.durationMs, lastExitCode: last.exitCode }
          : {},
      )),
      ...(hostControl.tiers.size > 0 ? { hostControl: hostControl_tiers(hostControl) } : {}),
    }),
    // Report this process's own versions and build hash so attaching surfaces
    // greet with the daemon's truth rather than their local install's.
    stack: { ...versions_get(), build: buildHash_get() },
    hostControl: hostControl_tiers(hostControl),
  });
  sink_set(new DaemonSink(daemon));
  surface_set(daemonSurface_create(daemon, hostControl));

  const port: number = await daemon.start();
  // The berth records where this daemon can actually be reached. Loopback is
  // right for the ordinary case and wrong the moment CALYPSO_BIND opens the
  // wire to the network: a berth copied to another machine, or an address
  // pasted into `chell --remote --attach`, has to name a host that resolves
  // from somewhere else.
  const wireHost: string = bindHost === '0.0.0.0' ? hostname() : bindHost;
  const url: string = `ws://${wireHost}:${port}`;
  const berth: Berth = { identity, url, token };
  berth_write(berth);

  const attachHint: string = identity === DISCONNECTED_IDENTITY ? '' : ` ${identity}`;
  // The boot animation keeps repainting this terminal, and scrollback dies with
  // the next clear. The same addresses go to a file so they can be read back
  // without fighting either.
  const noteLines: string[] = [
    `identity:  ${identity}`,
    `wire:      ${url}`,
    `token:     ${token}`,
    ...(webRoot !== null
      ? [`ARGUS:     http://${bindHost === '0.0.0.0' ? hostname() : bindHost}:${port}/?token=${token}`]
      : []),
    `attach:    chell --remote --attach ${url} --token ${token}`,
    ...(hostControl.tiers.size > 0
      ? [`host control: ${hostControl_describe(hostControl)}${hostControl.exposed && bindHost !== '127.0.0.1' ? ` (EXPOSED on ${bindHost})` : ''}`]
      : []),
  ];
  const notePath: string | null = attachFile_write(noteLines);
  if (notePath !== null) {
    const cleanup = (): void => attachFile_remove();
    process.once('exit', cleanup);
    process.once('SIGINT', (): void => { cleanup(); process.exit(0); });
    process.once('SIGTERM', (): void => { cleanup(); process.exit(0); });
  }

  console.log(chalk.bold.cyan(welcomeLine_build('calypso')));
  for (const line of versionReport_build().split('\n')) {
    console.log(chalk.gray(`    ${line}`));
  }
  console.log(chalk.gray(fortune_random(4)));
  console.log(chalk.green(`[+] CALYPSO listening on ${url}`));
  if (hostControl.tiers.size > 0) {
    // Annunciated every launch: this daemon acts on its own host.
    console.log(chalk.yellow(`[!] HOST CONTROL: ${hostControl_describe(hostControl)} — \`!\`, pipes, and the disk are this host's`));
    if (hostControl.exposed && bindHost !== '127.0.0.1') {
      console.log(chalk.red(`[!] HOST CONTROL EXPOSED ON ${bindHost}: the attach URL is a shell on this host`));
    }
  }
  console.log(chalk.gray(`    identity:  ${identity}`));
  console.log(chalk.gray(`    token:     ${token}`));
  console.log(chalk.gray(`    berth:     ${berth_path(identity)}`));
  console.log(chalk.gray(`    attach a surface with:  chell --remote${attachHint}`));
  if (bindHost !== '127.0.0.1') {
    // Berth discovery is a file in this host's runtime directory, so it cannot
    // reach another machine. An explicit address is how a surface elsewhere
    // attaches, and it is worth printing ready to paste.
    console.log(chalk.gray(`    from another machine:   chell --remote --attach ${url} --token ${token}`));
  }
  if (webRoot !== null) {
    // A wildcard bind has no routable form for a URL; name the machine so
    // the printed address works from another host.
    const displayHost: string = bindHost === '0.0.0.0' ? hostname() : bindHost;
    console.log(chalk.green(`[+] ARGUS web surface at http://${displayHost}:${port}/?token=${token}`));
    console.log(chalk.gray(`    serving:   ${webRoot}`));
  }
  if (notePath !== null) {
    console.log(chalk.gray(`    these lines also in:  ${notePath}`));
    console.log(chalk.gray('    or run:               calypso --berths'));
  }

  const displayHost: string = bindHost === '0.0.0.0' ? hostname() : bindHost;
  return {
    identity,
    url,
    token,
    berthPath: berth_path(identity),
    argusUrl: webRoot !== null ? `http://${displayHost}:${port}/?token=${token}` : null,
    daemon,
    hostControl,
    bindHost,
  };
}
