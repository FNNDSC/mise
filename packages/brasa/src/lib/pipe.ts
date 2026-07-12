/**
 * @file Process piping helper for shell command chains.
 *
 * Spawns a single shell segment, feeds it an input buffer (with backpressure
 * handling), and resolves with its captured stdout.
 *
 * @module
 */
import { spawn, type ChildProcess } from 'child_process';

/**
 * Pipes an input buffer through a spawned shell command and captures its stdout.
 *
 * Writes the input to the child's stdin with drain-aware backpressure handling,
 * tolerates early-close EPIPE, and rejects on non-zero exit or spawn error.
 *
 * @param segment - The shell command to run (executed with `shell: true`).
 * @param input - The data to write to the command's stdin.
 * @returns The command's captured stdout.
 */
export function segment_pipeThrough(segment: string, input: Buffer): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    // When using shell: true, pass the entire command as a single string
    const child: ChildProcess = spawn(segment, {
      stdio: ['pipe', 'pipe', 'inherit'],
      shell: true,
    });

    child.stdout!.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });

    child.on('close', (code: number | null) => {
      if (code !== 0 && code !== null) {
        reject(new Error(`Command '${segment}' exited with code ${code}`));
      } else {
        resolve(Buffer.concat(chunks));
      }
    });

    child.on('error', (err: Error) => {
      reject(err);
    });

    // Handle EPIPE errors when child closes stdin early
    child.stdin!.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EPIPE') {
        // Child closed stdin, this is normal if it exits early — handled by 'close'.
      } else {
        reject(err);
      }
    });

    /**
     * Writes all buffered data to child stdin with backpressure handling.
     * Splits large buffers into chunks and waits for drain events when needed.
     */
    const data_writeAll = async (): Promise<void> => {
      if (input.length === 0) {
        child.stdin!.end();
        return;
      }

      return new Promise<void>((resolveWrite: (value: void) => void, rejectWrite: (reason: Error) => void) => {
        let offset: number = 0;
        const chunkSize: number = 64 * 1024; // 64KB chunks

        const chunk_writeNext = (): void => {
          try {
            while (offset < input.length) {
              const end: number = Math.min(offset + chunkSize, input.length);
              const chunk: Buffer = input.subarray(offset, end);
              offset = end;

              const canContinue: boolean = child.stdin!.write(chunk);
              if (!canContinue) {
                child.stdin!.once('drain', chunk_writeNext);
                return;
              }
            }
            child.stdin!.end();
            resolveWrite();
          } catch (err: unknown) {
            rejectWrite(err as Error);
          }
        };

        chunk_writeNext();
      });
    };

    // Start writing in parallel with reading output; ignore write errors if the
    // child already closed (EPIPE is handled by the stdin error handler).
    data_writeAll().catch(() => {});
  });
}
