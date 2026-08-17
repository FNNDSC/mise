import { describe, it, expect } from '@jest/globals';
import { args_tokenize, shellWords_tokenize } from '../src/lib/parser.js';

describe('args_tokenize', () => {
  it('should split simple whitespace-delimited tokens', () => {
    expect(args_tokenize('ls /home/user')).toEqual(['ls', '/home/user']);
  });

  it('should preserve spaces inside double quotes', () => {
    expect(args_tokenize('cd "Feed for data"')).toEqual(['cd', 'Feed for data']);
  });

  it('should preserve spaces inside single quotes', () => {
    expect(args_tokenize("cd 'Feed for data'")).toEqual(['cd', 'Feed for data']);
  });

  it('should handle escaped spaces', () => {
    expect(args_tokenize('cd Feed\\ for\\ data')).toEqual(['cd', 'Feed for data']);
  });

  it('should handle mixed quotes and normal args', () => {
    expect(args_tokenize('cp "Feed for data"/file.txt /tmp')).toEqual(['cp', 'Feed for data/file.txt', '/tmp']);
  });

  it('retains unquoted wildcard eligibility', () => {
    expect(shellWords_tokenize('cat *.nii')).toEqual([
      expect.objectContaining({ value: 'cat', pathnameExpansion: false }),
      expect.objectContaining({ value: '*.nii', globPattern: '*.nii', pathnameExpansion: true }),
    ]);
  });

  it('keeps quoted and escaped wildcard syntax literal', () => {
    expect(shellWords_tokenize("cat '*.nii' \\*.mha")).toEqual([
      expect.objectContaining({ value: 'cat', pathnameExpansion: false }),
      expect.objectContaining({ value: '*.nii', globPattern: '\\*.nii', pathnameExpansion: false }),
      expect.objectContaining({ value: '*.mha', globPattern: '\\*.mha', pathnameExpansion: false }),
    ]);
  });

  it('expands only the unquoted wildcard fragment of a mixed word', () => {
    expect(shellWords_tokenize('cat "scan-"*.nii')).toEqual([
      expect.objectContaining({ value: 'cat', pathnameExpansion: false }),
      expect.objectContaining({ value: 'scan-*.nii', globPattern: 'scan-*.nii', pathnameExpansion: true }),
    ]);
  });

  it('retains an empty quoted argument', () => {
    expect(args_tokenize('touch ""')).toEqual(['touch', '']);
  });
});
