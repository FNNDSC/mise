/**
 * @file Output sink: the seam through which command output leaves the engine.
 *
 * Builtins historically printed straight to process stdout, which fuses the
 * engine to a terminal. The sink inverts that: output is written to whatever
 * sink the host installed, and only the host knows where bytes finally go
 * (a terminal for the CLI REPL, a capture buffer for pipes, a connection for
 * a remote surface).
 *
 * Two channels are distinguished. Data is the command's actual output: it is
 * accumulated into the command's result envelope and is what capture, piping
 * and redirection consume. Status is ephemeral (spinners, progress,
 * transient messages): displayed live, never accumulated, never piped.
 *
 * This module also provides delivery helpers that bridge envelope-returning
 * builtins into the existing dispatch table, so conversion can proceed one
 * builtin at a time while unconverted builtins keep printing.
 *
 * @see docs/calypso.adoc for the governing design.
 * @module
 */

import chalk from 'chalk';
import type { CommandEnvelope, StackMessage } from '@fnndsc/cumin';

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
   * Writes an ephemeral status line (the status channel).
   *
   * @param text - Transient text; consumers may overwrite or drop it.
   */
  status_write(text: string): void;
}

/**
 * Sink that writes both channels to the process's standard output.
 *
 * This is the CLI host's sink and the default, preserving the shell's
 * historical behavior exactly.
 */
export class StdoutSink implements OutputSink {
  /** @inheritdoc */
  public data_write(chunk: string | Buffer): void {
    process.stdout.write(chunk);
  }

  /** @inheritdoc */
  public status_write(text: string): void {
    process.stdout.write(text);
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
  public status_write(_text: string): void {
    // Status is ephemeral by contract: never accumulated.
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

/** The active sink. Defaults to stdout so every entry point behaves as the CLI always has. */
let activeSink: OutputSink = new StdoutSink();

/**
 * Returns the currently installed sink.
 *
 * @returns The active output sink.
 */
export function sink_get(): OutputSink {
  return activeSink;
}

/**
 * Installs a sink. Called by the host that owns the output destination.
 *
 * @param sink - The sink to install.
 * @returns The previously installed sink, so callers can restore it.
 */
export function sink_set(sink: OutputSink): OutputSink {
  const previous: OutputSink = activeSink;
  activeSink = sink;
  return previous;
}

/**
 * Delivers a completed envelope to the active sink.
 *
 * Rendered text goes to the data channel; error detail is reported on the
 * process error stream in the shell's established style.
 *
 * @param envelope - The completed command envelope.
 */
export function envelope_deliver(envelope: CommandEnvelope): void {
  if (envelope.rendered.length > 0) {
    activeSink.data_write(envelope.rendered);
  }
  if (envelope.errors) {
    envelope.errors.forEach((entry: StackMessage): void => {
      console.error(chalk.red(entry.message));
    });
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
