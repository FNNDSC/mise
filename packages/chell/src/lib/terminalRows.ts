/**
 * @file Counts the screen rows a terminal has scrolled through.
 *
 * A readout that rewrites one of its earlier rows in place must know how
 * many rows lie between that row and the cursor now, and rows are not
 * newlines: a line longer than the terminal wraps into several rows while
 * carrying one newline, and a spinner's carriage-return redraws carry none
 * while occupying columns. The counter reads every write to the terminal,
 * escapes stripped, and keeps the running row total and the column the
 * cursor stands in.
 *
 * @module
 */

/**
 * Matches every ANSI escape: colour, cursor movement, mode. None of them
 * occupies a column.
 */
const ESCAPE_PATTERN: RegExp = /\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\)|[@-Z\\-_])/g;

/** Save-cursor sequences: what follows, up to the restore, moves nothing. */
const SAVE_CURSOR: RegExp = /\x1b\[s|\x1b7/;
/** Restore-cursor sequences. */
const RESTORE_CURSOR: RegExp = /\x1b\[u|\x1b8/;

/** What the counter needs of the terminal: its width, read at each write. */
export interface RowTerminal {
  columns?: number;
}

/** A running count of rows scrolled and the cursor's column. */
export class RowCounter {
  private total: number = 0;
  private column: number = 0;
  private saved: { total: number; column: number } | null = null;

  /**
   * @param terminal - The terminal whose width wraps lines.
   */
  public constructor(private readonly terminal: RowTerminal) {}

  /**
   * Absorbs one write.
   *
   * A newline ends a row; a carriage return returns to column zero on the
   * same row (a spinner frame, a progress redraw), so what preceded it on
   * the row no longer counts toward wrapping. A save-cursor puts a mark
   * down and a restore-cursor returns to it, so a repaint that saves, moves
   * up, paints, and restores nets to nothing — as it does on the screen.
   *
   * @param text - The text written, escapes included.
   * @returns The rows this write scrolled, net of any restore.
   */
  public count(text: string): number {
    const before: number = this.total;
    if (SAVE_CURSOR.test(text)) this.saved = { total: this.total, column: this.column };
    const columns: number = this.terminal.columns || 80;
    const lines: string[] = text.replace(ESCAPE_PATTERN, '').split('\n');
    lines.forEach((line: string, index: number): void => {
      const parts: string[] = line.split('\r');
      // Text before a carriage return is overwritten in place; only the
      // last part still stands on the row.
      if (parts.length > 1) this.column = 0;
      const width: number = this.column + (parts[parts.length - 1] ?? '').length;
      if (index < lines.length - 1) {
        this.total += Math.max(1, Math.ceil(width / columns));
        this.column = 0;
      } else {
        this.total += Math.floor(width / columns);
        this.column = width % columns;
      }
    });
    if (RESTORE_CURSOR.test(text) && this.saved !== null) {
      this.total = this.saved.total;
      this.column = this.saved.column;
      this.saved = null;
    }
    return this.total - before;
  }

  /** Rows scrolled since the counter started, or was last reset. */
  public rows_get(): number {
    return this.total;
  }

  /** The column the cursor stands in on the current row. */
  public column_get(): number {
    return this.column;
  }

  /** Starts the count over, at column zero. */
  public reset(): void {
    this.total = 0;
    this.column = 0;
    this.saved = null;
  }
}

/** A write's completion callback, as the stream API passes it. */
type WriteCallback = (error?: Error | null) => void;

/** What hooking needs of the stream: a write to wrap and a width. */
export interface RowStream extends RowTerminal {
  write(chunk: string | Uint8Array, callback?: WriteCallback): boolean;
  write(chunk: string | Uint8Array, encoding?: BufferEncoding, callback?: WriteCallback): boolean;
}

/** A stream hooked to a counter, with a way past the hook. */
export interface StreamRows {
  counter: RowCounter;
  /** Writes without counting, for a write the counter must not see. */
  write_raw: (text: string) => void;
  /** Unhooks the stream. */
  stop: () => void;
}

/**
 * Hooks a stream's write so every write is counted before it lands.
 *
 * @param stream - The stream; `process.stdout` in a running shell.
 * @param counter - The counter to feed; a fresh one by default. Several
 *   streams sharing one terminal share one counter.
 * @returns The counter, a raw writer past the hook, and a stop.
 */
export function streamRows_track(stream: RowStream, counter: RowCounter = new RowCounter(stream)): StreamRows {
  const original: RowStream['write'] = stream.write;
  const counting = (
    chunk: string | Uint8Array,
    encodingOrCallback?: BufferEncoding | WriteCallback,
    callback?: WriteCallback,
  ): boolean => {
    counter.count(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
    const encoding: BufferEncoding | undefined = typeof encodingOrCallback === 'string' ? encodingOrCallback : undefined;
    const done: WriteCallback | undefined = typeof encodingOrCallback === 'function' ? encodingOrCallback : callback;
    return original.call(stream, chunk, encoding, done);
  };
  stream.write = counting;
  return {
    counter,
    write_raw: (text: string): void => { original.call(stream, text, undefined, undefined); },
    stop: (): void => {
      if (stream.write === counting) stream.write = original;
    },
  };
}

/**
 * The one row tracker over `process.stdout`, shared by everything that
 * scrolls the boot screen — the brain animation and the boot readout —
 * so they agree on how far the screen has moved and neither installs a
 * second `write` hook that would double-count the other.
 */
let sharedStdout: StreamRows | null = null;

/**
 * Ensures the shared `process.stdout` tracker is installed, and returns it.
 *
 * Idempotent: the first caller installs it, the rest get the same one.
 *
 * @returns The shared tracker.
 */
export function stdoutRows_ensure(): StreamRows {
  if (sharedStdout === null) sharedStdout = streamRows_track(process.stdout);
  return sharedStdout;
}

/**
 * The shared `process.stdout` tracker, if one is installed.
 *
 * @returns The tracker, or null when nothing is tracking stdout.
 */
export function stdoutRows_current(): StreamRows | null {
  return sharedStdout;
}

/** Uninstalls the shared `process.stdout` tracker, if one is installed. */
export function stdoutRows_release(): void {
  if (sharedStdout !== null) {
    sharedStdout.stop();
    sharedStdout = null;
  }
}
