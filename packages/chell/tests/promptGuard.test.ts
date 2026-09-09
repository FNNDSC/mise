/**
 * @file A stray write while the REPL waits at its prompt lands on its own
 * line, with the prompt redrawn beneath it.
 *
 * @module
 */
import { describe, expect, it, jest } from '@jest/globals';
import { promptGuard_create, type GuardedStream } from '../src/core/promptGuard.js';

function stream_make(isTTY: boolean = true): GuardedStream & { chunks: string[] } {
  const stream: GuardedStream & { chunks: string[] } = {
    chunks: [],
    isTTY,
    write(chunk: string | Uint8Array): boolean {
      stream.chunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
      return true;
    },
  };
  return stream;
}

describe('promptGuard', () => {
  it('clears the prompt line, lands the stray line, and redraws the prompt while engaged', () => {
    const stream = stream_make();
    const redraw = jest.fn();
    const guard = promptGuard_create(stream, redraw);
    guard.engage();
    stream.write('[surface ab12cd]\nls output');
    expect(stream.chunks).toEqual(['\r\x1b[2K', '[surface ab12cd]\nls output\n']);
    expect(redraw).toHaveBeenCalledTimes(1);
  });

  it('lets writes flow raw once released, as a command\'s output must', () => {
    const stream = stream_make();
    const redraw = jest.fn();
    const guard = promptGuard_create(stream, redraw);
    guard.engage();
    guard.release();
    stream.write('raw');
    expect(stream.chunks).toEqual(['raw']);
    expect(redraw).not.toHaveBeenCalled();
  });

  it('never guards the output readline draws on, nor the REPL\'s own writes', () => {
    const stream = stream_make();
    const redraw = jest.fn();
    const guard = promptGuard_create(stream, redraw);
    guard.engage();
    guard.output.write('> ');
    guard.write('\n');
    expect(stream.chunks).toEqual(['> ', '\n']);
    expect(redraw).not.toHaveBeenCalled();
    // The rest of the stream shows through the proxy unchanged.
    expect(guard.output.isTTY).toBe(true);
  });

  it('skips the line clear off a TTY, where there is no prompt line to clear', () => {
    const stream = stream_make(false);
    const guard = promptGuard_create(stream, jest.fn());
    guard.engage();
    stream.write('line\n');
    expect(stream.chunks).toEqual(['line\n']);
  });

  it('honours a trailing write callback so callers waiting on it are not left hanging', () => {
    const stream = stream_make();
    const guard = promptGuard_create(stream, jest.fn());
    guard.engage();
    const done = jest.fn();
    stream.write('line\n', 'utf8', done);
    expect(done).toHaveBeenCalledTimes(1);
  });
});
