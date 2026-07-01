/**
 * Tests for FileGroupHandler / FileMemberHandler. FileController factories are
 * spied; command modules, ui, screen and path resolution are mocked; the
 * (pure) fileList_render is real.
 */
const mockCreate = jest.fn();
const mockFetchList = jest.fn();
const mockFields = jest.fn();
const mockSearchByTerm = jest.fn();
const mockDeleteById = jest.fn();
const mockViewContent = jest.fn();
const mockConfirm = jest.fn();
const mockTableDisplay = jest.fn();
const mockResolvePath = jest.fn();

jest.mock('../src/commands/fs/create', () => ({ files_create: mockCreate }));
jest.mock('../src/commands/files/list', () => ({ files_fetchList: mockFetchList }));
jest.mock('../src/commands/files/fields', () => ({ fileFields_fetch: mockFields }));
jest.mock('../src/commands/files/delete', () => ({ files_searchByTerm: mockSearchByTerm, files_deleteById: mockDeleteById }));
jest.mock('../src/commands/file/view', () => ({ files_viewContent: mockViewContent }));
jest.mock('../src/utils/ui', () => ({ prompt_confirm: mockConfirm }));
jest.mock('../src/screen/screen', () => ({ table_display: mockTableDisplay }));
jest.mock('../src/utils/cli', () => ({ path_resolveChrisFs: mockResolvePath }));

import { FileGroupHandler, FileMemberHandler } from '../src/filesystem/fileGroupHandler';
import { FileController } from '../src/controllers/fileController';

const fakeController = {
  chrisObject: { asset: {} },
  path_get: '/home/chris',
  files_share: jest.fn(),
} as unknown as FileController;

let logSpy: jest.SpyInstance;
let errSpy: jest.SpyInstance;
beforeEach(() => {
  jest.clearAllMocks();
  logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
  errSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  jest.spyOn(FileController, 'handler_create').mockResolvedValue(fakeController);
  jest.spyOn(FileController, 'member_create').mockResolvedValue(fakeController);
});
afterEach(() => jest.restoreAllMocks());

async function group(asset = 'files'): Promise<FileGroupHandler> {
  return FileGroupHandler.handler_create(asset);
}

describe('FileGroupHandler.handler_create', () => {
  it('creates a handler', async () => {
    expect(await group()).toBeInstanceOf(FileGroupHandler);
  });
  it('throws when the controller cannot be created', async () => {
    (FileController.handler_create as jest.Mock).mockResolvedValue(null);
    await expect(FileGroupHandler.handler_create('files')).rejects.toThrow('Failed to initialize');
  });
});

describe('FileGroupHandler.files_list', () => {
  it('renders the listing', async () => {
    mockFetchList.mockResolvedValue({ selectedFields: ['id', 'fname'], tableData: [{ id: 1, fname: '/a.txt' }] });
    await (await group()).files_list({});
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('/a.txt'));
  });
  it('errors when no results', async () => {
    mockFetchList.mockResolvedValue(null);
    await (await group()).files_list({});
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('No files resources found'));
  });
  it('notes an empty result set', async () => {
    mockFetchList.mockResolvedValue({ selectedFields: [], tableData: [] });
    await (await group()).files_list({});
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('No files found matching'));
  });
  it('handles a thrown error', async () => {
    mockFetchList.mockRejectedValue(new Error('boom'));
    await expect((await group()).files_list({})).resolves.toBeUndefined();
  });
});

describe('FileGroupHandler.files_fields', () => {
  it('displays or notes empty', async () => {
    mockFields.mockResolvedValue(['id']);
    await (await group()).files_fields();
    expect(mockTableDisplay).toHaveBeenCalledWith(['id'], ['fields']);
    mockFields.mockResolvedValue([]);
    await (await group()).files_fields();
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('No resource fields'));
  });
});

describe('FileGroupHandler.files_delete', () => {
  it('deletes with force', async () => {
    mockSearchByTerm.mockResolvedValue([{ id: 5, fname: '/a' }]);
    mockDeleteById.mockResolvedValue(true);
    await (await group()).files_delete('id:5', { force: true });
    expect(mockDeleteById).toHaveBeenCalledWith(5, 'files');
  });
  it('skips items without an id', async () => {
    mockSearchByTerm.mockResolvedValue([{ fname: '/a' }]);
    await (await group()).files_delete('id:5', { force: true });
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('without ID'));
  });
  it('notes when nothing matches', async () => {
    mockSearchByTerm.mockResolvedValue([]);
    await (await group()).files_delete('id:9', {});
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('No files found matching'));
  });
});

describe('FileGroupHandler.files_share', () => {
  it('delegates to the controller', async () => {
    await (await group()).files_share({ force: true });
    expect(fakeController.files_share).toHaveBeenCalled();
  });
});

describe('FileMemberHandler', () => {
  it('handler_create builds an instance', async () => {
    expect(await FileMemberHandler.handler_create('/f')).toBeInstanceOf(FileMemberHandler);
  });

  it('file_create logs the resolved path on success', async () => {
    const h = await FileMemberHandler.handler_create('/f');
    mockCreate.mockResolvedValue(true);
    mockResolvePath.mockResolvedValue('/home/chris/new.txt');
    await h.file_create('new.txt', {});
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('/home/chris/new.txt'));
  });

  it('file_create reports a thrown error', async () => {
    const h = await FileMemberHandler.handler_create('/f');
    mockCreate.mockRejectedValue(new Error('bad'));
    await h.file_create('new.txt', {});
    expect(errSpy).toHaveBeenCalledWith('bad');
  });

  it('file_cat prints content or an error', async () => {
    const h = await FileMemberHandler.handler_create('/f');
    mockViewContent.mockResolvedValue('hello');
    await h.file_cat({});
    expect(logSpy).toHaveBeenCalledWith('hello');
    mockViewContent.mockResolvedValue(null);
    await h.file_cat({});
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('Failed to view'));
  });
});
