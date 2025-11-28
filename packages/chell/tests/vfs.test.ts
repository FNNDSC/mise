import { describe, it, expect, jest } from '@jest/globals';
import { vfs } from '../src/lib/vfs/vfs.js';

// Mock external dependencies to avoid import errors
jest.mock('../src/session/index.js', () => ({
  session: { getCWD: jest.fn() }
}));
jest.mock('@fnndsc/salsa', () => ({
  plugins_listAll: jest.fn(),
  files_listAll: jest.fn()
}));
jest.mock('@fnndsc/chili/commands/fs/ls.js', () => ({ files_list: jest.fn() }));
jest.mock('@fnndsc/chili/views/ls.js', () => ({ renderGrid: jest.fn(), renderLong: jest.fn() }));
jest.mock('@fnndsc/chili/utils/cli.js', () => ({ CLIoptions: {} }));

describe('VFS', () => {
  it('should be defined', () => {
    expect(vfs).toBeDefined();
  });
});