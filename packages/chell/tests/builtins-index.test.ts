import { describe, it, expect, jest, beforeEach } from '@jest/globals';

// Mock dependencies BEFORE imports
const mockGetCWD = jest.fn();
const mockSetCWD = jest.fn();
const mockUserGet = jest.fn();
const mockClientGet = jest.fn();
const mockGetFileBrowserFolderByPath = jest.fn();
const mockVfsList = jest.fn();
const mockContextGetSingle = jest.fn();
const mockConnectLogin = jest.fn();
const mockConnectLogout = jest.fn();
const mockPluginsFetchList = jest.fn();
const mockPluginExecute = jest.fn();
const mockFeedsFetchList = jest.fn();
const mockFeedCreate = jest.fn();
const mockFilesFetchList = jest.fn();
const mockFileFieldsFetch = jest.fn();
const mockChefsMkdir = jest.fn();
const mockChefsTouch = jest.fn();
const mockChefsUpload = jest.fn();
const mockChefsCat = jest.fn();
const mockChefsRm = jest.fn();
const mockTableDisplay = jest.fn();
const mockPluginListRender = jest.fn();
const mockPluginRunRender = jest.fn();
const mockFeedListRender = jest.fn();
const mockFeedCreateRender = jest.fn();
const mockLoginRender = jest.fn();
const mockLogoutRender = jest.fn();
const mockMkdirRender = jest.fn();
const mockTouchRender = jest.fn();
const mockUploadRender = jest.fn();
const mockCatRender = jest.fn();
const mockRmRender = jest.fn();
const mockChiliCommandRun = jest.fn();

// Mock session module
jest.unstable_mockModule('../src/session/index.js', () => ({
  session: {
    getCWD: mockGetCWD,
    setCWD: mockSetCWD,
    connection: {
      user_get: mockUserGet,
      client_get: mockClientGet
    }
  }
}));

// Mock VFS
jest.unstable_mockModule('../src/lib/vfs/vfs.js', () => ({
  vfs: {
    list: mockVfsList
  }
}));

// Mock salsa
jest.unstable_mockModule('@fnndsc/salsa', () => ({
  context_getSingle: mockContextGetSingle
}));

// Mock chili commands
jest.unstable_mockModule('@fnndsc/chili/commands/connect/login.js', () => ({
  connect_login: mockConnectLogin
}));

jest.unstable_mockModule('@fnndsc/chili/commands/connect/logout.js', () => ({
  connect_logout: mockConnectLogout
}));

jest.unstable_mockModule('@fnndsc/chili/commands/plugins/list.js', () => ({
  plugins_fetchList: mockPluginsFetchList
}));

jest.unstable_mockModule('@fnndsc/chili/commands/plugin/run.js', () => ({
  plugin_execute: mockPluginExecute
}));

jest.unstable_mockModule('@fnndsc/chili/commands/feeds/list.js', () => ({
  feeds_fetchList: mockFeedsFetchList
}));

jest.unstable_mockModule('@fnndsc/chili/commands/feed/create.js', () => ({
  feed_create: mockFeedCreate
}));

jest.unstable_mockModule('@fnndsc/chili/commands/files/list.js', () => ({
  files_fetchList: mockFilesFetchList
}));

jest.unstable_mockModule('@fnndsc/chili/commands/files/fields.js', () => ({
  fileFields_fetch: mockFileFieldsFetch
}));

jest.unstable_mockModule('@fnndsc/chili/commands/fs/mkdir.js', () => ({
  files_mkdir: mockChefsMkdir
}));

jest.unstable_mockModule('@fnndsc/chili/commands/fs/touch.js', () => ({
  files_touch: mockChefsTouch
}));

jest.unstable_mockModule('@fnndsc/chili/commands/fs/upload.js', () => ({
  files_upload: mockChefsUpload
}));

jest.unstable_mockModule('@fnndsc/chili/commands/fs/cat.js', () => ({
  files_cat: mockChefsCat
}));

jest.unstable_mockModule('@fnndsc/chili/commands/fs/rm.js', () => ({
  files_rm: mockChefsRm,
  RmOptions: {},
  RmResult: {}
}));

// Mock chili views
jest.unstable_mockModule('@fnndsc/chili/views/plugin.js', () => ({
  pluginList_render: mockPluginListRender,
  pluginRun_render: mockPluginRunRender
}));

jest.unstable_mockModule('@fnndsc/chili/views/feed.js', () => ({
  feedList_render: mockFeedListRender,
  feedCreate_render: mockFeedCreateRender
}));

jest.unstable_mockModule('@fnndsc/chili/views/connect.js', () => ({
  login_render: mockLoginRender,
  logout_render: mockLogoutRender
}));

jest.unstable_mockModule('@fnndsc/chili/views/fs.js', () => ({
  mkdir_render: mockMkdirRender,
  touch_render: mockTouchRender,
  upload_render: mockUploadRender,
  cat_render: mockCatRender,
  rm_render: mockRmRender
}));

jest.unstable_mockModule('@fnndsc/chili/screen/screen.js', () => ({
  table_display: mockTableDisplay
}));

// Mock chell
jest.unstable_mockModule('../src/chell.js', () => ({
  chiliCommand_run: mockChiliCommandRun
}));

// Mock console methods
const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

// Now import the module to test
const {
  path_resolve,
  builtin_cd,
  builtin_pwd,
  builtin_ls,
  builtin_upload,
  builtin_connect,
  builtin_logout,
  builtin_plugin,
  builtin_feed,
  builtin_files,
  builtin_links,
  builtin_dirs,
  builtin_chefs,
  builtin_cat,
  builtin_rm,
  builtin_context
} = await import('../src/builtins/index.js');

describe('Builtins - Core Functions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetCWD.mockResolvedValue('/home/user');
    mockContextGetSingle.mockReturnValue({
      user: 'testuser',
      URL: 'http://localhost:8000',
      folder: '/home/user',
      feed: null,
      plugin: null
    });
  });

  describe('path_resolve()', () => {
    it('should resolve tilde to user home', async () => {
      mockContextGetSingle.mockReturnValue({ user: 'chris', folder: null, URL: null, feed: null, plugin: null });
      mockGetCWD.mockResolvedValue('/');

      const result = await path_resolve('~');
      expect(result).toBe('/home/chris');
    });

    it('should resolve relative path against CWD', async () => {
      mockGetCWD.mockResolvedValue('/home/user');

      const result = await path_resolve('data');
      expect(result).toBe('/home/user/data');
    });

    it('should resolve absolute path as-is', async () => {
      const result = await path_resolve('/tmp/test');
      expect(result).toBe('/tmp/test');
    });
  });

  describe('builtin_pwd()', () => {
    it('should print current working directory', async () => {
      mockGetCWD.mockResolvedValue('/home/user/data');

      await builtin_pwd();

      expect(consoleLogSpy).toHaveBeenCalledWith('/home/user/data');
    });
  });

  describe('builtin_cd()', () => {
    it('should change to home directory when no args', async () => {
      mockUserGet.mockResolvedValue('testuser');
      mockClientGet.mockResolvedValue({ getFileBrowserFolderByPath: mockGetFileBrowserFolderByPath });
      mockGetFileBrowserFolderByPath.mockResolvedValue({ path: '/home/testuser' });

      await builtin_cd([]);

      expect(mockSetCWD).toHaveBeenCalledWith('/home/testuser');
    });

    it('should change to virtual /bin directory', async () => {
      await builtin_cd(['/bin']);

      expect(mockSetCWD).toHaveBeenCalledWith('/bin');
    });

    it('should change to valid ChRIS directory', async () => {
      mockClientGet.mockResolvedValue({ getFileBrowserFolderByPath: mockGetFileBrowserFolderByPath });
      mockGetFileBrowserFolderByPath.mockResolvedValue({ path: '/home/user/data' });

      await builtin_cd(['/home/user/data']);

      expect(mockSetCWD).toHaveBeenCalledWith('/home/user/data');
    });

    it('should error on non-existent directory', async () => {
      mockClientGet.mockResolvedValue({ getFileBrowserFolderByPath: mockGetFileBrowserFolderByPath });
      mockGetFileBrowserFolderByPath.mockResolvedValue(null);

      await builtin_cd(['/nonexistent']);

      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('No such file or directory'));
      expect(mockSetCWD).not.toHaveBeenCalled();
    });

    it('should error when not connected', async () => {
      mockClientGet.mockResolvedValue(null);

      await builtin_cd(['/home/user']);

      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Not connected'));
    });
  });

  describe('builtin_ls()', () => {
    it('should list current directory when no args', async () => {
      await builtin_ls([]);

      expect(mockVfsList).toHaveBeenCalledWith(undefined, { long: false, human: false });
    });

    it('should list specified path', async () => {
      mockGetCWD.mockResolvedValue('/home/user');

      await builtin_ls(['/tmp']);

      expect(mockVfsList).toHaveBeenCalledWith('/tmp', { long: false, human: false });
    });

    it('should handle -l flag for long format', async () => {
      await builtin_ls(['-l']);

      expect(mockVfsList).toHaveBeenCalledWith(undefined, { long: true, human: false });
    });

    it('should handle -h flag for human-readable sizes', async () => {
      await builtin_ls(['-l', '-h']);

      expect(mockVfsList).toHaveBeenCalledWith(undefined, { long: true, human: true });
    });

    it('should handle multiple paths by showing basenames', async () => {
      await builtin_ls(['file1.txt', 'file2.txt']);

      expect(consoleLogSpy).toHaveBeenCalledWith('file1.txt  file2.txt');
    });
  });

  describe('builtin_upload()', () => {
    it('should upload file to remote path', async () => {
      mockGetCWD.mockResolvedValue('/home/user');
      mockChefsUpload.mockResolvedValue(true);
      mockUploadRender.mockReturnValue('Upload successful');

      await builtin_upload(['./local.txt', 'remote.txt']);

      expect(mockChefsUpload).toHaveBeenCalledWith('./local.txt', '/home/user/remote.txt');
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Upload successful'));
    });

    it('should error with insufficient args', async () => {
      await builtin_upload(['local.txt']);

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Usage:'));
    });

    it('should handle upload errors', async () => {
      mockChefsUpload.mockRejectedValue(new Error('Network error'));

      await builtin_upload(['local.txt', 'remote.txt']);

      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Network error'));
    });
  });

  describe('builtin_connect()', () => {
    it('should connect with valid credentials', async () => {
      mockConnectLogin.mockResolvedValue(true);
      mockLoginRender.mockReturnValue('Connected successfully');

      await builtin_connect(['--user', 'chris', '--password', 'chris1234', 'http://localhost:8000']);

      expect(mockConnectLogin).toHaveBeenCalledWith({
        user: 'chris',
        password: 'chris1234',
        url: 'http://localhost:8000',
        debug: false
      });
      expect(consoleLogSpy).toHaveBeenCalledWith('Connected successfully');
    });

    it('should error with missing credentials', async () => {
      await builtin_connect(['http://localhost:8000']);

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Usage:'));
    });

    it('should handle connection errors', async () => {
      mockConnectLogin.mockRejectedValue(new Error('Auth failed'));
      mockLoginRender.mockReturnValue('Connection failed');

      await builtin_connect(['--user', 'chris', '--password', 'wrong', 'http://localhost:8000']);

      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Auth failed'));
    });
  });

  describe('builtin_logout()', () => {
    it('should logout successfully', async () => {
      mockConnectLogout.mockResolvedValue(undefined);
      mockLogoutRender.mockReturnValue('Logged out');

      await builtin_logout();

      expect(mockConnectLogout).toHaveBeenCalled();
      expect(consoleLogSpy).toHaveBeenCalledWith('Logged out');
    });

    it('should handle logout errors', async () => {
      mockConnectLogout.mockRejectedValue(new Error('Logout failed'));
      mockLogoutRender.mockReturnValue('Logout failed');

      await builtin_logout();

      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Logout failed'));
    });
  });

  describe('builtin_plugin()', () => {
    it('should list plugins', async () => {
      mockPluginsFetchList.mockResolvedValue({ plugins: [], selectedFields: [] });
      mockPluginListRender.mockReturnValue('Plugin list');

      await builtin_plugin(['list']);

      expect(mockPluginsFetchList).toHaveBeenCalled();
      expect(consoleLogSpy).toHaveBeenCalledWith('Plugin list');
    });

    it('should run a plugin', async () => {
      mockPluginExecute.mockResolvedValue({ id: 123 });
      mockPluginRunRender.mockReturnValue('Plugin running');

      await builtin_plugin(['run', 'pl-dircopy', '--arg', 'value']);

      expect(mockPluginExecute).toHaveBeenCalledWith('pl-dircopy', '--arg value');
      expect(consoleLogSpy).toHaveBeenCalledWith('Plugin running');
    });

    it('should error when plugin execution fails', async () => {
      mockPluginExecute.mockResolvedValue(null);

      await builtin_plugin(['run', 'pl-dircopy']);

      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('execution failed'));
    });

    it('should delegate unknown subcommands to chili', async () => {
      await builtin_plugin(['delete', 'id:123']);

      expect(mockChiliCommandRun).toHaveBeenCalledWith('plugins', ['-s', 'delete', 'id:123']);
    });

    it('should error with no subcommand', async () => {
      await builtin_plugin([]);

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Usage:'));
    });
  });

  describe('builtin_feed()', () => {
    it('should list feeds', async () => {
      mockFeedsFetchList.mockResolvedValue({ feeds: [], selectedFields: [] });
      mockFeedListRender.mockReturnValue('Feed list');

      await builtin_feed(['list']);

      expect(mockFeedsFetchList).toHaveBeenCalled();
      expect(consoleLogSpy).toHaveBeenCalledWith('Feed list');
    });

    it('should create a feed', async () => {
      mockFeedCreate.mockResolvedValue({ id: 456, name: 'Test Feed' });
      mockFeedCreateRender.mockReturnValue('Feed created');

      await builtin_feed(['create', '--dirs', '/data']);

      expect(mockFeedCreate).toHaveBeenCalled();
      expect(consoleLogSpy).toHaveBeenCalledWith('Feed created');
    });

    it('should delegate unknown subcommands to chili', async () => {
      await builtin_feed(['delete', 'id:456']);

      expect(mockChiliCommandRun).toHaveBeenCalledWith('feeds', ['-s', 'delete', 'id:456']);
    });
  });

  describe('builtin_files(), builtin_links(), builtin_dirs()', () => {
    it('should list files', async () => {
      mockFilesFetchList.mockResolvedValue({ tableData: [{ fname: 'test.txt' }], selectedFields: ['fname'] });

      await builtin_files(['list']);

      expect(mockFilesFetchList).toHaveBeenCalledWith(expect.anything(), 'files', undefined);
      expect(mockTableDisplay).toHaveBeenCalled();
    });

    it('should list fields for files', async () => {
      mockFileFieldsFetch.mockResolvedValue(['fname', 'fsize']);

      await builtin_files(['fieldslist']);

      expect(mockFileFieldsFetch).toHaveBeenCalledWith('files');
      expect(mockTableDisplay).toHaveBeenCalled();
    });

    it('should list links', async () => {
      mockFilesFetchList.mockResolvedValue({ tableData: [], selectedFields: [] });

      await builtin_links(['list']);

      expect(mockFilesFetchList).toHaveBeenCalledWith(expect.anything(), 'links', undefined);
    });

    it('should list dirs', async () => {
      mockFilesFetchList.mockResolvedValue({ tableData: [], selectedFields: [] });

      await builtin_dirs(['list']);

      expect(mockFilesFetchList).toHaveBeenCalledWith(expect.anything(), 'dirs', undefined);
    });

    it('should handle null results', async () => {
      mockFilesFetchList.mockResolvedValue(null);

      await builtin_files(['list']);

      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('No files resources found'));
    });
  });

  describe('builtin_chefs()', () => {
    it('should handle pwd subcommand', async () => {
      mockGetCWD.mockResolvedValue('/home/user/data');

      await builtin_chefs(['pwd']);

      expect(consoleLogSpy).toHaveBeenCalledWith('/home/user/data');
    });

    it('should handle ls subcommand', async () => {
      await builtin_chefs(['ls', '-l']);

      expect(mockVfsList).toHaveBeenCalledWith(undefined, { long: true, human: false });
    });

    it('should handle mkdir subcommand', async () => {
      mockChefsMkdir.mockResolvedValue(true);
      mockMkdirRender.mockReturnValue('Directory created');

      await builtin_chefs(['mkdir', '/tmp/newdir']);

      expect(mockChefsMkdir).toHaveBeenCalledWith('/tmp/newdir');
      expect(consoleLogSpy).toHaveBeenCalledWith('Directory created');
    });

    it('should handle touch subcommand', async () => {
      mockChefsTouch.mockResolvedValue(true);
      mockTouchRender.mockReturnValue('File created');

      await builtin_chefs(['touch', '/tmp/newfile']);

      expect(mockChefsTouch).toHaveBeenCalledWith('/tmp/newfile');
      expect(consoleLogSpy).toHaveBeenCalledWith('File created');
    });

    it('should handle upload subcommand', async () => {
      mockChefsUpload.mockResolvedValue(true);

      await builtin_chefs(['upload', 'local.txt', 'remote.txt']);

      expect(mockChefsUpload).toHaveBeenCalled();
    });

    it('should error on unknown subcommand', async () => {
      await builtin_chefs(['unknown']);

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Unknown chefs subcommand'));
    });
  });

  describe('builtin_cat()', () => {
    it('should display file content', async () => {
      mockChefsCat.mockResolvedValue('file content here');
      mockCatRender.mockReturnValue('rendered content');

      await builtin_cat(['/home/user/test.txt']);

      expect(mockChefsCat).toHaveBeenCalledWith('/home/user/test.txt');
      expect(consoleLogSpy).toHaveBeenCalledWith('rendered content');
    });

    it('should error without file argument', async () => {
      await builtin_cat([]);

      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Usage:'));
    });

    it('should error on /bin files', async () => {
      await builtin_cat(['/bin/pl-dircopy']);

      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Cannot cat plugins'));
    });

    it('should handle cat errors', async () => {
      mockChefsCat.mockRejectedValue(new Error('File not found'));

      await builtin_cat(['/tmp/missing.txt']);

      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('File not found'));
    });
  });

  describe('builtin_rm()', () => {
    it('should remove a single file', async () => {
      mockChefsRm.mockResolvedValue({ success: true });
      mockRmRender.mockReturnValue('Removed');

      await builtin_rm(['/home/user/file.txt']);

      expect(mockChefsRm).toHaveBeenCalledWith('/home/user/file.txt', { recursive: false, force: false });
      expect(consoleLogSpy).toHaveBeenCalledWith('Removed');
    });

    it('should handle -r flag for recursive removal', async () => {
      mockChefsRm.mockResolvedValue({ success: true });

      await builtin_rm(['-r', '/home/user/dir']);

      expect(mockChefsRm).toHaveBeenCalledWith('/home/user/dir', { recursive: true, force: false });
    });

    it('should handle -f flag for force removal', async () => {
      mockChefsRm.mockResolvedValue({ success: true });

      await builtin_rm(['-f', '/home/user/file.txt']);

      expect(mockChefsRm).toHaveBeenCalledWith('/home/user/file.txt', { recursive: false, force: true });
    });

    it('should handle combined -rf flags', async () => {
      mockChefsRm.mockResolvedValue({ success: true });

      await builtin_rm(['-rf', '/home/user/dir']);

      expect(mockChefsRm).toHaveBeenCalledWith('/home/user/dir', { recursive: true, force: true });
    });

    it('should error without path argument', async () => {
      await builtin_rm([]);

      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Usage:'));
    });

    it('should prevent removing /bin directory', async () => {
      await builtin_rm(['/bin/pl-dircopy']);

      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('virtual /bin directory'));
      expect(mockChefsRm).not.toHaveBeenCalled();
    });

    it('should handle removal failures', async () => {
      mockChefsRm.mockResolvedValue({ success: false, error: 'Permission denied' });

      await builtin_rm(['/home/user/file.txt']);

      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Permission denied'));
    });

    it('should handle multiple files', async () => {
      mockChefsRm.mockResolvedValue({ success: true });

      await builtin_rm(['file1.txt', 'file2.txt']);

      expect(mockChefsRm).toHaveBeenCalledTimes(2);
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Successfully removed 2 items'));
    });
  });

  describe('builtin_context()', () => {
    it('should display current context', async () => {
      mockContextGetSingle.mockReturnValue({
        user: 'chris',
        URL: 'http://localhost:8000',
        folder: '/home/chris',
        feed: '123',
        plugin: 'pl-dircopy'
      });

      await builtin_context([]);

      expect(mockTableDisplay).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ Context: 'ChRIS User', Value: 'chris' }),
          expect.objectContaining({ Context: 'ChRIS URL', Value: 'http://localhost:8000' })
        ]),
        ['Context', 'Value'],
        expect.anything()
      );
    });
  });
});
