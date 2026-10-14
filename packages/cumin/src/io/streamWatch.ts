/**
 * @file A watchdog over a byte stream: it fails the stream, with a reason,
 * when no byte has arrived for a while.
 *
 * A large CUBE file is slow before its first byte (measured 15 to 20 s on
 * a 3.7 GB DICOM) and slow after it (about 300 KB/s), so any fixed
 * deadline on the whole transfer either kills a healthy download or never
 * fires. What is worth failing is silence: a transfer that has stopped
 * moving. The watchdog measures exactly that and names it.
 *
 * @module
 */
import { PassThrough, type Readable } from 'node:stream';

/** How long a CUBE file stream may stay silent before it is failed. */
export const STREAM_STALL_MS: number = 120_000;

/**
 * Passes a stream through unchanged and fails it when it falls silent.
 *
 * The clock starts at once (the wait for the first byte counts) and is
 * reset by every chunk. When it runs out, the source is destroyed and the
 * returned stream errors with a sentence that says how long nothing came
 * and how much had come before.
 *
 * @param source - The stream to watch.
 * @param stallMs - Silence allowed before the stream is failed.
 * @param what - What is being transferred, for the error (`file 30916964`).
 * @returns The watched stream.
 */
export function stream_watchStalls(source: Readable, stallMs: number, what: string): Readable {
  const watched: PassThrough = new PassThrough();
  let received: number = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const clock_reset = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout((): void => {
      const seconds: number = Math.round(stallMs / 1000);
      const error: Error = new Error(
        received === 0
          ? `CUBE sent no bytes of ${what} for ${seconds} s`
          : `CUBE stopped sending ${what} after ${received} bytes (nothing for ${seconds} s)`,
      );
      source.destroy(error);
      watched.destroy(error);
    }, stallMs);
    timer.unref?.();
  };
  const clock_stop = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  clock_reset();
  source.on('data', (chunk: Buffer): void => {
    received += chunk.length;
    clock_reset();
  });
  source.on('end', clock_stop);
  source.on('error', (error: Error): void => {
    clock_stop();
    watched.destroy(error);
  });
  watched.on('close', clock_stop);
  source.pipe(watched);
  return watched;
}
