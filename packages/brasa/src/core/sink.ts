/**
 * @file Output sink: the seam through which command output leaves the engine.
 *
 * Builtins historically printed straight to process stdout, which fuses the
 * engine to a terminal. The sink inverts that: output is written to whatever
 * sink the host installed, and only the host knows where bytes finally go
 * (a terminal for the CLI REPL, a capture buffer for pipes, a connection for
 * a remote surface).
 *
 * Three channels are distinguished. Data is the command's actual output: it
 * is accumulated into the command's result envelope and is what capture,
 * piping and redirection consume. Err is the error stream: presented to the
 * user, never piped, never captured. Status is ephemeral (spinners,
 * progress, transient messages): displayed live, never accumulated, never
 * piped.
 *
 * This module also provides delivery helpers that bridge envelope-returning
 * builtins into the existing dispatch table, so conversion can proceed one
 * builtin at a time while unconverted builtins keep printing.
 *
 * @see docs/calypso.adoc for the governing design.
 * @module
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import type { CommandEnvelope } from '@fnndsc/cumin';
import { type ProgressEvent, type ProgressRenderer, NullProgressRenderer } from './progress.js';

/**
 * Destination for command output, installed by the host.
 */
export interface OutputSink {
  /**
   * Writes command output (the data channel).
   *
   * @param chunk - Printable text (ANSI permitted) or raw bytes.
   */
  data_write(chunk: string | Buffer): void;

  /**
   * Writes error-stream output (the err channel).
   *
   * @param chunk - Printable text (ANSI permitted) or raw bytes.
   */
  err_write(chunk: string | Buffer): void;

  /**
   * Writes an ephemeral status line (the status channel).
   *
   * @param text - Transient text; consumers may overwrite or drop it.
   */
  status_write(text: string): void;

  progress_write(event: ProgressEvent): void;
}

/** Optional marker for hosts that stream captured envelope output live. */
interface LiveEnvelopeOutputSink extends OutputSink {
  liveEnvelopeOutput: true;
}

function sink_streamsEnvelopeOutput(sink: OutputSink): sink is LiveEnvelopeOutputSink {
  return (sink as { liveEnvelopeOutput?: unknown }).liveEnvelopeOutput === true;
}

/**
 * Sink that writes both channels to the process's standard output.
 *
 * This is the CLI host's sink and the default, preserving the shell's
 * historical behavior exactly.
 */
export class StdoutSink implements OutputSink {
  private readonly progressRenderer: ProgressRenderer;

  constructor(progressRenderer: ProgressRenderer = new NullProgressRenderer()) {
    this.progressRenderer = progressRenderer;
  }

  /** @inheritdoc */
  public data_write(chunk: string | Buffer): void {
    process.stdout.write(chunk);
  }

  /** @inheritdoc */
  public err_write(chunk: string | Buffer): void {
    process.stderr.write(chunk);
  }

  /** @inheritdoc */
  public status_write(text: string): void {
    process.stdout.write(text);
  }

  public progress_write(event: ProgressEvent): void {
    this.progressRenderer.write(event);
  }
}

/**
 * Sink that accumulates the data channel in memory and drops status.
 *
 * Used by capture paths and tests; will carry the pipe and redirect
 * machinery once those consume envelopes.
 */
export class BufferSink implements OutputSink {
  private chunks: Buffer[] = [];

  /** @inheritdoc */
  public data_write(chunk: string | Buffer): void {
    this.chunks.push(typeof chunk === 'string' ? Buffer.from(chunk, 'utf-8') : chunk);
  }

  /** @inheritdoc */
  public err_write(chunk: string | Buffer): void {
    // The err channel is never captured: today's pipe and redirect paths
    // inherit stderr, so error output must keep reaching the terminal even
    // while data is being buffered.
    process.stderr.write(chunk);
  }

  /** @inheritdoc */
  public status_write(_text: string): void {
    // Status is ephemeral by contract: never accumulated.
  }

  public progress_write(_event: ProgressEvent): void {
    // Progress is ephemeral by contract: never accumulated.
  }

  /**
   * Returns everything written to the data channel so far.
   *
   * @returns The accumulated bytes.
   */
  public buffer_get(): Buffer {
    return Buffer.concat(this.chunks);
  }

  /**
   * Returns the accumulated data channel as UTF-8 text.
   *
   * @returns The accumulated text.
   */
  public text_get(): string {
    return this.buffer_get().toString('utf-8');
  }
}

/**
 * Sink that captures the data and err channels while passing status through
 * to a live sink, so transients (spinners, progress) remain visible while a
 * legacy printing command's output is being gathered into an envelope.
 */
export class CaptureSink implements OutputSink {
  private dataChunks: Buffer[] = [];
  private errChunks: Buffer[] = [];
  private live: OutputSink;
  private readonly forwardEnvelopeOutput: boolean;

  /**
   * Initializes the capture around a live sink for status passthrough.
   *
   * @param live - The sink that continues to receive status writes.
   */
  constructor(live: OutputSink, options: { forwardEnvelopeOutput?: boolean } = {}) {
    this.live = live;
    this.forwardEnvelopeOutput = options.forwardEnvelopeOutput ?? false;
  }

  /** @inheritdoc */
  public data_write(chunk: string | Buffer): void {
    this.dataChunks.push(typeof chunk === 'string' ? Buffer.from(chunk, 'utf-8') : chunk);
    if (this.forwardEnvelopeOutput) {
      this.live.data_write(chunk);
    }
  }

  /** @inheritdoc */
  public err_write(chunk: string | Buffer): void {
    this.errChunks.push(typeof chunk === 'string' ? Buffer.from(chunk, 'utf-8') : chunk);
    if (this.forwardEnvelopeOutput) {
      this.live.err_write(chunk);
    }
  }

  /** @inheritdoc */
  public status_write(text: string): void {
    this.live.status_write(text);
  }

  public progress_write(event: ProgressEvent): void {
    this.live.progress_write(event);
  }

  /**
   * Returns the captured data channel as UTF-8 text.
   *
   * @returns The captured data text.
   */
  public dataText_get(): string {
    return Buffer.concat(this.dataChunks).toString('utf-8');
  }

  /**
   * Returns the captured err channel as UTF-8 text.
   *
   * @returns The captured error-stream text.
   */
  public errText_get(): string {
    return Buffer.concat(this.errChunks).toString('utf-8');
  }
}

/**
 * The host sink: the process-wide default installed by whoever owns the output
 * destination (the CLI REPL, the daemon). Defaults to stdout so every entry
 * point behaves as the CLI always has.
 */
let hostSink: OutputSink = new StdoutSink();

/**
 * Per-invocation sink scope.
 *
 * A captured command runs inside {@link AsyncLocalStorage#run}, so its sink
 * follows the async call chain and is isolated from any other command running
 * concurrently in the same process. Outside a scope the store is undefined and
 * the host sink applies. This is what lets one process host several sessions
 * at once without their output stomping a shared global.
 */
const sinkScope: AsyncLocalStorage<OutputSink> = new AsyncLocalStorage<OutputSink>();

/**
 * Returns the sink in effect for the current async context.
 *
 * Inside a captured command this is that command's capture sink; otherwise it
 * is the host sink.
 *
 * @returns The active output sink.
 */
export function sink_get(): OutputSink {
  return sinkScope.getStore() ?? hostSink;
}

/**
 * Installs the host sink. Called by the host that owns the output destination.
 *
 * This sets the process-wide default, not the per-invocation scope, so a host
 * installs it once at startup. Capture scopes established during command
 * execution take precedence over it via {@link sink_get}.
 *
 * @param sink - The sink to install.
 * @returns The previously installed host sink, so callers can restore it.
 */
export function sink_set(sink: OutputSink): OutputSink {
  const previous: OutputSink = hostSink;
  hostSink = sink;
  return previous;
}

/**
 * Delivers a completed envelope to the active sink.
 *
 * Rendered text goes to the data channel and error-stream text to the err
 * channel. The structured errors field is machine-facing and is not
 * presented here: its terminal presentation, when any, travels in
 * renderedErr.
 *
 * @param envelope - The completed command envelope.
 */
export function envelope_deliver(envelope: CommandEnvelope): void {
  const sink: OutputSink = sink_get();
  if (envelope.rendered.length > 0) {
    sink.data_write(envelope.rendered);
  }
  if (envelope.renderedErr !== undefined && envelope.renderedErr.length > 0) {
    sink.err_write(envelope.renderedErr);
  }
}

/**
 * Adapts an envelope-returning builtin to the legacy printing handler shape.
 *
 * This is the compatibility bridge for incremental conversion: converted
 * builtins return envelopes, and this wrapper delivers them through the
 * active sink so the dispatch table, pipes and redirects need no changes.
 * A handler that resolves without an envelope (as stubbed handlers in tests
 * do) is treated as having produced no output.
 *
 * @param handler - An envelope-returning command handler.
 * @returns A handler with the legacy void-returning shape.
 */
export function envelopeHandler_wrap(
  handler: (args: string[]) => Promise<CommandEnvelope>,
): (args: string[]) => Promise<void> {
  return async (args: string[]): Promise<void> => {
    const envelope: CommandEnvelope | undefined = await handler(args);
    if (!envelope) {
      return;
    }
    envelope_deliver(envelope);
  };
}

/**
 * Adapts a legacy printing builtin to the envelope-returning shape.
 *
 * This is the capture bridge for commands whose rendering lives below the
 * seam (chili's table display prints internally): the handler runs with the
 * data and err channels captured, console printing redirected into the
 * capture, and status passed through live so spinners stay visible. The
 * result is an envelope carrying the exact bytes each stream would have
 * shown, with the status derived from the process exit code the handler set.
 *
 * Bridged commands gain envelope semantics without typed models; native
 * conversion (models, streamed data) remains the end state for commands
 * where a structural consumer exists.
 *
 * @param handler - A legacy printing command handler.
 * @returns An envelope-returning handler with identical observable output.
 */
export function printingHandler_wrap(
  handler: (args: string[]) => Promise<void>,
): (args: string[]) => Promise<CommandEnvelope> {
  return async (args: string[]): Promise<CommandEnvelope> => {
    const live: OutputSink = sink_get();
    const capture: CaptureSink = new CaptureSink(live, {
      forwardEnvelopeOutput: sink_streamsEnvelopeOutput(live),
    });

    // The command's sink is scoped to this async context, so sink_get() (used
    // by spinners, progress and directly-writing builtins) resolves to this
    // capture without a shared global that concurrent commands would stomp.
    // The console/stdout redirect below remains per-invocation: removing it in
    // favour of envelope-returning builtins is tracked separately (#98).
    const originalLog: typeof console.log = console.log;
    const originalError: typeof console.error = console.error;
    const originalStdoutWrite: typeof process.stdout.write = process.stdout.write.bind(process.stdout);
    const exitCodeBefore: number = typeof process.exitCode === 'number' ? process.exitCode : 0;

    console.log = (...logArgs: unknown[]): void => {
      const text: string = logArgs
        .map((arg: unknown): string => (typeof arg === 'string' ? arg : JSON.stringify(arg)))
        .join(' ');
      capture.data_write(`${text}\n`);
    };
    console.error = (...logArgs: unknown[]): void => {
      const text: string = logArgs
        .map((arg: unknown): string => (typeof arg === 'string' ? arg : JSON.stringify(arg)))
        .join(' ');
      capture.err_write(`${text}\n`);
    };
    process.stdout.write = ((chunk: unknown): boolean => {
      if (typeof chunk === 'string' || Buffer.isBuffer(chunk)) {
        capture.data_write(chunk);
      } else if (chunk instanceof Uint8Array) {
        capture.data_write(Buffer.from(chunk));
      }
      return true;
    }) as typeof process.stdout.write;

    try {
      await sinkScope.run(capture, async (): Promise<void> => {
        await handler(args);
      });
    } finally {
      console.log = originalLog;
      console.error = originalError;
      process.stdout.write = originalStdoutWrite;
    }

    const exitCodeAfter: number = typeof process.exitCode === 'number' ? process.exitCode : 0;
    const failed: boolean = exitCodeAfter !== 0 && exitCodeAfter !== exitCodeBefore;
    const rendered: string = capture.dataText_get();
    const renderedErr: string = capture.errText_get();

    const envelope: CommandEnvelope = { status: failed ? 'error' : 'ok', rendered };
    if (renderedErr.length > 0) {
      envelope.renderedErr = renderedErr;
    }
    return envelope;
  };
}

/** Matches ANSI escape sequences (SGR colors, cursor movement, erase). */
const ANSI_PATTERN: RegExp = /\x1b\[[0-9;?]*[a-zA-Z]/g;

/**
 * Strips ANSI escape sequences from text.
 *
 * Applied at the pipe and redirect boundary so downstream consumers receive
 * plain text, the way programs behind a real shell pipe see no color. This
 * is a deliberate, documented deviation from the historical behavior, in
 * which escape bytes leaked into pipes because color detection saw the
 * terminal regardless of capture.
 *
 * @param text - Text possibly containing ANSI sequences.
 * @returns The text with all ANSI sequences removed.
 */
export function ansi_strip(text: string): string {
  return text.replace(ANSI_PATTERN, '');
}
