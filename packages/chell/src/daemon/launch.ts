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
import { CalypsoDaemon, token_generate } from '@fnndsc/calypso';
import type { ChellEngine } from '../core/engine.js';
import { sink_set, type OutputSink } from '../core/sink.js';
import type { ProgressEvent } from '../core/progress.js';
import { surface_set, type Surface, type PromptRequest, type LocalEditRequest, type LocalEditResult } from '../core/surface.js';
import { sessionPrompt_render } from '../core/prompt/session.js';
import { discovery_write, discovery_path } from '../remote/discovery.js';

/** The daemon sink forwards live command output to the executing surface. */
class DaemonSink implements OutputSink {
  public readonly liveEnvelopeOutput = true;

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
 * @returns A promise that resolves once the daemon is listening; the process
 *   then stays alive on the WebSocket server.
 */
export async function daemon_launch(engine: ChellEngine): Promise<void> {
  // Force color into the engine's rendered text: no TTY here to auto-detect.
  if (chalk.level < 1) {
    chalk.level = 3;
  }
  const token: string = token_generate();
  const daemon: CalypsoDaemon = new CalypsoDaemon({
    engine,
    token,
    host: '127.0.0.1',
    port: 0,
    // Only the daemon holds the session context, so it renders the themed
    // prompt and pushes it to surfaces.
    promptProvider: (): Promise<string> => sessionPrompt_render(),
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
  discovery_write({ url, token });

  console.log(chalk.green(`[+] CALYPSO daemon listening on ${url}`));
  console.log(chalk.gray(`    token:     ${token}`));
  console.log(chalk.gray(`    discovery: ${discovery_path()}`));
  console.log(chalk.gray('    attach a surface with:  chell --remote'));
}
