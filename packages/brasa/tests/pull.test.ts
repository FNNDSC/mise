/**
 * @file Unit tests for the pure `pull` argument parser.
 *
 * @module
 */
import { describe, it, expect } from '@jest/globals';
import { pullArgs_parse } from '../src/builtins/fs/pull.args.js';

describe('pullArgs_parse', () => {
  it('parses bare paths with defaults', () => {
    expect(pullArgs_parse(['/net/pacs/x', '/net/pacs/y'])).toEqual({ nowait: false, retryMax: 0, newFeedTitle: null, parseError: null, paths: ['/net/pacs/x', '/net/pacs/y'] });
  });
  it('recognises --nowait', () => {
    expect(pullArgs_parse(['--nowait', 'p'])).toEqual({ nowait: true, retryMax: 0, newFeedTitle: null, parseError: null, paths: ['p'] });
  });
  it('reads --retry N and consumes its value', () => {
    expect(pullArgs_parse(['--retry', '3', 'p'])).toEqual({ nowait: false, retryMax: 3, newFeedTitle: null, parseError: null, paths: ['p'] });
  });
  it('reports negative, invalid, or missing retry counts', () => {
    expect(pullArgs_parse(['--retry', '-1', 'p']).parseError).toBe('--retry requires a non-negative integer');
    expect(pullArgs_parse(['--retry', 'abc']).parseError).toBe('--retry requires a non-negative integer');
    expect(pullArgs_parse(['p', '--retry']).parseError).toBe('--retry requires a non-negative integer');
  });
  it('rejects unknown options', () => {
    expect(pullArgs_parse(['--foo', 'p']).parseError).toBe('unsupported option: --foo');
  });
  it('reads --new-feed title and consumes its value', () => {
    expect(pullArgs_parse(['p', '--new-feed', 'Brain MRI'])).toEqual({
      nowait: false,
      retryMax: 0,
      newFeedTitle: 'Brain MRI',
      parseError: null,
      paths: ['p'],
    });
  });
  it('reports a missing or repeated --new-feed title', () => {
    expect(pullArgs_parse(['p', '--new-feed']).parseError).toBe('--new-feed requires a title');
    expect(pullArgs_parse(['p', '--new-feed', '   ']).parseError).toBe('--new-feed requires a title');
    expect(pullArgs_parse(['p', '--new-feed', '--retry', '1']).parseError).toBe('--new-feed requires a title');
    expect(pullArgs_parse(['p', '--new-feed', 'One', '--new-feed', 'Two']).parseError)
      .toBe('--new-feed may only be specified once');
  });
  it('parses one pipeline attachment and preserves forwarded tokens', () => {
    expect(pullArgs_parse([
      'p', '--new-feed', 'Brain MRI', '--pipeline', 'brain-preprocessing', '--',
      '--segmentation.threshold', '-0.5', '--@481.memory_limit=8Gi',
    ])).toEqual({
      nowait: false,
      retryMax: 0,
      newFeedTitle: 'Brain MRI',
      parseError: null,
      paths: ['p'],
      attachment: {
        kind: 'pipeline',
        selector: 'brain-preprocessing',
        args: ['--segmentation.threshold', '-0.5', '--@481.memory_limit=8Gi'],
      },
    });
  });
  it('requires a new Feed and exactly one attachment selector', () => {
    expect(pullArgs_parse(['p', '--pipeline', 'pipe']).parseError)
      .toBe('--pipeline requires --new-feed');
    expect(pullArgs_parse([
      'p', '--new-feed', 'x', '--pipeline', 'pipe', '--plugin', 'pl-x',
    ]).parseError).toBe('--plugin and --pipeline are mutually exclusive');
  });
});
