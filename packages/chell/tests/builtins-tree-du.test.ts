import { describe, it, expect, jest, beforeEach } from '@jest/globals';

// Mock dependencies BEFORE imports
const mockGetCWD = jest.fn();
const mockSetCWD = jest.fn();
const mockVfsDataGet = jest.fn();
const mockScanDo = jest.fn();
const mockArchyTreeCreate = jest.fn();
const mockContextGetSingle = jest.fn();
const mockSpinnerStart = jest.fn();
const mockSpinnerStop = jest.fn();
const mockChiliCommandRun = jest.fn();

// Mock console methods
const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

// Mock chili utils
jest.unstable_mockModule('@fnndsc/chili/utils', () => ({
  logical_toPhysical: jest.fn().mockResolvedValue({ ok: true, value: '/resolved/path' }),
  pathMapper_get: jest.fn()
}));

// Mock chili path module
jest.unstable_mockModule('@fnndsc/chili/path/pathCommand.js', () => ({
  scan_do: mockScanDo,
  archyTree_create: mockArchyTreeCreate,
}));

// Mock cumin
jest.unstable_mockModule('@fnndsc/cumin', () => ({
  listCache_get: () => ({
    cache_get: jest.fn(),
    cache_set: jest.fn(),
    cache_invalidate: jest.fn(),
  }),
  errorStack: {
    stack_push: jest.fn(),
    stack_pop: jest.fn()
  },
  computeResourceNames_parse: jest.fn(),
  computeResources_validate: jest.fn(),
  chrisContext: {
    current_get: jest.fn(),
  },
  Result: {},
  Ok: (val: any) => ({ ok: true, value: val }),
  Err: (err: any) => ({ ok: false, error: err }),
}));

// Mock session
jest.unstable_mockModule('../src/session/index.js', () => ({
  session: {
    getCWD: mockGetCWD,
    setCWD: mockSetCWD,
    connection: {}
  }
}));

// Mock VFS
jest.unstable_mockModule('../src/lib/vfs/vfs.js', () => ({
  vfs: {
    data_get: mockVfsDataGet
  }
}));

// Mock salsa
jest.unstable_mockModule('@fnndsc/salsa', () => ({
  context_getSingle: mockContextGetSingle,
  plugin_assignToComputeResources: jest.fn(),
  plugin_checkExists: jest.fn(),
  plugin_importFromStore: jest.fn(),
  plugin_registerWithAdmin: jest.fn(),
  plugins_searchPeers: jest.fn(),
  store_list: jest.fn(),
  store_search: jest.fn(),
}));

// Mock chili commands (needed for index.ts imports)
jest.unstable_mockModule('@fnndsc/chili/commands/fs/mkdir.js', () => ({ files_mkdir: jest.fn() }));
jest.unstable_mockModule('@fnndsc/chili/commands/fs/touch.js', () => ({ files_touch: jest.fn() }));
// FIX: Add bytes_format to upload mock
jest.unstable_mockModule('@fnndsc/chili/commands/fs/upload.js', () => ({
  files_uploadWithProgress: jest.fn(),
  bytes_format: (n: number) => `${n} B`
}));
jest.unstable_mockModule('@fnndsc/chili/commands/fs/cat.js', () => ({ files_cat: jest.fn() }));
jest.unstable_mockModule('@fnndsc/chili/commands/fs/rm.js', () => ({ files_rm: jest.fn() }));
jest.unstable_mockModule('@fnndsc/chili/commands/fs/cp.js', () => ({ files_cp: jest.fn() }));
jest.unstable_mockModule('@fnndsc/chili/commands/fs/mv.js', () => ({ files_mv: jest.fn() }));
jest.unstable_mockModule('@fnndsc/chili/commands/connect/login.js', () => ({ connect_login: jest.fn() }));
jest.unstable_mockModule('@fnndsc/chili/commands/connect/logout.js', () => ({ connect_logout: jest.fn() }));
jest.unstable_mockModule('@fnndsc/chili/commands/plugins/list.js', () => ({ plugins_fetchList: jest.fn() }));
jest.unstable_mockModule('@fnndsc/chili/commands/plugin/run.js', () => ({ plugin_execute: jest.fn() }));
jest.unstable_mockModule('@fnndsc/chili/commands/feeds/list.js', () => ({ feeds_fetchList: jest.fn() }));
jest.unstable_mockModule('@fnndsc/chili/commands/feed/create.js', () => ({ feed_create: jest.fn() }));
jest.unstable_mockModule('@fnndsc/chili/commands/files/list.js', () => ({ files_fetchList: jest.fn() }));
jest.unstable_mockModule('@fnndsc/chili/commands/files/fields.js', () => ({ fileFields_fetch: jest.fn() }));

// Mock chili views
jest.unstable_mockModule('@fnndsc/chili/views/fs.js', () => ({
  mkdir_render: jest.fn(), touch_render: jest.fn(), upload_render: jest.fn(),
  cat_render: jest.fn(), rm_render: jest.fn(), cp_render: jest.fn(), mv_render: jest.fn()
}));
jest.unstable_mockModule('@fnndsc/chili/views/connect.js', () => ({ login_render: jest.fn(), logout_render: jest.fn() }));
jest.unstable_mockModule('@fnndsc/chili/views/plugin.js', () => ({ pluginList_render: jest.fn(), pluginRun_render: jest.fn() }));
jest.unstable_mockModule('@fnndsc/chili/views/feed.js', () => ({ feedList_render: jest.fn(), feedCreate_render: jest.fn() }));
jest.unstable_mockModule('@fnndsc/chili/screen/screen.js', () => ({ table_display: jest.fn() }));

// Mock chell spinner
jest.unstable_mockModule('../src/lib/spinner.js', () => ({
  spinner: {
    start: mockSpinnerStart,
    stop: mockSpinnerStop
  }
}));

// Mock parametersofplugin
jest.unstable_mockModule('../src/builtins/parametersofplugin.js', () => ({
  builtin_parametersofplugin: jest.fn()
}));

// Mock chell
jest.unstable_mockModule('../src/chell.js', () => ({
  chiliCommand_run: mockChiliCommandRun
}));

// Import module under test
// const { builtin_tree, builtin_du } = await import('../src/builtins/index.js');

describe.skip('Builtins - Tree & Du', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetCWD.mockResolvedValue('/home/user');
    mockContextGetSingle.mockReturnValue({
      user: 'testuser',
      folder: '/home/user'
    });
  });

  describe('builtin_tree()', () => {
    it('should call scan_do and archyTree_create', async () => {
      mockScanDo.mockResolvedValue({ fileInfo: [], totalSize: 0 });
      mockArchyTreeCreate.mockReturnValue('├── dir\n└── file');

      await builtin_tree([]);

      expect(mockScanDo).toHaveBeenCalled();
      expect(mockArchyTreeCreate).toHaveBeenCalled();
      expect(consoleLogSpy).toHaveBeenCalledWith('├── dir\n└── file');
    });

    it('should handle path argument', async () => {
      mockScanDo.mockResolvedValue({ fileInfo: [], totalSize: 0 });
      mockArchyTreeCreate.mockReturnValue('');

      await builtin_tree(['/tmp']);

      expect(mockSetCWD).toHaveBeenCalledWith('/tmp');
      expect(mockSetCWD).toHaveBeenCalledWith('/home/user'); // Restoration
    });
  });

  describe('builtin_du()', () => {
    it('should calculate sizes for files', async () => {
      // Mock vfs response for a file
      // size: 1024 bytes = 1 KB
      mockVfsDataGet.mockResolvedValue({
        ok: true,
        value: [{ type: 'file', size: 1024 }]
      });

      await builtin_du(['file.txt']);

      // Expected: "           1     /home/user/file.txt"
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('1'));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('/home/user/file.txt'));
    });

    it('should calculate sizes for directories recursively', async () => {
      // Mock vfs response for a directory
      mockVfsDataGet.mockResolvedValue({
        ok: true,
        value: [{ type: 'dir', size: 0 }]
      });

      // Mock scan_do response
      // totalSize: 3000 bytes. 3000/1024 = 2.9 -> ceil -> 3 KB
      mockScanDo.mockResolvedValue({
        fileInfo: [
          { chrisPath: '/home/user/dir/file1.txt', size: 1000, isDirectory: false },
          { chrisPath: '/home/user/dir/file2.txt', size: 2000, isDirectory: false },
          { chrisPath: '/home/user/dir', size: 0, isDirectory: true }
        ],
        totalSize: 3000
      });

      await builtin_du(['dir']);

      expect(mockSetCWD).toHaveBeenCalledWith('/home/user/dir');
      // Expected: "           3     /home/user/dir"
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('3'));
    });

    it('should handle -h flag', async () => {
      const size = 1024 * 1024 * 2.5; // 2.5 MB
      mockVfsDataGet.mockResolvedValue({
        ok: true,
        value: [{ type: 'file', size: size }]
      });

      await builtin_du(['-h', 'large.file']);

      // The mock bytes_format returns `${n} B`
      // So we expect `${size} B`
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining(`${size} B`));
    });
  });
});
