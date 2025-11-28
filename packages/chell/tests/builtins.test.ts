import { describe, it, expect } from '@jest/globals';
import { commandArgs_process } from '../src/builtins/index.js';

// Mock session to avoid import errors if builtins imports it
jest.mock('../src/session/index.js', () => ({
  session: {
    connection: {
      user_get: jest.fn(),
      client_get: jest.fn(),
    },
    getCWD: jest.fn(),
    setCWD: jest.fn(),
  }
}));

// Mock other heavy dependencies
jest.mock('../src/lib/vfs/vfs.js', () => ({
  vfs: { list: jest.fn() }
}));
jest.mock('@fnndsc/chili/commands/fs/mkdir.js', () => ({ files_mkdir: jest.fn() }));
jest.mock('@fnndsc/chili/commands/fs/touch.js', () => ({ files_touch: jest.fn() }));
jest.mock('@fnndsc/chili/commands/fs/ls.js', () => ({ files_list: jest.fn() }));
jest.mock('@fnndsc/salsa', () => ({ files_content: jest.fn() }));

import { jest } from '@jest/globals';

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

  it('should parse combined short flags (if logic supported) or handle distinct short flags', () => {
    // Current implementation splits combined flags?
    // Implementation: const flags = arg.substring(1).split('');
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
