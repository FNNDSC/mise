/**
 * @file chili's output seam.
 *
 * chili historically printed straight to `console.log`/`console.error`, which
 * fused its command layer to a terminal and forced any in-process host (the
 * brasa engine, which drives chili headless) to capture output with a console
 * monkeypatch. This seam inverts that: command output is written to whatever
 * writer is installed, and by default that writer simply delegates to the
 * process console — so chili's standalone CLI behaves exactly as it always has.
 *
 * A host captures a run's output with {@link chili_capture}, which swaps in a
 * buffering writer for the duration of a call and returns the collected text.
 * This is explicit dependency injection through a module seam, not a runtime
 * override of the global `console`: the default writer calls `console.log`
 * normally, and capture bypasses the console entirely.
 *
 * @module
 */

import { format } from "util";

/**
 * Destination for chili's command output.
 */
export interface ChiliWriter {
  /**
   * Writes to the output channel with `console.log` semantics.
   *
   * @param args - The values to format, exactly as passed to `console.log`.
   */
  log(...args: unknown[]): void;

  /**
   * Writes to the error channel with `console.error` semantics.
   *
   * @param args - The values to format, exactly as passed to `console.error`.
   */
  errLog(...args: unknown[]): void;

  /**
   * Writes raw text or bytes to the output channel without adding a newline.
   *
   * @param chunk - The text or bytes to write.
   */
  write(chunk: string | Buffer): void;
}

/**
 * The default writer: delegates to the process console. Installed at import so
 * the standalone CLI prints exactly as before.
 */
const consoleWriter: ChiliWriter = {
  log: (...args: unknown[]): void => { console.log(...args); },
  errLog: (...args: unknown[]): void => { console.error(...args); },
  write: (chunk: string | Buffer): void => { process.stdout.write(chunk); },
};

/** The writer in effect. Swapped for the duration of a captured run. */
let activeWriter: ChiliWriter = consoleWriter;

/**
 * Installs a writer as the active output destination.
 *
 * @param writer - The writer to install.
 * @returns The previously installed writer, so callers can restore it.
 */
export function chiliWriter_set(writer: ChiliWriter): ChiliWriter {
  const previous: ChiliWriter = activeWriter;
  activeWriter = writer;
  return previous;
}

/**
 * Writes to the output channel with `console.log` semantics.
 *
 * @param args - The values to format, exactly as passed to `console.log`.
 */
export function chiliLog(...args: unknown[]): void {
  activeWriter.log(...args);
}

/**
 * Writes to the error channel with `console.error` semantics.
 *
 * @param args - The values to format, exactly as passed to `console.error`.
 */
export function chiliErrLog(...args: unknown[]): void {
  activeWriter.errLog(...args);
}

/**
 * Writes raw text or bytes to the output channel without adding a newline —
 * the replacement for direct `process.stdout.write` calls.
 *
 * @param chunk - The text or bytes to write.
 */
export function chiliWrite(chunk: string | Buffer): void {
  activeWriter.write(chunk);
}

/**
 * The text captured from a run, one string per channel.
 */
export interface ChiliCaptured {
  /** Everything written to the output channel. */
  out: string;
  /** Everything written to the error channel. */
  err: string;
}

/**
 * Runs `fn` with both channels captured into memory and returns the collected
 * text, restoring the previous writer afterwards even if `fn` throws.
 *
 * Formatting matches `console.log`: arguments are rendered with `util.format`
 * and each `log`/`errLog` call contributes a trailing newline, exactly as the
 * console would have written.
 *
 * @param fn - The work whose output should be captured.
 * @returns The captured output and error text.
 */
export async function chili_capture(fn: () => Promise<void>): Promise<ChiliCaptured> {
  const outChunks: string[] = [];
  const errChunks: string[] = [];
  const previous: ChiliWriter = chiliWriter_set({
    log: (...args: unknown[]): void => { outChunks.push(`${format(...args)}\n`); },
    errLog: (...args: unknown[]): void => { errChunks.push(`${format(...args)}\n`); },
    write: (chunk: string | Buffer): void => {
      outChunks.push(typeof chunk === "string" ? chunk : chunk.toString("utf-8"));
    },
  });
  try {
    await fn();
  } finally {
    chiliWriter_set(previous);
  }
  return { out: outChunks.join(""), err: errChunks.join("") };
}
