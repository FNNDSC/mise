/**
 * @file Keeps a stray write from landing across an idle prompt.
 *
 * A REPL waiting at its prompt shares the terminal with everything else
 * the process writes: another surface's output pushed by the daemon, a
 * warm-up settling late, a roster row. Written raw, such a line lands on
 * the prompt line and the prompt is gone until the next keystroke. While
 * the guard is engaged, a stray write clears the prompt line, lands on a
 * line of its own, and the prompt is redrawn beneath it with whatever was
 * typed still in place.
 *
 * readline draws through an output whose write bypasses the guard, so the
 * prompt's own paint is never mistaken for a stray line.
 *
 * @module
 */

/** A write's completion callback, as the stream API passes it. */
type WriteCallback = (error?: Error | null) => void;

/** What the guard needs of the terminal: a write it can wrap and a TTY flag. */
export interface GuardedStream {
  write(chunk: string | Uint8Array, callback?: WriteCallback): boolean;
  write(chunk: string | Uint8Array, encoding?: BufferEncoding, callback?: WriteCallback): boolean;
  isTTY?: boolean;
}

/** A prompt guard around one output stream. */
export interface PromptGuard<S extends GuardedStream = GuardedStream> {
  /** The stream readline should draw on: its write is never guarded. */
  readonly output: S;
  /** Route stray writes above the prompt; call once the prompt is drawn. */
  engage(): void;
  /** Let writes flow raw; call before a command's output starts. */
  release(): void;
  /** Write as the terminal's own, whether or not the guard is engaged. */
  write(text: string): void;
}

/**
 * Creates a prompt guard around a stream.
 *
 * @param stream - The terminal stream; `process.stdout` in a running shell.
 * @param redraw - Repaints the prompt and the line typed so far.
 * @returns The guard.
 */
export function promptGuard_create<S extends GuardedStream>(stream: S, redraw: () => void): PromptGuard<S> {
  const original: GuardedStream['write'] = stream.write;
  const realWrite = (
    chunk: string | Uint8Array,
    encodingOrCallback?: BufferEncoding | WriteCallback,
    callback?: WriteCallback,
  ): boolean => {
    // Normalised to the three-argument form: the stream takes an undefined
    // encoding as its default, and the callback lands where it belongs.
    const encoding: BufferEncoding | undefined = typeof encodingOrCallback === 'string' ? encodingOrCallback : undefined;
    const done: WriteCallback | undefined = typeof encodingOrCallback === 'function' ? encodingOrCallback : callback;
    return original.call(stream, chunk, encoding, done);
  };
  let engaged: boolean = false;

  const strayWrite = (
    chunk: string | Uint8Array,
    encodingOrCallback?: BufferEncoding | WriteCallback,
    callback?: WriteCallback,
  ): boolean => {
    const text: string = typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
    const done: WriteCallback | undefined = typeof encodingOrCallback === 'function' ? encodingOrCallback : callback;
    if (stream.isTTY === true) realWrite('\r\x1b[2K');
    realWrite(text.endsWith('\n') ? text : `${text}\n`);
    redraw();
    done?.();
    return true;
  };

  const output: S = new Proxy(stream, {
    get(target: S, property: string | symbol, receiver: unknown): unknown {
      if (property === 'write') return realWrite;
      const value: unknown = Reflect.get(target, property, receiver);
      return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    },
  });

  return {
    output,
    engage(): void {
      if (engaged) return;
      engaged = true;
      stream.write = strayWrite;
    },
    release(): void {
      if (!engaged) return;
      engaged = false;
      stream.write = original;
    },
    write(text: string): void {
      realWrite(text);
    },
  };
}
