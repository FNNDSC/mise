/**
 * @file The engine seam the daemon hosts.
 *
 * The daemon is deliberately engine-agnostic: it accepts anything shaped like
 * a hosted engine rather than importing chell directly. This keeps calypso's
 * dependencies to cumin and the wire libraries, and — because chell will
 * import calypso's wire contract for its remote client — avoids a package
 * cycle. chell's `ChellEngine` structurally satisfies this interface, so the
 * launcher (in chell) creates a real engine and hands it to the daemon.
 *
 * @module
 */
import type { CommandEnvelope } from '@fnndsc/cumin';

/**
 * A completion answer: the candidates and the prefix they complete.
 *
 * @property candidates - The matching completion candidates.
 * @property prefix - The input prefix the candidates complete.
 */
export interface CompletionResult {
  candidates: string[];
  prefix: string;
}

/**
 * The engine the daemon drives. Matches chell's `ChellEngine` structurally,
 * so a real chell engine is assignable to it without calypso depending on
 * chell.
 */
export interface HostedEngine {
  /**
   * Executes one input line, yielding one envelope per executed command.
   *
   * @param line - The raw input line.
   * @returns The envelopes of the executed commands, in order.
   */
  line_execute(line: string): Promise<CommandEnvelope[]>;

  /**
   * Requests cancellation of the foreground command when it supports it.
   *
   * @returns True when the active command accepted the request.
   */
  line_cancel?(): boolean;

  /**
   * Computes completion candidates for a partial input line.
   *
   * @param linePrefix - The input line up to the cursor.
   * @returns The matching candidates and the prefix they complete.
   */
  line_complete(linePrefix: string): Promise<CompletionResult>;

  /**
   * Reads one ChRIS file's raw bytes, resolved against the session's
   * working directory. When the engine provides it, the daemon exposes a
   * token-gated `/vfs` HTTP route so browser surfaces can render file
   * content natively (images in a panel) instead of through the terminal
   * stream.
   *
   * @param filePath - The file's path (absolute or cwd-relative).
   * @returns The file's bytes.
   */
  file_read?(filePath: string): Promise<Buffer>;
}
