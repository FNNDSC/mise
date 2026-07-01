/**
 * Boundary-only tests for salsa files/index. Real Result/errorStack; stubbed
 * cumin objContext_create/chrisContext/chrisIO, the content helpers and the
 * vfs dispatcher. The module's own logic (resolution, dispatch, recursion) runs.
 */
const mockObjCreate = jest.fn();
const mockCtxGet = jest.fn();
const mockIO = {
  file_upload: jest.fn(),
  file_download: jest.fn(),
  folder_create: jest.fn(),
  folder_moveByPath: jest.fn(),
  file_moveById: jest.fn(),
  uploadLocalPath: jest.fn(),
};
const mockPipeline = { fileContent_getPipeline: jest.fn(), fileContent_getPipelineBinary: jest.fn() };
const mockRegular = {
  fileContent_getRegular: jest.fn(),
  fileContent_getRegularBinary: jest.fn(),
  fileContent_getRegularStream: jest.fn(),
};
const mockPacs = { fileContent_getPACS: jest.fn(), fileContent_getPACSBinary: jest.fn() };
const mockDispatcher = { provider_get: jest.fn(), read: jest.fn(), readBinary: jest.fn() };

jest.mock('@fnndsc/cumin', () => ({
  ...jest.requireActual('@fnndsc/cumin'),
  objContext_create: mockObjCreate,
  chrisContext: { current_get: mockCtxGet },
  chrisIO: mockIO,
}));
jest.mock('../src/files/pipeline_content', () => mockPipeline);
jest.mock('../src/files/regular_content', () => mockRegular);
jest.mock('../src/files/pacs_content', () => mockPacs);
jest.mock('../src/vfs/dispatcher', () => ({ vfsDispatcher: mockDispatcher }));

import { Ok, Err, errorStack } from '@fnndsc/cumin';
import {
  files_getGroup,
  files_getSingle,
  files_listRecursive,
  files_copyRecursively,
  files_list,
  files_listAll,
  fileFields_get,
  files_delete,
  files_create,
  files_touch,
  files_mkdir,
  files_uploadPath,
  files_share,
  files_copy,
  files_move,
  fileContent_get,
  fileContent_getBinary,
  fileContent_getBinaryStream,
} from '../src/files/index';

/** A fake embedded resource group with the asset methods the module calls. */
function group(asset: Record<string, unknown>): unknown {
  return { asset };
}

beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

beforeEach(() => {
  jest.clearAllMocks();
  errorStack.stack_clear();
});

describe('files_getGroup', () => {
  it.each([
    ['files', 'ChRISFilesContext'],
    ['links', 'ChRISLinksContext'],
    ['dirs', 'ChRISDirsContext'],
  ])('creates the %s context', async (asset, ctxName) => {
    mockObjCreate.mockResolvedValue(group({}));
    await files_getGroup(asset, '/p');
    expect(mockObjCreate).toHaveBeenCalledWith(ctxName, 'folder:/p');
  });

  it('defaults the path to the current folder context', async () => {
    mockCtxGet.mockResolvedValue('/home/chris');
    mockObjCreate.mockResolvedValue(group({}));
    await files_getGroup('files');
    expect(mockObjCreate).toHaveBeenCalledWith('ChRISFilesContext', 'folder:/home/chris');
  });

  it('defaults to "/" when no context is set', async () => {
    mockCtxGet.mockResolvedValue(null);
    mockObjCreate.mockResolvedValue(group({}));
    await files_getGroup('files');
    expect(mockObjCreate).toHaveBeenCalledWith('ChRISFilesContext', 'folder:/');
  });

  it('returns null for an unsupported asset type', async () => {
    expect(await files_getGroup('bogus', '/p')).toBeNull();
  });

  it('returns null when creation throws', async () => {
    mockObjCreate.mockRejectedValue(new Error('x'));
    expect(await files_getGroup('files', '/p')).toBeNull();
  });

  it('returns null when creation yields nothing', async () => {
    mockObjCreate.mockResolvedValue(null);
    expect(await files_getGroup('files', '/p')).toBeNull();
  });
});

describe('list / fields / delete delegate to the group asset', () => {
  it('files_list', async () => {
    mockObjCreate.mockResolvedValue(group({ resources_listAndFilterByOptions: jest.fn().mockResolvedValue('L') }));
    expect(await files_list({ limit: 1 } as never, 'files', '/p')).toBe('L');
  });
  it('files_list returns null when the group is unavailable', async () => {
    mockObjCreate.mockResolvedValue(null);
    expect(await files_list({} as never, 'files', '/p')).toBeNull();
  });
  it('files_listAll', async () => {
    mockObjCreate.mockResolvedValue(group({ resources_getAll: jest.fn().mockResolvedValue('A') }));
    expect(await files_listAll({} as never, 'files', '/p')).toBe('A');
  });
  it('fileFields_get returns fields, or null', async () => {
    mockObjCreate.mockResolvedValue(group({ resourceFields_get: jest.fn().mockResolvedValue({ fields: ['a'] }) }));
    expect(await fileFields_get('files')).toEqual(['a']);
    mockObjCreate.mockResolvedValue(group({ resourceFields_get: jest.fn().mockResolvedValue(null) }));
    expect(await fileFields_get('files')).toBeNull();
  });
  it('files_delete', async () => {
    mockObjCreate.mockResolvedValue(group({ resourceItem_delete: jest.fn().mockResolvedValue(true) }));
    expect(await files_delete(3, 'files')).toBe(true);
    mockObjCreate.mockResolvedValue(null);
    expect(await files_delete(3, 'files')).toBe(false);
  });
});

describe('files_getSingle', () => {
  it('creates a single-file context', async () => {
    mockObjCreate.mockResolvedValue(group({}));
    expect(await files_getSingle('/a/f.txt')).not.toBeNull();
  });
  it('returns null when creation throws', async () => {
    mockObjCreate.mockRejectedValue(new Error('x'));
    expect(await files_getSingle('/a/f.txt')).toBeNull();
  });
});

describe('files_create / touch', () => {
  it('uploads string content', async () => {
    mockIO.file_upload.mockResolvedValue(true);
    expect(await files_create('hello', '/a/f.txt')).toBe(true);
    expect(mockIO.file_upload).toHaveBeenCalledWith(expect.any(Blob), '/a', 'f.txt');
  });
  it('uploads Buffer content', async () => {
    mockIO.file_upload.mockResolvedValue(true);
    expect(await files_create(Buffer.from('x'), '/a/f.bin')).toBe(true);
  });
  it('records an error when upload fails', async () => {
    mockIO.file_upload.mockResolvedValue(false);
    expect(await files_create('x', '/a/f.txt')).toBe(false);
    expect(errorStack.stack_search('upload failed').length).toBeGreaterThan(0);
  });
  it('returns false when upload throws', async () => {
    mockIO.file_upload.mockRejectedValue(new Error('io'));
    expect(await files_create('x', '/a/f.txt')).toBe(false);
  });
  it('files_touch creates an empty file by default', async () => {
    mockIO.file_upload.mockResolvedValue(true);
    expect(await files_touch('/a/empty')).toBe(true);
  });
});

describe('files_mkdir / uploadPath / share', () => {
  it('mkdir returns true on success (created or already-exists)', async () => {
    mockIO.folder_create.mockResolvedValue(Ok(true));
    expect(await files_mkdir('/a/dir')).toBe(true);
  });
  it('mkdir returns false on failure', async () => {
    mockIO.folder_create.mockResolvedValue(Err());
    expect(await files_mkdir('/a/dir')).toBe(false);
  });
  it('uploadPath delegates to chrisIO', async () => {
    mockIO.uploadLocalPath.mockResolvedValue(true);
    expect(await files_uploadPath('/local', '/remote')).toBe(true);
  });
  it('share returns true', async () => {
    expect(await files_share(1, { is_public: true })).toBe(true);
  });
});

describe('files_copy', () => {
  function filesGroupWith(rows: unknown[]): void {
    mockObjCreate.mockResolvedValue(group({ resources_getAll: jest.fn().mockResolvedValue({ tableData: rows }) }));
  }

  it('resolves, downloads and re-uploads a file', async () => {
    filesGroupWith([{ id: 1, fname: '/a/f.txt' }]);
    mockIO.file_download.mockResolvedValue(Buffer.from('data'));
    mockIO.file_upload.mockResolvedValue(true);
    expect(await files_copy('/a/f.txt', '/b/f.txt')).toBe(true);
    expect(mockIO.file_download).toHaveBeenCalledWith(1);
  });

  it('fails when the source file is not found', async () => {
    filesGroupWith([{ id: 1, fname: '/a/other.txt' }]);
    expect(await files_copy('/a/f.txt', '/b/f.txt')).toBe(false);
  });

  it('fails when download returns null', async () => {
    filesGroupWith([{ id: 1, fname: '/a/f.txt' }]);
    mockIO.file_download.mockResolvedValue(null);
    expect(await files_copy('/a/f.txt', '/b/f.txt')).toBe(false);
  });
});

describe('files_move', () => {
  it('renames a directory server-side', async () => {
    // path_isDir(src) true -> dirs listing contains src; dest not a dir
    mockObjCreate.mockImplementation(async (_ctx: string) =>
      group({ resources_getAll: jest.fn().mockResolvedValue({ tableData: [{ path: '/a/dir' }] }) })
    );
    mockIO.folder_moveByPath.mockResolvedValue(Ok(true));
    expect(await files_move('/a/dir', '/b/newdir')).toBe(true);
    expect(mockIO.folder_moveByPath).toHaveBeenCalled();
  });

  it('moves a file by id when source is not a directory', async () => {
    // dirs listing empty -> src not dir; files listing has the file for id resolve
    mockObjCreate.mockImplementation(async (ctx: string) => {
      if (ctx === 'ChRISDirsContext') return group({ resources_getAll: jest.fn().mockResolvedValue({ tableData: [] }) });
      return group({ resources_getAll: jest.fn().mockResolvedValue({ tableData: [{ id: 9, fname: '/a/f.txt' }] }) });
    });
    mockIO.file_moveById.mockResolvedValue(Ok(true));
    expect(await files_move('/a/f.txt', '/b/g.txt')).toBe(true);
    expect(mockIO.file_moveById).toHaveBeenCalledWith(9, '/b/g.txt');
  });
});

describe('fileContent_get routing', () => {
  it('routes to the dispatcher for a matched provider', async () => {
    mockDispatcher.provider_get.mockReturnValue({ prefix: '/net/pacs' });
    mockDispatcher.read.mockResolvedValue(Ok('via-dispatcher'));
    expect((await fileContent_get('/net/pacs/x')).ok).toBe(true);
    expect(mockDispatcher.read).toHaveBeenCalled();
  });

  it('routes /PIPELINES/ to the pipeline handler', async () => {
    mockDispatcher.provider_get.mockReturnValue({ prefix: '' });
    mockPipeline.fileContent_getPipeline.mockResolvedValue(Ok('pipe'));
    await fileContent_get('/PIPELINES/p');
    expect(mockPipeline.fileContent_getPipeline).toHaveBeenCalled();
  });

  it('routes /SERVICES/PACS/ to the pacs handler', async () => {
    mockDispatcher.provider_get.mockReturnValue(null);
    mockPacs.fileContent_getPACS.mockResolvedValue(Ok('pacs'));
    await fileContent_get('/SERVICES/PACS/x');
    expect(mockPacs.fileContent_getPACS).toHaveBeenCalled();
  });

  it('falls back to the regular handler', async () => {
    mockDispatcher.provider_get.mockReturnValue({ prefix: '' });
    mockRegular.fileContent_getRegular.mockResolvedValue(Ok('reg'));
    await fileContent_get('/home/chris/f.txt');
    expect(mockRegular.fileContent_getRegular).toHaveBeenCalled();
  });
});

describe('fileContent_getBinary + stream routing', () => {
  it('binary via dispatcher', async () => {
    mockDispatcher.provider_get.mockReturnValue({ prefix: '/net/pacs' });
    mockDispatcher.readBinary.mockResolvedValue(Ok(Buffer.from('b')));
    expect((await fileContent_getBinary('/net/pacs/x')).ok).toBe(true);
  });
  it('binary falls back to regular', async () => {
    mockDispatcher.provider_get.mockReturnValue({ prefix: '' });
    mockRegular.fileContent_getRegularBinary.mockResolvedValue(Ok(Buffer.from('b')));
    await fileContent_getBinary('/home/f');
    expect(mockRegular.fileContent_getRegularBinary).toHaveBeenCalled();
  });
  it('stream via dispatcher wraps buffer with size', async () => {
    mockDispatcher.provider_get.mockReturnValue({ prefix: '/net/pacs' });
    mockDispatcher.readBinary.mockResolvedValue(Ok(Buffer.from('abc')));
    const r = await fileContent_getBinaryStream('/net/pacs/x');
    expect(r.ok && r.value.size).toBe(3);
  });
  it('stream falls back to the regular stream handler', async () => {
    mockDispatcher.provider_get.mockReturnValue({ prefix: '/' });
    mockRegular.fileContent_getRegularStream.mockResolvedValue(Ok({ stream: 's' }));
    await fileContent_getBinaryStream('/home/f');
    expect(mockRegular.fileContent_getRegularStream).toHaveBeenCalled();
  });

  it('binary routes /PIPELINES/ and /SERVICES/PACS/', async () => {
    mockDispatcher.provider_get.mockReturnValue({ prefix: '' });
    mockPipeline.fileContent_getPipelineBinary.mockResolvedValue(Ok(Buffer.from('p')));
    await fileContent_getBinary('/PIPELINES/x');
    expect(mockPipeline.fileContent_getPipelineBinary).toHaveBeenCalled();

    mockPacs.fileContent_getPACSBinary.mockResolvedValue(Ok(Buffer.from('p')));
    await fileContent_getBinary('/SERVICES/PACS/x');
    expect(mockPacs.fileContent_getPACSBinary).toHaveBeenCalled();
  });

  it('stream routes /PIPELINES/ and /SERVICES/PACS/', async () => {
    mockDispatcher.provider_get.mockReturnValue({ prefix: '/' });
    mockPipeline.fileContent_getPipelineBinary.mockResolvedValue(Ok(Buffer.from('pp')));
    const rp = await fileContent_getBinaryStream('/PIPELINES/x');
    expect(rp.ok && rp.value.size).toBe(2);

    mockPacs.fileContent_getPACSBinary.mockResolvedValue(Ok(Buffer.from('qqq')));
    const rq = await fileContent_getBinaryStream('/SERVICES/PACS/x');
    expect(rq.ok && rq.value.size).toBe(3);
  });
});

describe('files_listRecursive', () => {
  it('walks files and subdirectories depth-first', async () => {
    mockObjCreate.mockImplementation(async (ctx: string, value: string) => {
      const isRoot = value === 'folder:/root';
      if (ctx === 'ChRISFilesContext') {
        return group({ resources_getAll: jest.fn().mockResolvedValue({ tableData: isRoot ? [{ fname: '/root/a.txt', fsize: 10 }] : [] }) });
      }
      // dirs
      return group({ resources_getAll: jest.fn().mockResolvedValue({ tableData: isRoot ? [{ path: '/root/sub' }] : [] }) });
    });

    const items = await files_listRecursive('/root');
    expect(items).toEqual([
      { path: '/root/a.txt', type: 'file', size: 10 },
      { path: '/root/sub', type: 'dir' },
    ]);
  });
});

describe('files_copyRecursively', () => {
  function tree(): void {
    mockObjCreate.mockImplementation(async (ctx: string, value: string) => {
      if (ctx === 'ChRISFilesContext' && value === 'folder:/src') {
        return group({ resources_getAll: jest.fn().mockResolvedValue({ tableData: [{ id: 1, fname: '/src/f.txt', fsize: 5 }] }) });
      }
      if (ctx === 'ChRISDirsContext' && value === 'folder:/src') {
        return group({ resources_getAll: jest.fn().mockResolvedValue({ tableData: [{ path: '/src/d' }] }) });
      }
      return group({ resources_getAll: jest.fn().mockResolvedValue({ tableData: [] }) });
    });
  }

  it('mkdir + copy each item, returning true when all succeed', async () => {
    tree();
    mockIO.folder_create.mockResolvedValue(Ok(true));
    mockIO.file_download.mockResolvedValue(Buffer.from('data'));
    mockIO.file_upload.mockResolvedValue(true);

    expect(await files_copyRecursively('/src', '/dest')).toBe(true);
    expect(mockIO.folder_create).toHaveBeenCalledWith('/dest');
  });

  it('returns false when the initial mkdir throws', async () => {
    mockIO.folder_create.mockRejectedValue(new Error('io'));
    expect(await files_copyRecursively('/src', '/dest')).toBe(false);
  });
});
