/**
 * @file Tests for the process-piping helper.
 *
 * Uses real cheap shell commands (cat/tr/false) to verify piping, backpressure,
 * and error handling.
 *
 * @module
 */
import { describe, it, expect } from '@jest/globals';
import { segment_pipeThrough } from '../src/lib/pipe.js';

describe('segment_pipeThrough', () => {
  it('passes input through cat unchanged', async () => {
    const out = await segment_pipeThrough('cat', Buffer.from('hello world'));
    expect(out.toString()).toBe('hello world');
  });

  it('transforms input via the command', async () => {
    const out = await segment_pipeThrough('tr a-z A-Z', Buffer.from('hi there'));
    expect(out.toString()).toBe('HI THERE');
  });

  it('handles empty input', async () => {
    const out = await segment_pipeThrough('cat', Buffer.from(''));
    expect(out.toString()).toBe('');
  });

  it('handles large input across the backpressure threshold', async () => {
    const big = Buffer.from('x'.repeat(200 * 1024)); // > 64KB chunk size
    const out = await segment_pipeThrough('cat', big);
    expect(out.length).toBe(big.length);
  });

  it('rejects on non-zero exit', async () => {
    await expect(segment_pipeThrough('false', Buffer.from('x'))).rejects.toThrow(/exited with code/);
  });
});
