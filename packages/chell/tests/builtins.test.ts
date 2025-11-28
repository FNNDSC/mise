import { describe, it, expect } from '@jest/globals';
import { commandArgs_process, path_resolve_pure } from '../src/builtins/utils.js';

describe('commandArgs_process', () => {
  it('should parse positional arguments', () => {
    const args = ['ls', 'dir1', 'dir2'];
    const result = commandArgs_process(args);
    expect(result._).toEqual(['ls', 'dir1', 'dir2']);
  });

  it('should parse long flags', () => {
    const args = ['--verbose', '--user', 'chris'];
    const result = commandArgs_process(args);
    expect(result['verbose']).toBe(true);
    expect(result['user']).toBe('chris');
  });

  it('should parse short flags', () => {
    const args = ['-l', '-h'];
    const result = commandArgs_process(args);
    expect(result['l']).toBe(true);
    expect(result['h']).toBe(true);
  });

  it('should parse combined short flags', () => {
    const args = ['-lh'];
    const result = commandArgs_process(args);
    expect(result['l']).toBe(true);
    expect(result['h']).toBe(true);
  });

  it('should handle mixed args', () => {
    const args = ['ls', '-l', '/home/user', '--color', 'auto'];
    const result = commandArgs_process(args);
    expect(result._).toEqual(['ls', '/home/user']);
    expect(result['l']).toBe(true);
    expect(result['color']).toBe('auto');
  });
});

describe('path_resolve_pure', () => {
  const context = { user: 'chris', cwd: '/home/chris/work' };

  it('should resolve ~ to user home', () => {
    const p = path_resolve_pure('~', context);
    expect(p).toBe('/home/chris');
  });

  it('should resolve ~/subdir to user home subdir', () => {
    const p = path_resolve_pure('~/data', context);
    expect(p).toBe('/home/chris/data');
  });

  it('should resolve relative path against CWD', () => {
    const p = path_resolve_pure('file.txt', context);
    expect(p).toBe('/home/chris/work/file.txt');
  });

  it('should resolve absolute path as is', () => {
    const p = path_resolve_pure('/usr/local/bin', context);
    expect(p).toBe('/usr/local/bin');
  });

  it('should resolve .. parent directory', () => {
    const p = path_resolve_pure('..', context);
    expect(p).toBe('/home/chris');
  });

  it('should resolve . current directory', () => {
    const p = path_resolve_pure('.', context);
    expect(p).toBe('/home/chris/work');
  });

  it('should handle root path correctly', () => {
    const p = path_resolve_pure('/', context);
    expect(p).toBe('/');
  });

  it('should handle missing user (fallback to root for ~)', () => {
    const p = path_resolve_pure('~', { user: null, cwd: '/' });
    expect(p).toBe('/');
  });
});
