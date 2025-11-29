/**
 * @file Tests for tab completion functionality.
 */

import { jest } from '@jest/globals';

// Mock salsa plugins_listAll
const mockPlugins_listAll = jest.fn();
jest.unstable_mockModule('@fnndsc/salsa', () => ({
  plugins_listAll: mockPlugins_listAll,
  context_getSingle: jest.fn(() => ({
    user: 'testuser',
    URL: 'http://localhost:8000'
  }))
}));

// Mock session
jest.unstable_mockModule('../src/session/index.js', () => ({
  session: {
    getCWD: jest.fn().mockResolvedValue('/home/testuser'),
    setCWD: jest.fn(),
    connection: {
      client_get: jest.fn(),
      user_get: jest.fn().mockResolvedValue('testuser')
    }
  }
}));

// Mock chili files_list
jest.unstable_mockModule('@fnndsc/chili/commands/fs/ls.js', () => ({
  files_list: jest.fn().mockResolvedValue([])
}));

const { completer } = await import('../src/lib/completer/index.js');

describe('Tab Completion', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Command Completion', () => {
    it('should complete builtin commands', (done) => {
      mockPlugins_listAll.mockResolvedValue({ tableData: [] });

      completer('c', (err, result) => {
        expect(err).toBeNull();
        const [hits, original] = result;
        expect(original).toBe('c');
        expect(hits).toContain('cd');
        expect(hits).toContain('connect');
        expect(hits).toContain('chefs');
        done();
      });
    });

    it('should complete plugin names from /bin', (done) => {
      mockPlugins_listAll.mockResolvedValue({
        tableData: [
          { name: 'pl-dircopy' },
          { name: 'pl-topologicalcopy' },
          { name: 'pl-mri_convert' }
        ]
      });

      completer('pl-', (err, result) => {
        expect(err).toBeNull();
        const [hits, original] = result;
        expect(original).toBe('pl-');
        expect(hits).toContain('pl-dircopy');
        expect(hits).toContain('pl-topologicalcopy');
        expect(hits).toContain('pl-mri_convert');
        done();
      });
    });

    it('should combine builtins and plugins for completion', (done) => {
      mockPlugins_listAll.mockResolvedValue({
        tableData: [
          { name: 'custom-app' },
          { name: 'another-plugin' }
        ]
      });

      completer('c', (err, result) => {
        expect(err).toBeNull();
        const [hits, original] = result;
        expect(original).toBe('c');
        // Should include builtins starting with 'c'
        expect(hits).toContain('cd');
        expect(hits).toContain('connect');
        expect(hits).toContain('chefs');
        // Should include plugin starting with 'c'
        expect(hits).toContain('custom-app');
        // Should NOT include plugin not starting with 'c'
        expect(hits).not.toContain('another-plugin');
        done();
      });
    });

    it('should handle plugin fetch errors gracefully', (done) => {
      mockPlugins_listAll.mockRejectedValue(new Error('Network error'));

      completer('c', (err, result) => {
        expect(err).toBeNull();
        const [hits, original] = result;
        expect(original).toBe('c');
        // Should still return builtin completions
        expect(hits).toContain('cd');
        expect(hits).toContain('connect');
        done();
      });
    });

    it('should return empty array when no matches', (done) => {
      mockPlugins_listAll.mockResolvedValue({ tableData: [] });

      completer('xyz', (err, result) => {
        expect(err).toBeNull();
        const [hits, original] = result;
        expect(original).toBe('xyz');
        expect(hits).toHaveLength(0);
        done();
      });
    });

    it('should handle empty plugin list', (done) => {
      mockPlugins_listAll.mockResolvedValue({ tableData: null });

      completer('p', (err, result) => {
        expect(err).toBeNull();
        const [hits, original] = result;
        expect(original).toBe('p');
        expect(hits).toContain('pwd');
        done();
      });
    });
  });

  describe('Path Completion', () => {
    it('should not trigger command completion when typing arguments', (done) => {
      mockPlugins_listAll.mockResolvedValue({ tableData: [] });

      // When we have a space after the command, we're in argument mode
      completer('cd ', (err, result) => {
        expect(err).toBeNull();
        const [hits, original] = result;
        // Should return path completions, not command completions
        // In this case, empty because we mocked files_list to return []
        expect(hits).toEqual([]);
        done();
      });
    });
  });
});
