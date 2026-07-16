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
import chalk from 'chalk';
import { CalypsoDaemon } from './server.js';
import { token_generate } from './token.js';
import type { BrasaEngine } from '@fnndsc/brasa';
import { sink_set, type OutputSink } from '@fnndsc/brasa';
import type { ProgressEvent } from '@fnndsc/brasa';
import { surface_set, type Surface, type PromptRequest, type LocalEditRequest, type LocalEditResult } from '@fnndsc/brasa';
import { sessionPromptContext_build, type SessionPromptContext } from '@fnndsc/brasa';
import { chrisContext } from '@fnndsc/cumin';
import { identity_forSession, berth_write, berth_read, berth_path, berthUrl_isAlive, DISCONNECTED_IDENTITY, type Berth } from './berth.js';

/** The daemon sink forwards live command output to the executing surface. */
class DaemonSink implements OutputSink {
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
  const daemon: CalypsoDaemon = new CalypsoDaemon({
    engine,
    token,
    host: '127.0.0.1',
    port: 0,
    // Only the daemon holds the session context, so it renders the themed
    // prompt and pushes it to surfaces.
    promptProvider: (): Promise<SessionPromptContext> => sessionPromptContext_build(),
  });
  sink_set(new DaemonSink(daemon));

  // Interactivity is a surface capability: a builtin that prompts, or a
  // pipeline segment, reaches the surface running the command through the
  // daemon's brokers, over the wire, without knowing the transport — and
  // nothing ever spawns on the daemon host.
  const surface: Surface = {
    capabilities: { hiddenInput: true, localEdit: true, tty: true, pipeSegments: true },
    prompt: (request: PromptRequest): Promise<string> =>
      daemon.prompt_current(request.message, request.hidden ?? false),
    pipeSegment: (command: string, input: Buffer): Promise<Buffer> =>
      daemon.pipe_current(command, input),
    localEdit: (request: LocalEditRequest): Promise<LocalEditResult> =>
      daemon.edit_current(request.content, request.extension),
  };
  surface_set(surface);

  const port: number = await daemon.start();
  const url: string = `ws://127.0.0.1:${port}`;
  const berth: Berth = { identity, url, token };
  berth_write(berth);

  const attachHint: string = identity === DISCONNECTED_IDENTITY ? '' : ` ${identity}`;
  console.log(chalk.green(`[+] CALYPSO daemon listening on ${url}`));
  console.log(chalk.gray(`    identity:  ${identity}`));
  console.log(chalk.gray(`    token:     ${token}`));
  console.log(chalk.gray(`    berth:     ${berth_path(identity)}`));
  console.log(chalk.gray(`    attach a surface with:  chell --remote${attachHint}`));
}
