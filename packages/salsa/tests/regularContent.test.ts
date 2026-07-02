/**
 * Boundary-only tests for files/regular_content. Stubs files_getGroup and cumin
 * chrisIO; real Result/errorStack. The three fetchers share the same resolve
 * logic, so each is exercised for success + the key failure branches.
 */
const mockGetGroup = jest.fn();
const mockIO = { file_download: jest.fn(), file_downloadStream: jest.fn() };

jest.mock('../src/files/index', () => ({ files_getGroup: mockGetGroup }));
jest.mock('@fnndsc/cumin', () => ({
  ...jest.requireActual('@fnndsc/cumin'),
  chrisIO: mockIO,
}));

import { Ok, Err, errorStack } from '@fnndsc/cumin';
import {
  fileContent_getRegular,
  fileContent_getRegularBinary,
  fileContent_getRegularStream,
} from '../src/files/regular_content';

function groupWith(tableData: unknown): void {
  mockGetGroup.mockResolvedValue({
    asset: { resources_getAll: jest.fn().mockResolvedValue(tableData ? { tableData } : null) },
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  errorStack.stack_clear();
});

describe('fileContent_getRegular', () => {
  it('downloads and decodes as utf-8', async () => {
    groupWith([{ id: 1, fname: '/dir/f.txt' }]);
    mockIO.file_download.mockResolvedValue(Buffer.from('hello'));
    const r = await fileContent_getRegular('/dir/f.txt');
    expect(r.ok && r.value).toBe('hello');
  });

  it('errors when the group is unavailable', async () => {
    mockGetGroup.mockResolvedValue(null);
    expect((await fileContent_getRegular('/dir/f.txt')).ok).toBe(false);
  });

  it('errors when the directory has no files', async () => {
    groupWith(null);
    expect((await fileContent_getRegular('/dir/f.txt')).ok).toBe(false);
  });

  it('errors when the file is not found', async () => {
    groupWith([{ id: 1, fname: '/dir/other.txt' }]);
    expect((await fileContent_getRegular('/dir/f.txt')).ok).toBe(false);
  });

  it('errors when the file has no numeric id', async () => {
    groupWith([{ fname: '/dir/f.txt' }]);
    expect((await fileContent_getRegular('/dir/f.txt')).ok).toBe(false);
  });

  it('errors when the download fails', async () => {
    groupWith([{ id: 1, fname: '/dir/f.txt' }]);
    mockIO.file_download.mockResolvedValue(null);
    expect((await fileContent_getRegular('/dir/f.txt')).ok).toBe(false);
  });

  it('matches the "? name" placeholder form', async () => {
    groupWith([{ id: 2, fname: '/dir/? f.txt' }]);
    mockIO.file_download.mockResolvedValue(Buffer.from('x'));
    expect((await fileContent_getRegular('/dir/f.txt')).ok).toBe(true);
  });
});

describe('fileContent_getRegularBinary', () => {
  it('returns the raw buffer', async () => {
    groupWith([{ id: 1, fname: '/dir/f.bin' }]);
    const buf = Buffer.from([1, 2, 3]);
    mockIO.file_download.mockResolvedValue(buf);
    const r = await fileContent_getRegularBinary('/dir/f.bin');
    expect(r.ok && r.value).toBe(buf);
  });

  it('errors when the download fails', async () => {
    groupWith([{ id: 1, fname: '/dir/f.bin' }]);
    mockIO.file_download.mockResolvedValue(null);
    expect((await fileContent_getRegularBinary('/dir/f.bin')).ok).toBe(false);
  });
});

describe('fileContent_getRegularStream', () => {
  it('returns the stream result', async () => {
    groupWith([{ id: 1, fname: '/dir/f.txt' }]);
    mockIO.file_downloadStream.mockResolvedValue(Ok({ stream: 's', size: 9 }));
    const r = await fileContent_getRegularStream('/dir/f.txt');
    expect(r.ok && r.value.size).toBe(9);
  });

  it('errors when the group is unavailable', async () => {
    mockGetGroup.mockResolvedValue(null);
    expect((await fileContent_getRegularStream('/dir/f.txt')).ok).toBe(false);
  });

  it('errors when the stream download fails', async () => {
    groupWith([{ id: 1, fname: '/dir/f.txt' }]);
    mockIO.file_downloadStream.mockResolvedValue(Err());
    expect((await fileContent_getRegularStream('/dir/f.txt')).ok).toBe(false);
  });
});
