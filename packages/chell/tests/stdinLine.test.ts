/**
 * @file Tests for the one-line stdin reader a token arrives on.
 *
 * @module
 */
import { describe, it, expect } from '@jest/globals';
import { Readable } from 'node:stream';
import { stdinLine_read } from '../src/lib/stdinLine.js';

describe('stdinLine_read', () => {
  it('returns the first line without its ending', async () => {
    const input: Readable = Readable.from(['abc123\nignored\n']);
    await expect(stdinLine_read(input)).resolves.toBe('abc123');
  });

  it('joins chunks until a newline arrives', async () => {
    const input: Readable = Readable.from(['abc', '12', '3\n']);
    await expect(stdinLine_read(input)).resolves.toBe('abc123');
  });

  it('strips a carriage return', async () => {
    const input: Readable = Readable.from(['abc123\r\n']);
    await expect(stdinLine_read(input)).resolves.toBe('abc123');
  });

  it('returns null when the stream ends before a line', async () => {
    const input: Readable = Readable.from(['no newline']);
    await expect(stdinLine_read(input)).resolves.toBeNull();
  });

  it('returns null on an empty stream', async () => {
    const input: Readable = Readable.from([]);
    await expect(stdinLine_read(input)).resolves.toBeNull();
  });
});
