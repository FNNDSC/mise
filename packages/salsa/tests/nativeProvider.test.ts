/**
 * Boundary-only tests for NativeVfsProvider. The provider's real logic (item
 * mapping, sorting, copy-destination resolution, path_checkIsDir) runs; its
 * collaborator salsa/files (which bottoms out in cumin's network-coupled
 * embedded resource group) is stubbed. files/index has its own tests.
 */
const mockListAll = jest.fn();
const mockCopy = jest.fn();
const mockCopyRecursively = jest.fn();

jest.mock('../src/files/index', () => ({
  files_listAll: mockListAll,
  files_copy: mockCopy,
  files_copyRecursively: mockCopyRecursively,
}));

import { NativeVfsProvider } from '../src/vfs/providers/native';
import type { CpOptions } from '../src/vfs/provider';

const provider = new NativeVfsProvider();

beforeEach(() => jest.clearAllMocks());

/** files_listAll(options, assetName, path) -> route by assetName. */
function listByAsset(map: Record<string, unknown>): void {
  mockListAll.mockImplementation(async (_o: unknown, asset: string) => map[asset] ?? null);
}

describe('NativeVfsProvider.list', () => {
  it('maps dirs/files/links into VFS items and sorts by name', async () => {
    listByAsset({
      dirs: { tableData: [{ fname: 'sub', fsize: 0, owner_username: 'chris', creation_date: 'd1' }] },
      files: { tableData: [{ path: '/home/chris/a.txt', fsize: 100, owner_username: 'chris', creation_date: 'd2' }] },
      links: { tableData: [{ fname: 'ln.chrislink', path: 'target/x' }] },
    });

    const r = await provider.list('/home/chris');
    expect(r.ok).toBe(true);
    const items = r.ok ? r.value : [];

    const dir = items.find((i) => i.type === 'dir');
    const file = items.find((i) => i.type === 'file');
    const link = items.find((i) => i.type === 'link');

    expect(dir).toMatchObject({ name: 'sub', size: 0, owner: 'chris' });
    expect(file).toMatchObject({ name: 'a.txt', size: 100 }); // basename of path
    expect(link).toMatchObject({ name: 'ln', target: '/target/x' }); // .chrislink stripped, / prepended
    // sorted by name ascending
    expect(items.map((i) => i.name)).toEqual([...items.map((i) => i.name)].sort((a, b) => a.localeCompare(b)));
  });

  it('defaults missing fields and empties', async () => {
    listByAsset({
      dirs: { tableData: [{}] }, // no fname/path/size/owner/date
      files: null,
      links: null,
    });
    const r = await provider.list('');
    const item = r.ok ? r.value[0] : undefined;
    expect(item).toMatchObject({ name: '', size: 0, owner: 'unknown', date: '', target: undefined });
  });

  it('sorts by size and honours reverse', async () => {
    listByAsset({
      dirs: null,
      files: {
        tableData: [
          { fname: 'big', fsize: 30 },
          { fname: 'small', fsize: 10 },
          { fname: 'mid', fsize: 20 },
        ],
      },
      links: null,
    });
    const asc = await provider.list('/p', { sort: 'size' });
    expect(asc.ok && asc.value.map((i) => i.size)).toEqual([10, 20, 30]);

    const desc = await provider.list('/p', { sort: 'size', reverse: true });
    expect(desc.ok && desc.value.map((i) => i.size)).toEqual([30, 20, 10]);
  });

  it('skips a rejected asset request', async () => {
    mockListAll.mockImplementation(async (_o: unknown, asset: string) => {
      if (asset === 'links') throw new Error('links down');
      if (asset === 'files') return { tableData: [{ fname: 'ok.txt', fsize: 1 }] };
      return null;
    });
    const r = await provider.list('/p');
    expect(r.ok && r.value.map((i) => i.name)).toEqual(['ok.txt']);
  });

  it('returns Err when list throws synchronously', async () => {
    mockListAll.mockImplementation(() => {
      throw new Error('boom');
    });
    expect((await provider.list('/p')).ok).toBe(false);
  });
});

describe('NativeVfsProvider.cp', () => {
  const opts = (recursive: boolean): CpOptions => ({ recursive }) as CpOptions;

  it('refuses to copy a directory without --recursive', async () => {
    // path_checkIsDir(src): dirs listing of parent contains src
    mockListAll.mockResolvedValue({ tableData: [{ path: '/a/dir' }] });
    expect(await provider.cp('/a/dir', '/b', opts(false))).toBe(false);
  });

  it('copies a directory recursively into a dir destination', async () => {
    // src is a dir; dest is a dir -> join basename
    mockListAll.mockImplementation(async (_o: unknown, _asset: string, parent: string) => {
      if (parent === '/a') return { tableData: [{ path: '/a/dir' }] }; // src is dir
      if (parent === '/b') return { tableData: [{ path: '/b/x' }] };
      return { tableData: [] };
    });
    mockCopyRecursively.mockResolvedValue(true);
    // dest '/b/dir' exists as dir? make dest a dir via trailing slash to force join
    expect(await provider.cp('/a/dir', '/b/', opts(true))).toBe(true);
    expect(mockCopyRecursively).toHaveBeenCalledWith('/a/dir', '/b/dir');
  });

  it('copies a single file to an explicit destination', async () => {
    mockListAll.mockResolvedValue({ tableData: [] }); // nothing is a dir
    mockCopy.mockResolvedValue(true);
    expect(await provider.cp('/a/f.txt', '/b/g.txt', opts(false))).toBe(true);
    expect(mockCopy).toHaveBeenCalledWith('/a/f.txt', '/b/g.txt');
  });

  it('returns false when the copy throws', async () => {
    mockListAll.mockResolvedValue({ tableData: [] });
    mockCopy.mockRejectedValue(new Error('io'));
    expect(await provider.cp('/a/f.txt', '/b/g.txt', opts(false))).toBe(false);
  });

  it('treats null dir-listing as "not a directory" (file copy)', async () => {
    mockListAll.mockResolvedValue(null); // path_checkIsDir -> false
    mockCopy.mockResolvedValue(true);
    expect(await provider.cp('/a/f.txt', '/b/g.txt', opts(false))).toBe(true);
    expect(mockCopy).toHaveBeenCalled();
  });

  it('treats a dir-listing failure as "not a directory"', async () => {
    mockListAll.mockRejectedValue(new Error('list down')); // path_checkIsDir catch -> false
    mockCopy.mockResolvedValue(true);
    expect(await provider.cp('/a/f.txt', '/b/g.txt', opts(false))).toBe(true);
  });
});
