/**
 * @file Unit tests for the pure `pull` argument parser.
 *
 * @module
 */
import { describe, it, expect } from '@jest/globals';
import { pullArgs_parse } from '../src/builtins/fs/pull.args.js';

describe('pullArgs_parse', () => {
  it('parses bare paths with defaults', () => {
    expect(pullArgs_parse(['/net/pacs/x', '/net/pacs/y'])).toEqual({ nowait: false, retryMax: 0, paths: ['/net/pacs/x', '/net/pacs/y'] });
  });
  it('recognises --nowait', () => {
    expect(pullArgs_parse(['--nowait', 'p'])).toEqual({ nowait: true, retryMax: 0, paths: ['p'] });
  });
  it('reads --retry N and consumes its value', () => {
    expect(pullArgs_parse(['--retry', '3', 'p'])).toEqual({ nowait: false, retryMax: 3, paths: ['p'] });
  });
  it('ignores negative/invalid retry counts but still consumes the value', () => {
    expect(pullArgs_parse(['--retry', '-1', 'p'])).toEqual({ nowait: false, retryMax: 0, paths: ['p'] });
    expect(pullArgs_parse(['--retry', 'abc'])).toEqual({ nowait: false, retryMax: 0, paths: [] });
  });
  it('ignores unknown -- flags', () => {
    expect(pullArgs_parse(['--foo', 'p'])).toEqual({ nowait: false, retryMax: 0, paths: ['p'] });
  });
});
