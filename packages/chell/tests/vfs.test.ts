import { describe, it, expect, jest, beforeEach } from '@jest/globals';

// Mock external dependencies BEFORE imports
const mockGetCWD = jest.fn();
const mockPlugins_listAll = jest.fn();
const mockFiles_list = jest.fn();
const mockGrid_render = jest.fn();
const mockLong_render = jest.fn();

// Mock cumin
const mockListCache = {
  cache_get: jest.fn(),
  cache_set: jest.fn(),
  cache_invalidate: jest.fn(),
};

jest.unstable_mockModule('@fnndsc/cumin', () => ({
  listCache_get: () => mockListCache,
  errorStack: { 
    stack_push: jest.fn(), 
    stack_pop: jest.fn().mockReturnValue({ message: 'Mocked Error Message', type: 'error' }) 
  },
  Ok: (val) => ({ ok: true, value: val }),
  Err: (err) => ({ ok: false, error: err })
}));

// Mock the session module directly
jest.unstable_mockModule('../src/session/index.js', () => ({
  session: {
    getCWD: mockGetCWD,
    setCWD: jest.fn()
  }
}));

jest.unstable_mockModule('@fnndsc/salsa', () => ({
  plugins_listAll: mockPlugins_listAll
}));

jest.unstable_mockModule('@fnndsc/chili/commands/fs/ls.js', () => ({
  files_list: mockFiles_list
}));

jest.unstable_mockModule('@fnndsc/chili/views/ls.js', () => ({
  grid_render: mockGrid_render,
  long_render: mockLong_render
}));

// Mock console methods
const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

// Now import VFS after mocks are set up - must use dynamic import for unstable_mockModule
const { VFS } = await import('../src/lib/vfs/vfs.js');

describe('VFS', () => {
  let vfs: VFS;

  beforeEach(() => {
    vfs = new VFS();
    jest.clearAllMocks();
    mockGetCWD.mockResolvedValue('/home/user');
    mockGrid_render.mockReturnValue('grid output');
    mockLong_render.mockReturnValue('long output');
  });

  describe('list()', () => {
    it('should list current directory when no path provided', async () => {
      mockGetCWD.mockResolvedValue('/home/user');
      mockFiles_list.mockResolvedValue([
        { name: 'file1.txt', type: 'file', size: 100, owner: 'user', date: '2025-01-01' }
      ]);

      await vfs.list();

      expect(mockGetCWD).toHaveBeenCalled();
      expect(mockFiles_list).toHaveBeenCalledWith(
        { path: '/home/user' },
        '/home/user'
      );
    });

    it('should resolve relative path against CWD', async () => {
      mockGetCWD.mockResolvedValue('/home/user');
      mockFiles_list.mockResolvedValue([]);

      await vfs.list('docs');

      expect(mockFiles_list).toHaveBeenCalledWith(
        { path: '/home/user/docs' },
        '/home/user/docs'
      );
    });

    it('should route /bin to virtual bin handler', async () => {
      mockGetCWD.mockResolvedValue('/home/user');
      mockPlugins_listAll.mockResolvedValue({
        tableData: [
          { name: 'pl-dircopy', version: '2.1.0', creation_date: '2025-01-01' }
        ]
      });

      await vfs.list('/bin');

      expect(mockPlugins_listAll).toHaveBeenCalled();
      expect(mockFiles_list).not.toHaveBeenCalled();
    });

    it('should use grid render by default', async () => {
      mockGetCWD.mockResolvedValue('/');
      mockFiles_list.mockResolvedValue([
        { name: 'file.txt', type: 'file', size: 100, owner: 'user', date: '2025-01-01' }
      ]);

      await vfs.list('/', {});

      expect(mockGrid_render).toHaveBeenCalled();
      expect(mockLong_render).not.toHaveBeenCalled();
    });

    it('should use long render when long option is true', async () => {
      mockGetCWD.mockResolvedValue('/');
      mockFiles_list.mockResolvedValue([
        { name: 'file.txt', type: 'file', size: 100, owner: 'user', date: '2025-01-01' }
      ]);

      await vfs.list('/', { long: true });

      expect(mockLong_render).toHaveBeenCalled();
      expect(mockGrid_render).not.toHaveBeenCalled();
    });

    it('should pass human option to render functions', async () => {
      mockGetCWD.mockResolvedValue('/');
      mockFiles_list.mockResolvedValue([
        { name: 'file.txt', type: 'file', size: 100, owner: 'user', date: '2025-01-01' }
      ]);

      await vfs.list('/', { long: true, human: true });

      expect(mockLong_render).toHaveBeenCalledWith(
        expect.anything(),
        { human: true }
      );
    });
  });

  describe('listVirtualBin()', () => {
    it('should list plugins from /bin', async () => {
      mockGetCWD.mockResolvedValue('/');
      mockPlugins_listAll.mockResolvedValue({
        tableData: [
          { name: 'pl-dircopy', version: '2.1.0', creation_date: '2025-01-01' },
          { name: 'pl-simpledsapp', version: '1.0.0', creation_date: '2025-01-02' }
        ]
      });

      await vfs.list('/bin');

      expect(mockPlugins_listAll).toHaveBeenCalledWith({});
      // Note: Items are now sorted at command layer, view layer receives sorted items
      expect(mockGrid_render).toHaveBeenCalled();
      const callArgs = mockGrid_render.mock.calls[0];
      expect(callArgs[0]).toEqual([
        { name: 'pl-dircopy-v2.1.0', type: 'plugin', size: 0, owner: 'system', date: '2025-01-01' },
        { name: 'pl-simpledsapp-v1.0.0', type: 'plugin', size: 0, owner: 'system', date: '2025-01-02' }
      ]);
    });

    it('should handle plugin without version', async () => {
      mockGetCWD.mockResolvedValue('/');
      mockPlugins_listAll.mockResolvedValue({
        tableData: [
          { name: 'pl-test', creation_date: '2025-01-01' }
        ]
      });

      await vfs.list('/bin');

      // Note: Items are now sorted at command layer, view layer receives sorted items
      expect(mockGrid_render).toHaveBeenCalled();
      const callArgs = mockGrid_render.mock.calls[0];
      expect(callArgs[0]).toEqual([
        { name: 'pl-test', type: 'plugin', size: 0, owner: 'system', date: '2025-01-01' }
      ]);
    });

    it('should handle no plugins found', async () => {
      mockGetCWD.mockResolvedValue('/');
      mockPlugins_listAll.mockResolvedValue({
        tableData: []
      });

      await vfs.list('/bin');

      expect(consoleLogSpy).not.toHaveBeenCalled();
      expect(mockGrid_render).not.toHaveBeenCalled();
    });

    it('should handle null tableData', async () => {
      mockGetCWD.mockResolvedValue('/');
      mockPlugins_listAll.mockResolvedValue({});

      await vfs.list('/bin');

      expect(consoleLogSpy).not.toHaveBeenCalled();
    });

    it('should handle plugin list error', async () => {
      mockGetCWD.mockResolvedValue('/');
      mockPlugins_listAll.mockRejectedValue(new Error('API error'));

      await vfs.list('/bin');

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Mocked Error Message')
      );
    });

    it('should render in long format when requested', async () => {
      mockGetCWD.mockResolvedValue('/');
      mockPlugins_listAll.mockResolvedValue({
        tableData: [
          { name: 'pl-test', version: '1.0.0', creation_date: '2025-01-01' }
        ]
      });

      await vfs.list('/bin', { long: true });

      expect(mockLong_render).toHaveBeenCalled();
      expect(mockGrid_render).not.toHaveBeenCalled();
    });
  });

  describe('listNative()', () => {
    it('should list native ChRIS directory', async () => {
      mockGetCWD.mockResolvedValue('/home/user');
      mockFiles_list.mockResolvedValue([
        { name: 'data', type: 'dir', size: 0, owner: 'user', date: '2025-01-01' },
        { name: 'file.txt', type: 'file', size: 1024, owner: 'user', date: '2025-01-02' }
      ]);

      await vfs.list('/home/user');

      expect(mockFiles_list).toHaveBeenCalledWith(
        { path: '/home/user' },
        '/home/user'
      );
      expect(mockGrid_render).toHaveBeenCalled();
    });

    it('should inject virtual bin directory when listing root', async () => {
      mockGetCWD.mockResolvedValue('/');
      mockFiles_list.mockResolvedValue([
        { name: 'home', type: 'dir', size: 0, owner: 'root', date: '2025-01-01' }
      ]);

      await vfs.list('/');

      const callArgs = mockGrid_render.mock.calls[0][0];
      const binItem = callArgs.find((item: any) => item.name === 'bin');
      expect(binItem).toBeDefined();
      expect(binItem.type).toBe('vfs');
    });

    it('should inject bin and sort items when listing root', async () => {
      mockGetCWD.mockResolvedValue('/');
      mockFiles_list.mockResolvedValue([
        { name: 'home', type: 'dir', size: 0, owner: 'root', date: '2025-01-01' },
        { name: 'aaa', type: 'dir', size: 0, owner: 'root', date: '2025-01-01' }
      ]);

      await vfs.list('/');

      const callArgs = mockGrid_render.mock.calls[0][0];
      expect(callArgs[0].name).toBe('aaa'); // Alphabetically first
      expect(callArgs[1].name).toBe('bin'); // Sorted in
      expect(callArgs[2].name).toBe('home');
    });

    it('should not inject bin when listing non-root', async () => {
      mockGetCWD.mockResolvedValue('/home');
      mockFiles_list.mockResolvedValue([
        { name: 'user', type: 'dir', size: 0, owner: 'root', date: '2025-01-01' }
      ]);

      await vfs.list('/home');

      const callArgs = mockGrid_render.mock.calls[0][0];
      const binItem = callArgs.find((item: any) => item.name === 'bin');
      expect(binItem).toBeUndefined();
    });

    it('should handle empty directory', async () => {
      mockGetCWD.mockResolvedValue('/tmp');
      mockFiles_list.mockResolvedValue([]);

      await vfs.list('/tmp');

      expect(mockFiles_list).toHaveBeenCalled();
      expect(mockGrid_render).not.toHaveBeenCalled();
      expect(mockLong_render).not.toHaveBeenCalled();
    });

    it('should handle files_list error', async () => {
      mockGetCWD.mockResolvedValue('/home');
      mockFiles_list.mockRejectedValue(new Error('Permission denied'));

      await vfs.list('/home');

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Mocked Error Message')
      );
    });

    it('should use long format when requested', async () => {
      mockGetCWD.mockResolvedValue('/home');
      mockFiles_list.mockResolvedValue([
        { name: 'file.txt', type: 'file', size: 100, owner: 'user', date: '2025-01-01' }
      ]);

      await vfs.list('/home', { long: true });

      expect(mockLong_render).toHaveBeenCalled();
      expect(mockGrid_render).not.toHaveBeenCalled();
    });

    it('should pass human option to long render', async () => {
      mockGetCWD.mockResolvedValue('/home');
      mockFiles_list.mockResolvedValue([
        { name: 'file.txt', type: 'file', size: 1048576, owner: 'user', date: '2025-01-01' }
      ]);

      await vfs.list('/home', { long: true, human: true });

      expect(mockLong_render).toHaveBeenCalledWith(
        expect.anything(),
        { human: true }
      );
    });
  });

  describe('vfs singleton', () => {
    it('should export a VFS instance', async () => {
      const { vfs: vfsSingleton } = await import('../src/lib/vfs/vfs.js');
      expect(vfsSingleton).toBeInstanceOf(VFS);
    });
  });
});
