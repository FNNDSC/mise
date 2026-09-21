/**
 * @file One line from a stream, for a secret that must not ride argv.
 *
 * A token on the command line is in `ps` for every user on the host; on
 * stdin it is seen by the one process it was written to. The reader takes
 * the first line and stops, so whatever the writer does with the stream
 * afterwards — close it, hold it open — does not matter here.
 *
 * @module
 */
import type { Readable } from 'node:stream';

/**
 * Reads the first line of a stream, without its line ending.
 *
 * @param input - The stream; `process.stdin` by default.
 * @returns The line, or null when the stream ends before one full line
 *   arrives — an empty stream, or a writer that closed without a newline.
 */
export function stdinLine_read(input: Readable = process.stdin): Promise<string | null> {
  return new Promise<string | null>((resolve: (line: string | null) => void): void => {
    let buffered: string = '';
    const cleanup = (): void => {
      input.off('data', onData);
      input.off('end', onEnd);
      input.off('error', onEnd);
      input.pause();
    };
    const onData = (chunk: Buffer | string): void => {
      buffered += chunk.toString();
      const newline: number = buffered.indexOf('\n');
      if (newline === -1) return;
      cleanup();
      resolve(buffered.slice(0, newline).replace(/\r$/, ''));
    };
    const onEnd = (): void => {
      cleanup();
      resolve(null);
    };
    input.on('data', onData);
    input.once('end', onEnd);
    input.once('error', onEnd);
    input.resume();
  });
}
