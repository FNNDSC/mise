import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import type { CommandEnvelope } from '@fnndsc/cumin';

// Mock dependencies BEFORE imports
const mockGetCWD = jest.fn();
const mockSetCWD = jest.fn();
const mockUserGet = jest.fn();
const mockClientGet = jest.fn();
const mockGetFileBrowserFolderByPath = jest.fn();
const mockVfsList = jest.fn(() => ({ status: 'ok', rendered: '' }));
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
const mockTableRender = jest.fn(() => '');
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
const mockPluginFieldsFetch = jest.fn().mockResolvedValue([]);
const mockFeedFieldsFetch = jest.fn().mockResolvedValue([]);
const mockPipelineFieldsFetch = jest.fn().mockResolvedValue([]);
const mockComputeFieldsFetch = jest.fn().mockResolvedValue([]);
const STORE_DEFAULT = 'https://default/api/v1/';
let mockStoreUrl: string | undefined;
const mockStorePersist = jest.fn().mockResolvedValue(undefined);

// Define local Ok, Err, and errorStack for consistent use across mocks and tests
const Ok = (val: any) => ({ ok: true, value: val });
const Err = (err: any) => ({ ok: false, error: err });
const errorStack = { stack_push: jest.fn(), stack_pop: jest.fn() };

// Mock chili utils
jest.unstable_mockModule('@fnndsc/chili/utils', () => ({
  logical_toPhysical: jest.fn().mockResolvedValue({ ok: true, value: '/resolved/path' }),
  pathMapper_get: jest.fn()
}));

// Mock chili screen
jest.unstable_mockModule('@fnndsc/chili/screen/screen.js', () => ({
  table_display: mockTableDisplay,
  table_render: mockTableRender,
  border_draw: jest.fn(),
  screen: { print: jest.fn(), error: jest.fn(), warn: jest.fn() },
}));

// Mock chili path module
jest.unstable_mockModule('@fnndsc/chili/path/pathCommand.js', () => ({
  scan_do: jest.fn().mockResolvedValue({ fileInfo: [], totalSize: 0 }),
  archyTree_create: jest.fn().mockReturnValue('mock tree output'),
}));

// Mock cumin
jest.unstable_mockModule('@fnndsc/cumin', () => ({
  envelope_ok: (rendered: string, model?: unknown) =>
    model === undefined ? { status: 'ok', rendered } : { status: 'ok', rendered, model },
  envelope_error: (rendered: string, errors?: unknown, renderedErr?: string) => {
    const envelope: Record<string, unknown> = { status: 'error', rendered };
    if (errors !== undefined) envelope.errors = errors;
    if (renderedErr !== undefined) envelope.renderedErr = renderedErr;
    return envelope;
  },
  listCache_get: () => ({
    cache_get: jest.fn(),
    cache_set: jest.fn(),
    cache_invalidate: jest.fn(),
    cache_markDirty: jest.fn(),
  }),
  procCache_get: () => ({
    instance_get: jest.fn(),
    lifecycle_get: jest.fn(() => ({ phase: 'empty' })),
    warmupProgress_get: jest.fn(() => ({ loaded: 0, total: 0, active: false })),
    feedIDs_get: jest.fn(() => []),
    feedScopeCounts_get: jest.fn(() => ({ user: 0, public: 0, shared: 0, total: 0 })),
    get warmupComplete(): boolean { return false; },
  }),
  connectionConfig: { debug: false },
  errorStack: errorStack,
  Result: {},
  Ok: Ok,
  Err: Err,
  Context: {
    ChRISuser: 'ChRISuser',
    ChRISurl: 'ChRISurl',
    ChRISfolder: 'ChRISfolder',
    ChRISfeed: 'ChRISfeed',
    ChRISplugin: 'ChRISplugin'
  },
  FilteredResourceData: {},
  SingleContext: {},
  chrisContext: {
    current_get: jest.fn(),
    current_set: jest.fn(),
    currentContext_update: jest.fn()
  },
  keyPairParams_apply: jest.fn((baseParams, keyPair) => baseParams),
  logical_toPhysical: jest.fn().mockResolvedValue({ ok: true, value: '/resolved/path' }),
  pathMapper_get: jest.fn(),
  chrisConnection: {
    client_get: jest.fn(),
    user_get: jest.fn()
  },
  computeResourceNames_parse: jest.fn(),
  computeResources_validate: jest.fn(),
  dictionary_fromCLI: jest.fn().mockReturnValue({}),
  StackMessage: {},
  Client: jest.fn(),
  pacsQueries_create: jest.fn(),
  pacsRetrieve_create: jest.fn(),
  pacsQuery_get: jest.fn(),
  pacsQuery_resultDecode: jest.fn(),
  pacsServers_list: jest.fn(),
  path_isInFeed: jest.fn().mockReturnValue(false),
  path_extractPluginInstanceID: jest.fn().mockReturnValue(null),
  path_extractFeedID: jest.fn().mockReturnValue(null),
  feed_resolve: jest.fn().mockResolvedValue({ ok: false }),
  path_findLatestDircopy: jest.fn().mockReturnValue(null),
  pipeline_resolve: jest.fn().mockResolvedValue({ ok: false }),
  computeResources_getAll: jest.fn().mockResolvedValue({ ok: true, value: [] }),
}));

// Mock session
jest.unstable_mockModule('../src/session/index.js', () => ({
  session: {
    getCWD: mockGetCWD,
    setCWD: mockSetCWD,
    physicalMode_get: jest.fn().mockReturnValue(false),
    timingEnabled_get: jest.fn().mockReturnValue(false),
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
  context_getSingle: mockContextGetSingle,
  procCache_refresh: jest.fn().mockResolvedValue(undefined),
  feedGraphData_ensure: jest.fn(),
  feedGraph_build: jest.fn(),
  files_listAll: jest.fn().mockResolvedValue(null),
  files_copy: jest.fn().mockResolvedValue(true),
  files_copyRecursively: jest.fn().mockResolvedValue(true),
  files_mkdir: jest.fn().mockResolvedValue(true),
  files_touch: jest.fn().mockResolvedValue(true),
  files_uploadPath: jest.fn().mockResolvedValue(true),
  files_delete: jest.fn().mockResolvedValue(true),
  fileContent_get: jest.fn().mockResolvedValue(''),
  files_move: jest.fn().mockResolvedValue(true),
  files_list: jest.fn().mockResolvedValue(null),
  feeds_list: jest.fn().mockResolvedValue(null),
  pluginInstances_list: jest.fn().mockResolvedValue(null),
  plugin_assignToComputeResources: jest.fn(),
  plugin_checkExists: jest.fn(),
  plugin_importFromStore: jest.fn(),
  plugin_registerWithAdmin: jest.fn(),
  plugins_searchPeers: jest.fn(),
  store_list: jest.fn(),
  store_search: jest.fn(),
  vfsDispatcher: {
    provider_get: jest.fn().mockImplementation((path: string) => ({
      prefix: path.startsWith('/net') ? '/net/pacs' : (path.startsWith('/bin') || path.startsWith('/usr')) ? path : ''
    })),
    providers_get: jest.fn().mockReturnValue([
      { prefix: '/net/pacs' },
      { prefix: '/bin' },
      { prefix: '/usr/bin' },
      { prefix: '/etc' },
      { prefix: '/proc/jobs' },
    ]),
    list: jest.fn().mockResolvedValue({ ok: true, value: [] })
  },
  pipelines_list: jest.fn().mockResolvedValue(null),
  pipelines_listAll: jest.fn().mockResolvedValue(null),
  pipelineFields_get: jest.fn().mockResolvedValue(null),
  pipeline_run: jest.fn().mockResolvedValue({ ok: false }),
  pipeline_sourceGet: jest.fn().mockResolvedValue({ ok: false }),
  pipelineDiagram_get: jest.fn().mockResolvedValue({ ok: false }),
  tags_list: jest.fn().mockResolvedValue(null),
  tags_listAll: jest.fn().mockResolvedValue(null),
  tagFields_get: jest.fn().mockResolvedValue(null),
  groups_list: jest.fn().mockResolvedValue(null),
  groups_listAll: jest.fn().mockResolvedValue(null),
  groupFields_get: jest.fn().mockResolvedValue(null),
  pluginMetas_list: jest.fn().mockResolvedValue(null),
  pluginMetas_listAll: jest.fn().mockResolvedValue(null),
  pluginMetaFields_get: jest.fn().mockResolvedValue(null),
  pluginInstances_listAll: jest.fn().mockResolvedValue(null),
  pluginInstanceFields_get: jest.fn().mockResolvedValue(null),
  workflows_list: jest.fn().mockResolvedValue(null),
  workflows_listAll: jest.fn().mockResolvedValue(null),
  workflowFields_get: jest.fn().mockResolvedValue(null),
  feeds_listAll: jest.fn().mockResolvedValue(null),
  feedNote_get: jest.fn().mockResolvedValue({ ok: true, value: { title: '', content: '' } }),
  feedNote_update: jest.fn().mockResolvedValue({ ok: true, value: true }),
  feedComments_list: jest.fn().mockResolvedValue({ ok: true, value: [] }),
  feedComment_create: jest.fn().mockResolvedValue({ ok: true, value: { id: 1, title: '', content: '', owner_username: '' } }),
  feedComment_delete: jest.fn().mockResolvedValue({ ok: true, value: true }),
  feedComment_update: jest.fn().mockResolvedValue({ ok: true, value: true }),
}));

// Mock chili commands
jest.unstable_mockModule('@fnndsc/chili/commands/connect/login.js', () => ({ connect_login: mockConnectLogin }));
jest.unstable_mockModule('@fnndsc/chili/commands/connect/logout.js', () => ({ connect_logout: mockConnectLogout }));
jest.unstable_mockModule('@fnndsc/chili/commands/plugins/list.js', () => ({ plugins_fetchList: mockPluginsFetchList }));
jest.unstable_mockModule('@fnndsc/chili/commands/plugin/run.js', () => ({ plugin_execute: mockPluginExecute }));
jest.unstable_mockModule('@fnndsc/chili/commands/feeds/list.js', () => ({ feeds_fetchList: mockFeedsFetchList }));
jest.unstable_mockModule('@fnndsc/chili/commands/feed/create.js', () => ({ feed_create: mockFeedCreate }));
jest.unstable_mockModule('@fnndsc/chili/commands/files/list.js', () => ({ files_fetchList: mockFilesFetchList }));
jest.unstable_mockModule('@fnndsc/chili/commands/files/fields.js', () => ({ fileFields_fetch: mockFileFieldsFetch }));
jest.unstable_mockModule('@fnndsc/chili/commands/plugins/fields.js', () => ({ pluginFields_fetch: mockPluginFieldsFetch }));
jest.unstable_mockModule('@fnndsc/chili/commands/feeds/fields.js', () => ({ feedFields_fetch: mockFeedFieldsFetch }));
jest.unstable_mockModule('@fnndsc/chili/commands/pipeline/fields.js', () => ({ pipelineFields_fetch: mockPipelineFieldsFetch }));
jest.unstable_mockModule('@fnndsc/chili/commands/compute/fields.js', () => ({ computeFields_fetch: mockComputeFieldsFetch }));
jest.unstable_mockModule('../src/config/storeConfig.js', () => ({
  DEFAULT_STORE_URL: STORE_DEFAULT,
  storeUrl_get: (): string => mockStoreUrl ?? STORE_DEFAULT,
  storeUrl_isDefault: (): boolean => mockStoreUrl === undefined,
  storeUrl_set: (url: string): void => { mockStoreUrl = url; },
  storeUrl_clear: (): void => { mockStoreUrl = undefined; },
  storeConfig_persist: mockStorePersist,
}));
jest.unstable_mockModule('@fnndsc/chili/commands/tags/list.js', () => ({ tags_fetchList: jest.fn().mockResolvedValue({ tags: [], selectedFields: [] }) }));
jest.unstable_mockModule('@fnndsc/chili/commands/tags/fields.js', () => ({ tagFields_fetch: jest.fn().mockResolvedValue([]) }));
jest.unstable_mockModule('@fnndsc/chili/commands/groups/list.js', () => ({ groups_fetchList: jest.fn().mockResolvedValue({ groups: [], selectedFields: [] }) }));
jest.unstable_mockModule('@fnndsc/chili/commands/groups/fields.js', () => ({ groupFields_fetch: jest.fn().mockResolvedValue([]) }));
jest.unstable_mockModule('@fnndsc/chili/commands/pluginmetas/list.js', () => ({ pluginMetas_fetchList: jest.fn().mockResolvedValue({ pluginMetas: [], selectedFields: [] }) }));
jest.unstable_mockModule('@fnndsc/chili/commands/pluginmetas/fields.js', () => ({ pluginMetaFields_fetch: jest.fn().mockResolvedValue([]) }));
jest.unstable_mockModule('@fnndsc/chili/commands/plugininstances/list.js', () => ({ pluginInstances_fetchList: jest.fn().mockResolvedValue({ pluginInstances: [], selectedFields: [] }) }));
jest.unstable_mockModule('@fnndsc/chili/commands/plugininstances/fields.js', () => ({ pluginInstanceFields_fetch: jest.fn().mockResolvedValue([]) }));
jest.unstable_mockModule('@fnndsc/chili/commands/workflows/list.js', () => ({ workflows_fetchList: jest.fn().mockResolvedValue({ workflows: [], selectedFields: [] }) }));
jest.unstable_mockModule('@fnndsc/chili/commands/workflows/fields.js', () => ({ workflowFields_fetch: jest.fn().mockResolvedValue([]) }));
jest.unstable_mockModule('@fnndsc/chili/commands/fs/mkdir.js', () => ({ files_mkdir: mockChefsMkdir }));
jest.unstable_mockModule('@fnndsc/chili/commands/fs/touch.js', () => ({ files_touch: mockChefsTouch }));
jest.unstable_mockModule('@fnndsc/chili/commands/fs/upload.js', () => ({ 
  files_upload: mockChefsUpload, 
  files_uploadWithProgress: mockChefsUpload,
  bytes_format: (n: number) => `${n} B`
}));
jest.unstable_mockModule('@fnndsc/chili/commands/fs/cat.js', () => ({
  files_cat: mockChefsCat,
  files_catBinary: jest.fn()
}));
jest.unstable_mockModule('@fnndsc/chili/commands/fs/rm.js', () => ({ files_rm: mockChefsRm, RmOptions: {}, RmResult: {} }));
jest.unstable_mockModule('@fnndsc/chili/commands/fs/cp.js', () => ({ files_cp: jest.fn() }));
jest.unstable_mockModule('@fnndsc/chili/commands/fs/mv.js', () => ({ files_mv: jest.fn() }));
jest.unstable_mockModule('@fnndsc/chili/commands/fs/download.js', () => ({
  files_downloadWithProgress: jest.fn().mockResolvedValue({
    transferredCount: 1,
    failedCount: 0,
    transferSize: 1024,
    duration: 1,
    speed: 1024,
    totalFiles: 1,
    endTime: Date.now(),
    startTime: Date.now(),
  }),
  bytes_format: (n: number) => `${n} B`,
}));

// Mock chili views
jest.unstable_mockModule('@fnndsc/chili/views/plugin.js', () => ({ pluginList_render: mockPluginListRender, pluginRun_render: mockPluginRunRender }));
jest.unstable_mockModule('@fnndsc/chili/views/feed.js', () => ({
  feedList_render: mockFeedListRender,
  feedCreate_render: mockFeedCreateRender,
  feedNote_render: jest.fn().mockReturnValue(''),
  feedComments_render: jest.fn().mockReturnValue(''),
}));
jest.unstable_mockModule('@fnndsc/chili/views/connect.js', () => ({ login_render: mockLoginRender, logout_render: mockLogoutRender }));
jest.unstable_mockModule('@fnndsc/chili/views/fs.js', () => ({
  mkdir_render: mockMkdirRender,
  touch_render: mockTouchRender,
  upload_render: mockUploadRender,
  cat_render: mockCatRender,
  rm_render: mockRmRender,
  cp_render: mockRmRender,
  mv_render: mockRmRender
}));

// Mock parametersofplugin
jest.unstable_mockModule('../src/builtins/parametersofplugin.js', () => ({
  builtin_parametersofplugin: jest.fn()
}));

// Mock chell
jest.unstable_mockModule('../src/core/chiliDelegate.js', () => ({
  chiliCommand_run: mockChiliCommandRun
}));

// Mock console
const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

// Import module under test
const {
  path_resolve,
  builtin_cd,
  builtin_pwd,
  builtin_ls,
  builtin_upload,
  builtin_download,
  builtin_connect,
  builtin_logout,
  builtin_plugin,
  builtin_feed,
  builtin_files,
  builtin_links,
  builtin_dirs,
  builtin_cat,
  builtin_rm,
  builtin_context,
  builtin_tag,
  builtin_group,
  builtin_pluginmeta,
  builtin_plugininstance,
  builtin_workflow,
} = await import('../src/builtins/index.js');

afterEach(() => {
  process.exitCode = 0;
});

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
    it('should report the current working directory in its envelope', async () => {
      mockGetCWD.mockResolvedValue('/home/user/data');

      const envelope: CommandEnvelope = await builtin_pwd();

      expect(envelope.status).toBe('ok');
      expect(envelope.rendered).toBe('/home/user/data\n');
    });
  });

  describe('builtin_cd()', () => {
    it('should change to home directory when no args', async () => {
      mockUserGet.mockResolvedValue('testuser');
      mockClientGet.mockResolvedValue({ getFileBrowserFolderByPath: mockGetFileBrowserFolderByPath });
      mockGetFileBrowserFolderByPath.mockResolvedValue({ path: '/resolved/path' });

      await builtin_cd([]);

      expect(mockSetCWD).toHaveBeenCalledWith('/home/testuser');
    });

    it('should change to virtual /bin directory', async () => {
      await builtin_cd(['/bin']);

      expect(mockSetCWD).toHaveBeenCalledWith('/bin');
    });

    it('should change to valid ChRIS directory', async () => {
      mockClientGet.mockResolvedValue({ getFileBrowserFolderByPath: mockGetFileBrowserFolderByPath });
      mockGetFileBrowserFolderByPath.mockResolvedValue({ path: '/resolved/path' });

      await builtin_cd(['/home/user/data']);

      expect(mockSetCWD).toHaveBeenCalledWith('/home/user/data');
    });

    it('should error on non-existent directory', async () => {
      mockClientGet.mockResolvedValue({ getFileBrowserFolderByPath: mockGetFileBrowserFolderByPath });
      mockGetFileBrowserFolderByPath.mockResolvedValue(null);

      const envelope: CommandEnvelope = await builtin_cd(['/nonexistent']);

      expect(envelope.status).toBe('error');
      expect(envelope.renderedErr).toContain('No such file or directory');
      expect(mockSetCWD).not.toHaveBeenCalled();
    });

    it('should error on mismatched directory path (prevent substring matches)', async () => {
      mockClientGet.mockResolvedValue({ getFileBrowserFolderByPath: mockGetFileBrowserFolderByPath });
      mockGetFileBrowserFolderByPath.mockResolvedValue({ path: '/SHARED/entry' });

      const envelope: CommandEnvelope = await builtin_cd(['/ent']);

      expect(envelope.status).toBe('error');
      expect(envelope.renderedErr).toContain('No such file or directory');
      expect(mockSetCWD).not.toHaveBeenCalled();
    });

    it('should error when not connected', async () => {
      mockClientGet.mockResolvedValue(null);

      const envelope: CommandEnvelope = await builtin_cd(['/home/user']);

      expect(envelope.status).toBe('error');
      expect(envelope.renderedErr).toContain('Not connected');
    });
  });

  describe('builtin_ls()', () => {
    it('should list current directory when no args', async () => {
      await builtin_ls([]);

      expect(mockVfsList).toHaveBeenCalledWith(undefined, { long: false, human: false, sort: 'name', reverse: false, directory: false, oneColumn: false });
    });

    it('should list specified path', async () => {
      mockGetCWD.mockResolvedValue('/home/user');

      await builtin_ls(['/tmp']);

      expect(mockVfsList).toHaveBeenCalledWith('/tmp', { long: false, human: false, sort: 'name', reverse: false, directory: false, oneColumn: false });
    });

    it('should handle -l flag for long format', async () => {
      await builtin_ls(['-l']);

      expect(mockVfsList).toHaveBeenCalledWith(undefined, { long: true, human: false, sort: 'name', reverse: false, directory: false, oneColumn: false });
    });

    it('should handle -h flag for human-readable sizes', async () => {
      await builtin_ls(['-l', '-h']);

      expect(mockVfsList).toHaveBeenCalledWith(undefined, { long: true, human: true, sort: 'name', reverse: false, directory: false, oneColumn: false });
    });

    it('should list multiple operands independently', async () => {
      await builtin_ls(['file1.txt', 'file2.txt']);

      expect(mockVfsList).toHaveBeenNthCalledWith(1, '/home/user/file1.txt', { long: false, human: false, sort: 'name', reverse: false, directory: false, oneColumn: false });
      expect(mockVfsList).toHaveBeenNthCalledWith(2, '/home/user/file2.txt', { long: false, human: false, sort: 'name', reverse: false, directory: false, oneColumn: false });
    });

    it('should handle --sort flag with size option', async () => {
      await builtin_ls(['--sort', 'size']);

      expect(mockVfsList).toHaveBeenCalledWith(undefined, { long: false, human: false, sort: 'size', reverse: false, directory: false, oneColumn: false });
    });

    it('should handle --sort flag with date option', async () => {
      await builtin_ls(['--sort', 'date']);

      expect(mockVfsList).toHaveBeenCalledWith(undefined, { long: false, human: false, sort: 'date', reverse: false, directory: false, oneColumn: false });
    });

    it('should handle --sort flag with owner option', async () => {
      await builtin_ls(['--sort', 'owner']);

      expect(mockVfsList).toHaveBeenCalledWith(undefined, { long: false, human: false, sort: 'owner', reverse: false, directory: false, oneColumn: false });
    });

    it('should handle --reverse flag', async () => {
      await builtin_ls(['--reverse']);

      expect(mockVfsList).toHaveBeenCalledWith(undefined, { long: false, human: false, sort: 'name', reverse: true, directory: false, oneColumn: false });
    });

    it('should handle -r flag for reverse', async () => {
      await builtin_ls(['-r']);

      expect(mockVfsList).toHaveBeenCalledWith(undefined, { long: false, human: false, sort: 'name', reverse: true, directory: false, oneColumn: false });
    });

    it('should handle combined --sort and --reverse flags', async () => {
      await builtin_ls(['--sort', 'size', '--reverse']);

      expect(mockVfsList).toHaveBeenCalledWith(undefined, { long: false, human: false, sort: 'size', reverse: true, directory: false, oneColumn: false });
    });

    it('should handle combined -l, --sort, and --reverse flags', async () => {
      await builtin_ls(['-l', '--sort', 'date', '--reverse']);

      expect(mockVfsList).toHaveBeenCalledWith(undefined, { long: true, human: false, sort: 'date', reverse: true, directory: false, oneColumn: false });
    });
  });

  describe('builtin_upload()', () => {
    it('should upload file to remote path', async () => {
      mockGetCWD.mockResolvedValue('/home/user');
      mockChefsUpload.mockResolvedValue({
        startTime: 0,
        endTime: 1,
        totalFiles: 1,
        transferredCount: 1,
        failedCount: 0,
        transferSize: 1024,
        duration: 1,
        speed: 1024,
        actualTargetPath: '/home/user/remote.txt',
      });

      const envelope = await builtin_upload(['./local.txt', 'remote.txt']);

      expect(mockChefsUpload).toHaveBeenCalledWith('./local.txt', '/home/user/remote.txt', expect.objectContaining({
        onProgress: expect.any(Function),
      }));
      expect(envelope.rendered).toContain('Successfully uploaded 1 file');
    });

    it('should error with insufficient args', async () => {
      const envelope = await builtin_upload(['local.txt']);

      expect(envelope.rendered).toContain('Usage:');
    });

    it('should handle upload errors', async () => {
      mockChefsUpload.mockRejectedValue(new Error('Network error'));

      const envelope = await builtin_upload(['local.txt', 'remote.txt']);

      expect(envelope.renderedErr).toContain('Upload error: Network error');
    });
  });

  describe('builtin_download()', () => {
    it('should show usage with insufficient args', async () => {
      const envelope = await builtin_download(['remote.txt']);

      expect(envelope.rendered).toContain('Usage: download');
    });

    it('should invoke chili download helper', async () => {
      const downloadModule = await import('@fnndsc/chili/commands/fs/download.js');
      const mockDownload = downloadModule.files_downloadWithProgress as jest.Mock;

      await builtin_download(['/remote/file.txt', './local.txt']);

      expect(mockDownload).toHaveBeenCalledWith('/remote/file.txt', expect.stringContaining('local.txt'), expect.objectContaining({
        force: false,
        onProgress: expect.any(Function),
      }));
    });
  });

  describe('builtin_connect()', () => {
    it('should connect with valid credentials', async () => {
      mockConnectLogin.mockResolvedValue(true);
      mockLoginRender.mockReturnValue('Connected successfully');

      const envelope = await builtin_connect(['--user', 'chris', '--password', 'chris1234', 'http://localhost:8000']);

      expect(mockConnectLogin).toHaveBeenCalledWith({
        user: 'chris',
        password: 'chris1234',
        url: 'http://localhost:8000',
        debug: false
      });
      expect(envelope.rendered).toContain('Connected successfully');
    });

    it('should error with missing credentials', async () => {
      const envelope = await builtin_connect(['http://localhost:8000']);

      expect(envelope.rendered).toContain('Usage:');
    });

    it('should handle connection errors', async () => {
      mockConnectLogin.mockRejectedValue(new Error('Auth failed'));
      mockLoginRender.mockReturnValue('Connection failed');

      const envelope = await builtin_connect(['--user', 'chris', '--password', 'wrong', 'http://localhost:8000']);

      expect(envelope.renderedErr).toContain('Auth failed');
    });
  });

  describe('builtin_logout()', () => {
    it('should logout successfully', async () => {
      mockConnectLogout.mockResolvedValue(undefined);
      mockLogoutRender.mockReturnValue('Logged out');

      const envelope = await builtin_logout();

      expect(mockConnectLogout).toHaveBeenCalled();
      expect(envelope.rendered).toContain('Logged out');
    });

    it('should handle logout errors', async () => {
      mockConnectLogout.mockRejectedValue(new Error('Logout failed'));
      mockLogoutRender.mockReturnValue('Logout failed');

      const envelope = await builtin_logout();

      expect(envelope.renderedErr).toContain('Logout failed');
    });
  });

  describe('builtin_plugin()', () => {
    it('should list plugins', async () => {
      mockPluginsFetchList.mockResolvedValue({ plugins: [], selectedFields: [] });
      mockPluginListRender.mockReturnValue('Plugin list');

      const envelope = await builtin_plugin(['list']);

      expect(mockPluginsFetchList).toHaveBeenCalled();
      expect(envelope.rendered).toContain('Plugin list');
    });

    it('should run a plugin', async () => {
      mockPluginExecute.mockResolvedValue({ id: 123 });
      mockPluginRunRender.mockReturnValue('Plugin running');

      const envelope = await builtin_plugin(['run', 'pl-dircopy', '--arg', 'value']);

      expect(mockPluginExecute).toHaveBeenCalledWith('pl-dircopy', '--arg value');
      expect(envelope.rendered).toContain('Plugin running');
    });

    it('should error when plugin execution fails', async () => {
      mockPluginExecute.mockResolvedValue(null);

      const envelope = await builtin_plugin(['run', 'pl-dircopy']);

      expect(envelope.renderedErr).toContain('execution failed');
    });

    it('should return an error envelope for unknown subcommands', async () => {
      const envelope = await builtin_plugin(['delete', 'id:123']);

      expect(mockChiliCommandRun).not.toHaveBeenCalled();
      expect(envelope.renderedErr).toContain('Unknown subcommand');
    });

    it('should error with no subcommand', async () => {
      const envelope = await builtin_plugin([]);

      expect(envelope.rendered).toContain('Usage:');
    });
  });

  describe('builtin_feed()', () => {
    it('should list feeds', async () => {
      mockFeedsFetchList.mockResolvedValue({ feeds: [], selectedFields: [] });
      mockFeedListRender.mockReturnValue('Feed list');

      const envelope = await builtin_feed(['list']);

      expect(mockFeedsFetchList).toHaveBeenCalled();
      expect(envelope.rendered).toContain('Feed list');
    });

    it('should create a feed', async () => {
      mockFeedCreate.mockResolvedValue({ id: 456, name: 'Test Feed' });
      mockFeedCreateRender.mockReturnValue('Feed created');

      const envelope = await builtin_feed(['create', '--dirs', '/data']);

      expect(mockFeedCreate).toHaveBeenCalled();
      expect(envelope.rendered).toContain('Feed created');
    });

    it('should return an error envelope for unknown subcommands', async () => {
      const envelope = await builtin_feed(['delete', 'id:456']);

      expect(mockChiliCommandRun).not.toHaveBeenCalled();
      expect(envelope.renderedErr).toContain('Unknown subcommand');
    });
  });

  describe('builtin_files(), builtin_links(), builtin_dirs()', () => {
    it('should list files', async () => {
      mockFilesFetchList.mockResolvedValue({ tableData: [{ fname: 'test.txt' }], selectedFields: ['fname'] });

      await builtin_files(['list']);

      expect(mockFilesFetchList).toHaveBeenCalledWith(expect.anything(), 'files', undefined);
      expect(mockTableRender).toHaveBeenCalled();
    });

    it('should list fields for files', async () => {
      mockFileFieldsFetch.mockResolvedValue(['fname', 'fsize']);

      await builtin_files(['fieldslist']);

      expect(mockFileFieldsFetch).toHaveBeenCalledWith('files');
      expect(mockTableRender).toHaveBeenCalled();
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

      const envelope = await builtin_files(['list']);

      expect(envelope.renderedErr).toContain('No files resources found');
    });
  });

  describe('builtin_cat()', () => {
    it('should display file content', async () => {
      mockChefsCat.mockResolvedValue(Ok('file content here'));
      mockCatRender.mockReturnValue('rendered content');

      const envelope: CommandEnvelope = await builtin_cat(['/home/user/test.txt']);

      expect(mockChefsCat).toHaveBeenCalledWith('/home/user/test.txt');
      expect(envelope.rendered).toContain('rendered content');
      expect(envelope.model?.kind).toBe('fs.cat');
    });

    it('should error without file argument', async () => {
      const envelope: CommandEnvelope = await builtin_cat([]);

      expect(envelope.status).toBe('error');
      expect(envelope.renderedErr).toContain('Usage:');
    });

    it('should error on /bin files', async () => {
      mockChefsCat.mockResolvedValueOnce(Err(new Error('Cannot cat plugins')));
      errorStack.stack_pop.mockReturnValueOnce({ type: 'error', message: 'Cannot cat plugins yet: pl-dircopy' });

      const envelope: CommandEnvelope = await builtin_cat(['/bin/pl-dircopy']);

      expect(envelope.status).toBe('error');
      expect(envelope.renderedErr).toContain('Cannot cat plugins');
    });

    it('should handle cat errors', async () => {
      mockChefsCat.mockResolvedValue(Err(new Error('File not found')));
      errorStack.stack_pop.mockReturnValueOnce({ type: 'error', message: 'File not found' });

      const envelope: CommandEnvelope = await builtin_cat(['/tmp/missing.txt']);

      expect(envelope.status).toBe('error');
      expect(envelope.renderedErr).toContain('File not found');
    });
  });

  describe('builtin_rm()', () => {
    it('should remove a single file', async () => {
      mockChefsRm.mockResolvedValue({ success: true });
      mockRmRender.mockReturnValue('Removed');

      const envelope: CommandEnvelope = await builtin_rm(['/home/user/file.txt']);

      expect(mockChefsRm).toHaveBeenCalledWith('/home/user/file.txt', { recursive: false, force: false });
      expect(envelope.rendered).toContain('Removed');
      expect(envelope.model?.kind).toBe('fs.rm');
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
      const envelope: CommandEnvelope = await builtin_rm([]);

      expect(envelope.status).toBe('error');
      expect(envelope.renderedErr).toContain('Usage:');
    });

    it('should prevent removing /bin directory', async () => {
      const envelope: CommandEnvelope = await builtin_rm(['/bin/pl-dircopy']);

      expect(envelope.status).toBe('error');
      expect(envelope.renderedErr).toContain('virtual /bin directory');
      expect(mockChefsRm).not.toHaveBeenCalled();
    });

    it('should handle removal failures', async () => {
      mockChefsRm.mockResolvedValue({ success: false, error: 'Permission denied' });

      const envelope: CommandEnvelope = await builtin_rm(['/home/user/file.txt']);

      expect(envelope.status).toBe('error');
      expect(envelope.renderedErr).toContain('Permission denied');
    });

    it('should handle multiple files', async () => {
      mockChefsRm.mockResolvedValue({ success: true });

      const envelope: CommandEnvelope = await builtin_rm(['file1.txt', 'file2.txt']);

      expect(mockChefsRm).toHaveBeenCalledTimes(2);
      expect(envelope.rendered).toContain('Successfully removed 2 items');
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

      expect(mockTableRender).toHaveBeenCalledWith(
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

describe('Builtins - Subcommand dispatch', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockStoreUrl = undefined;
  });

  describe('builtin_plugin', () => {
    it('inspect calls pluginFields_fetch', async () => {
      await builtin_plugin(['inspect']);
      expect(mockPluginFieldsFetch).toHaveBeenCalled();
    });

    it('inspect does not fall through to chili', async () => {
      await builtin_plugin(['inspect']);
      expect(mockChiliCommandRun).not.toHaveBeenCalled();
    });

    it('search delegates to list with --search', async () => {
      await builtin_plugin(['search', 'dircopy']);
      expect(mockPluginsFetchList).toHaveBeenCalled();
      expect(mockChiliCommandRun).not.toHaveBeenCalled();
    });
  });

  describe('builtin_feed', () => {
    it('inspect calls feedFields_fetch', async () => {
      await builtin_feed(['inspect']);
      expect(mockFeedFieldsFetch).toHaveBeenCalled();
    });

    it('inspect does not fall through to chili', async () => {
      await builtin_feed(['inspect']);
      expect(mockChiliCommandRun).not.toHaveBeenCalled();
    });

    it('search delegates to list with --search', async () => {
      await builtin_feed(['search', 'brain']);
      expect(mockFeedsFetchList).toHaveBeenCalled();
      expect(mockChiliCommandRun).not.toHaveBeenCalled();
    });
  });

  describe('builtin_files/links/dirs', () => {
    it('files inspect calls fileFields_fetch', async () => {
      await builtin_files(['inspect']);
      expect(mockFileFieldsFetch).toHaveBeenCalled();
    });

    it('files inspect does not fall through to chili', async () => {
      await builtin_files(['inspect']);
      expect(mockChiliCommandRun).not.toHaveBeenCalled();
    });

    it('links inspect calls fileFields_fetch', async () => {
      await builtin_links(['inspect']);
      expect(mockFileFieldsFetch).toHaveBeenCalled();
    });

    it('dirs inspect calls fileFields_fetch', async () => {
      await builtin_dirs(['inspect']);
      expect(mockFileFieldsFetch).toHaveBeenCalled();
    });
  });

  describe('store subcommands', () => {
    it('inspect renders the store URL without chili', async () => {
      const envelope = await (await import('../src/builtins/store.js')).builtin_store(['inspect']);
      expect(envelope.rendered).toContain('Peer store URL');
      expect(mockChiliCommandRun).not.toHaveBeenCalled();
    });

    it('set saves the store URL through the engine store config', async () => {
      await (await import('../src/builtins/store.js')).builtin_store(['set', 'https://my-store.org/api/v1/']);
      expect(mockStoreUrl).toBe('https://my-store.org/api/v1/');
      expect(mockStorePersist).toHaveBeenCalled();
    });

    it('reset clears the store URL through the engine store config', async () => {
      mockStoreUrl = 'https://custom.org/api/v1/';
      await (await import('../src/builtins/store.js')).builtin_store(['reset']);
      expect(mockStoreUrl).toBeUndefined();
      expect(mockStorePersist).toHaveBeenCalled();
    });
  });
});
