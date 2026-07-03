/**
 * @file Tests for ChRIS file IO: download (stream and blob), upload with
 * collision-rename, folder create/move, recursive local upload. Connection
 * mocked at the client boundary; a fake storage provider drives local IO.
 * Fake timers neutralise the 30s upload timeout race.
 */

jest.mock('../src/connect/chrisConnection', () => ({
  chrisConnection: { client_get: jest.fn() },
}));

import { chrisConnection } from '../src/connect/chrisConnection';
import { ChrisIO } from '../src/io/chrisIO';
import { errorStack } from '../src/error/errorStack';

const mockClientGet: jest.Mock = chrisConnection.client_get as unknown as jest.Mock;

let pushSpy: jest.SpyInstance;
beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  pushSpy = jest.spyOn(errorStack, 'stack_push').mockImplementation(() => undefined);
});
afterEach(() => {
  jest.useRealTimers();
  pushSpy.mockRestore();
});

const io = (): ChrisIO => new ChrisIO();

describe('init', () => {
  it('creates the file browser folder', async () => {
    mockClientGet.mockResolvedValue({ createFileBrowserFolder: jest.fn(async () => ({})) });
    expect(await io().init()).toBe(true);
  });

  it('returns false when the create throws', async () => {
    mockClientGet.mockResolvedValue({
      createFileBrowserFolder: jest.fn(async () => { throw new Error('409'); }),
    });
    expect(await io().init()).toBe(false);
  });

  it('returns null when not connected', async () => {
    mockClientGet.mockResolvedValue(null);
    expect(await io().init()).toBeNull();
  });
});

describe('file_downloadStream', () => {
  it('returns the stream with size and filename', async () => {
    mockClientGet.mockResolvedValue({
      getUserFile: jest.fn(async () => ({
        data: { fname: 'home/chris/a.txt' },
        getFileStream: jest.fn(async () => ({ data: 'STREAM', headers: { 'content-length': '42' } })),
      })),
    });
    const result = await io().file_downloadStream(1);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({ stream: 'STREAM', size: 42, filename: 'home/chris/a.txt' });
  });

  it('errors on a missing file, empty response, or thrown fetch', async () => {
    mockClientGet.mockResolvedValue({ getUserFile: jest.fn(async () => null) });
    expect((await io().file_downloadStream(1)).ok).toBe(false);

    mockClientGet.mockResolvedValue({
      getUserFile: jest.fn(async () => ({ getFileStream: jest.fn(async () => ({})) })),
    });
    expect((await io().file_downloadStream(1)).ok).toBe(false);

    mockClientGet.mockResolvedValue({
      getUserFile: jest.fn(async () => ({ getFileStream: jest.fn(async () => { throw new Error('x'); }) })),
    });
    expect((await io().file_downloadStream(1)).ok).toBe(false);
  });

  it('errors when not connected', async () => {
    mockClientGet.mockResolvedValue(null);
    expect((await io().file_downloadStream(1)).ok).toBe(false);
  });
});

describe('file_download', () => {
  const withBlob = (blob: unknown): void => {
    mockClientGet.mockResolvedValue({
      getUserFile: jest.fn(async () => ({ getFileBlob: jest.fn(async () => blob) })),
    });
  };

  it('converts a string blob to a Buffer', async () => {
    withBlob('hello');
    expect((await io().file_download(1))?.toString()).toBe('hello');
  });

  it('passes a Buffer through', async () => {
    withBlob(Buffer.from('buf'));
    expect((await io().file_download(1))?.toString()).toBe('buf');
  });

  it('converts an ArrayBuffer', async () => {
    withBlob(new TextEncoder().encode('ab').buffer);
    expect((await io().file_download(1))?.toString()).toBe('ab');
  });

  it('converts a Blob', async () => {
    withBlob(new Blob(['bl']));
    expect((await io().file_download(1))?.toString()).toBe('bl');
  });

  it('rejects an unexpected blob type', async () => {
    withBlob(42);
    expect(await io().file_download(1)).toBeNull();
    expect(pushSpy).toHaveBeenCalledWith('error', expect.stringContaining('Unexpected blob type'));
  });

  it('returns null for a missing file or empty blob', async () => {
    mockClientGet.mockResolvedValue({ getUserFile: jest.fn(async () => null) });
    expect(await io().file_download(1)).toBeNull();

    withBlob(null);
    expect(await io().file_download(1)).toBeNull();
  });
});

describe('file_upload', () => {
  it('uploads and leaves a correctly-named file alone', async () => {
    const put = jest.fn();
    mockClientGet.mockResolvedValue({
      uploadFile: jest.fn(async () => ({ data: { fname: 'home/chris/up/a.txt' }, put })),
    });
    expect(await io().file_upload(new Blob(['x']), '/home/chris/up', 'a.txt')).toBe(true);
    expect(put).not.toHaveBeenCalled();
  });

  it('renames a collision-renamed upload back to the requested path', async () => {
    const put = jest.fn(async () => ({}));
    mockClientGet.mockResolvedValue({
      uploadFile: jest.fn(async () => ({ data: { fname: 'home/chris/up/a_XYZ.txt' }, put })),
    });
    expect(await io().file_upload(new Blob(['x']), 'home/chris/up/', 'a.txt')).toBe(true);
    expect(put).toHaveBeenCalledWith({ upload_path: 'home/chris/up/a.txt' });
  });

  it('keeps the upload successful when the rename-back fails', async () => {
    mockClientGet.mockResolvedValue({
      uploadFile: jest.fn(async () => ({
        data: { fname: 'home/chris/up/a_XYZ.txt' },
        put: jest.fn(async () => { throw new Error('403'); }),
      })),
    });
    expect(await io().file_upload(new Blob(['x']), 'home/chris/up', 'a.txt')).toBe(true);
    expect(pushSpy).toHaveBeenCalledWith('warning', expect.stringContaining('rename to'));
  });

  it('fails when the upload times out', async () => {
    mockClientGet.mockResolvedValue({ uploadFile: jest.fn(() => new Promise(() => undefined)) });
    const pending: Promise<boolean> = io().file_upload(new Blob(['x']), 'up', 'a.txt');
    await jest.advanceTimersByTimeAsync(30_000);
    expect(await pending).toBe(false);
    expect(pushSpy).toHaveBeenCalledWith('error', expect.stringContaining('Upload timeout'));
  });

  it('fails when the upload throws or the client is missing', async () => {
    mockClientGet.mockResolvedValue({ uploadFile: jest.fn(async () => { throw new Error('500'); }) });
    expect(await io().file_upload(new Blob(['x']), 'up', 'a.txt')).toBe(false);

    mockClientGet.mockResolvedValue(null);
    expect(await io().file_upload(new Blob(['x']), 'up', 'a.txt')).toBe(false);
  });
});

describe('folder operations', () => {
  it('creates a folder', async () => {
    mockClientGet.mockResolvedValue({
      getFileBrowserFolders: jest.fn(async () => ({ post: jest.fn(async () => ({ data: {} })) })),
    });
    const result = await io().folder_create('/uploads/data');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(true);
  });

  it('reports an already-existing folder as Ok(false)', async () => {
    const alreadyExists = Object.assign(new Error('400'), {
      response: { status: 400, data: { path: ['folder already exists at this path'] } },
    });
    mockClientGet.mockResolvedValue({
      getFileBrowserFolders: jest.fn(async () => ({ post: jest.fn(async () => { throw alreadyExists; }) })),
    });
    const result = await io().folder_create('/uploads/data');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(false);
  });

  it('errors on any other create failure', async () => {
    mockClientGet.mockResolvedValue({
      getFileBrowserFolders: jest.fn(async () => ({ post: jest.fn(async () => { throw new Error('500'); }) })),
    });
    expect((await io().folder_create('/x')).ok).toBe(false);
  });

  it('moves a folder by path', async () => {
    const put = jest.fn(async () => ({}));
    mockClientGet.mockResolvedValue({ getFileBrowserFolderByPath: jest.fn(async () => ({ put })) });
    expect((await io().folder_moveByPath('/a', '/b')).ok).toBe(true);
    expect(put).toHaveBeenCalledWith({ path: '/b' });
  });

  it('moves a file by id', async () => {
    const put = jest.fn(async () => ({}));
    mockClientGet.mockResolvedValue({ getUserFile: jest.fn(async () => ({ put })) });
    expect((await io().file_moveById(9, '/b/c.txt')).ok).toBe(true);
    expect(put).toHaveBeenCalledWith({ path: '/b/c.txt' });
  });

  it('errors when the move target is missing', async () => {
    mockClientGet.mockResolvedValue({
      getFileBrowserFolderByPath: jest.fn(async () => null),
      getUserFile: jest.fn(async () => null),
    });
    expect((await io().folder_moveByPath('/a', '/b')).ok).toBe(false);
    expect((await io().file_moveById(9, '/b')).ok).toBe(false);
  });
});

describe('uploadLocalPath', () => {
  const storage = {
    isDirectory: jest.fn(),
    basename: jest.fn((p: string) => p.split('/').pop() ?? ''),
    readdir: jest.fn(),
    join: jest.fn((a: string, b: string) => `${a}/${b}`),
    readBinary: jest.fn(),
  };

  const connectedIO = (): ChrisIO => {
    const chrisIO: ChrisIO = io();
    chrisIO.storageProvider_set(storage as never);
    mockClientGet.mockResolvedValue({
      uploadFile: jest.fn(async (data: { upload_path: string }) => ({ data: { fname: data.upload_path } })),
    });
    return chrisIO;
  };

  it('uploads a single file into its remote directory', async () => {
    storage.isDirectory.mockResolvedValue(false);
    storage.readBinary.mockResolvedValue(new TextEncoder().encode('data').buffer);
    expect(await connectedIO().uploadLocalPath('/local/a.txt', '/home/chris/a.txt')).toBe(true);
  });

  it('recurses into a directory with cp semantics', async () => {
    storage.isDirectory.mockResolvedValueOnce(true).mockResolvedValue(false);
    storage.readdir.mockResolvedValue(['x.txt', 'y.txt']);
    storage.readBinary.mockResolvedValue(new TextEncoder().encode('d').buffer);
    expect(await connectedIO().uploadLocalPath('/local/dir', '/home/chris')).toBe(true);
    expect(storage.readdir).toHaveBeenCalledWith('/local/dir');
  });

  it('fails when a local file cannot be read', async () => {
    storage.isDirectory.mockResolvedValue(false);
    storage.readBinary.mockResolvedValue(null);
    expect(await connectedIO().uploadLocalPath('/local/a.txt', '/x/a.txt')).toBe(false);
  });

  it('fails without a storage provider', async () => {
    expect(await io().uploadLocalPath('/a', '/b')).toBe(false);
    expect(pushSpy).toHaveBeenCalledWith('error', expect.stringContaining('Storage provider'));
  });
});
