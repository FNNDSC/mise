import { describe, it, expect } from '@jest/globals';
import { formatSize } from '../src/lib/vfs/vfs.js';

// Mock external dependencies to avoid import errors
jest.mock('../src/session/index.js', () => ({
  session: { getCWD: jest.fn() }
}));
jest.mock('@fnndsc/salsa', () => ({
  plugins_listAll: jest.fn(),
  files_listAll: jest.fn()
}));
jest.mock('@fnndsc/chili/commands/fs/ls.js', () => ({ files_list: jest.fn() }));
jest.mock('@fnndsc/chili/utils/cli.js', () => ({ CLIoptions: {} }));

import { jest } from '@jest/globals';

describe('formatSize', () => {
  it('should format 0 bytes', () => {
    expect(formatSize(0)).toBe('0 B');
  });

  it('should format bytes', () => {
    expect(formatSize(500)).toBe('500 B');
  });

  it('should format KB', () => {
    expect(formatSize(1024)).toBe('1 KB');
    expect(formatSize(1536)).toBe('1.5 KB');
  });

  it('should format MB', () => {
    expect(formatSize(1024 * 1024)).toBe('1 MB');
  });

  it('should format GB', () => {
    expect(formatSize(1024 * 1024 * 1024 * 2.5)).toBe('2.5 GB');
  });
});
