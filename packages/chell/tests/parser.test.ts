import { describe, it, expect } from '@jest/globals';
import { args_tokenize } from '../src/lib/parser.js';

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
});
