/**
 * @file Unit tests for the extracted `rm` helpers.
 *
 * Covers the pure flag/path parser and the multi-target summary formatter
 * carved out of `builtin_rm`. Heavy IO/cross-package deps are mocked.
 *
 * @module
 */
import { jest, describe, it, expect } from '@jest/globals';

jest.unstable_mockModule('@fnndsc/chili/commands/fs/rm.js', () => ({ files_rm: jest.fn() }));
jest.unstable_mockModule('@fnndsc/chili/views/fs.js', () => ({ rm_render: jest.fn() }));
jest.unstable_mockModule('@fnndsc/cumin', () => ({ listCache_get: jest.fn() }));
jest.unstable_mockModule('../src/builtins/utils.js', () => ({ path_resolve: jest.fn() }));

const { rmArgs_parse, rmSummary_format } = await import('../src/builtins/fs/rm.js');

describe('rmArgs_parse', () => {
  it('parses combined short flags and paths', () => {
    expect(rmArgs_parse(['-rf', 'a', 'b'])).toEqual({ recursive: true, force: true, interactive: false, paths: ['a', 'b'] });
  });
  it('handles fully-combined flags in any order', () => {
    expect(rmArgs_parse(['-rfi'])).toEqual({ recursive: true, force: true, interactive: true, paths: [] });
    expect(rmArgs_parse(['-iR'])).toEqual({ recursive: true, force: false, interactive: true, paths: [] });
  });
  it('treats everything after -- as a path', () => {
    expect(rmArgs_parse(['--', '-weird-name', '-r'])).toEqual({ recursive: false, force: false, interactive: false, paths: ['-weird-name', '-r'] });
  });
  it('ignores unknown flags and collects bare paths', () => {
    expect(rmArgs_parse(['-x', 'foo', 'bar'])).toEqual({ recursive: false, force: false, interactive: false, paths: ['foo', 'bar'] });
  });
});

describe('rmSummary_format', () => {
  it('returns null when nothing happened', () => {
    expect(rmSummary_format(0, 0)).toBeNull();
  });
  it('reports all-success (with singular/plural)', () => {
    expect(rmSummary_format(3, 0)).toContain('Successfully removed 3 items');
    expect(rmSummary_format(1, 0)).toContain('Successfully removed 1 item');
  });
  it('reports mixed success/failure', () => {
    expect(rmSummary_format(2, 1)).toContain('Removed 2 items, failed 1');
  });
  it('reports all-failure', () => {
    expect(rmSummary_format(0, 2)).toContain('Failed to remove 2 items');
  });
});
