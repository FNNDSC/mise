import { jest, describe, it, expect, beforeEach } from '@jest/globals';

jest.unstable_mockModule('@fnndsc/salsa', () => ({
  context_getSingle: jest.fn(async () => ({ user: 'chris', folder: '/home/chris' })),
}));
jest.unstable_mockModule('@fnndsc/cumin', () => ({
  envelope_ok: (rendered: string) => ({ status: 'ok', rendered }),
  envelope_error: (rendered: string, _errors?: unknown, renderedErr?: string) => (renderedErr !== undefined ? { status: 'error', rendered, renderedErr } : { status: 'error', rendered }),}));
jest.unstable_mockModule('@fnndsc/chili/models/listing.js', () => ({}));

const mockGetCWD = jest.fn(async () => '/home/chris');
const mockSetCWD = jest.fn();
jest.unstable_mockModule('../src/session/index.js', () => ({ session: { getCWD: mockGetCWD, setCWD: mockSetCWD } }));

const mockDataGet = jest.fn();
jest.unstable_mockModule('../src/lib/vfs/vfs.js', () => ({ vfs: { data_get: mockDataGet } }));
jest.unstable_mockModule('../src/lib/spinner.js', () => ({ spinner: { start: jest.fn(), stop: jest.fn() } }));

const mockScanDo = jest.fn();
jest.unstable_mockModule('@fnndsc/chili/path/pathCommand.js', () => ({ scan_do: mockScanDo }));
jest.unstable_mockModule('@fnndsc/chili/commands/fs/upload.js', () => ({ bytes_format: jest.fn((n: number) => `${n}B`) }));

const ok = <T>(value: T) => ({ ok: true as const, value });

const { builtin_du } = await import('../src/builtins/fs/du.js');

let logSpy: jest.SpiedFunction<typeof console.log>;
let errSpy: jest.SpiedFunction<typeof console.error>;
beforeEach(() => {
  jest.clearAllMocks();
  mockGetCWD.mockResolvedValue('/home/chris');
  logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
  errSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('builtin_du', () => {
  it('reports the size of a single file target', async () => {
    mockDataGet.mockResolvedValue(ok([{ type: 'file', size: 2048 }]));
    await builtin_du(['report.txt']);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('/home/chris/report.txt'));
    expect(mockScanDo).not.toHaveBeenCalled();
  });

  it('scans and renders a directory target', async () => {
    mockDataGet.mockResolvedValue(ok([{ type: 'dir' }]));
    mockScanDo.mockResolvedValue({
      totalSize: 3000,
      fileInfo: [{ chrisPath: '/home/chris/data/a', size: 3000 }],
    });
    await builtin_du(['data']);
    expect(mockScanDo).toHaveBeenCalled();
    expect(mockSetCWD).toHaveBeenCalledWith('/home/chris/data');
    expect(logSpy).toHaveBeenCalled();
  });

  it('reports a target that cannot be accessed', async () => {
    mockDataGet.mockResolvedValue(ok([]));
    await builtin_du(['ghost']);
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('cannot access'));
  });

  it('prints a grand total with -c', async () => {
    mockDataGet.mockResolvedValue(ok([{ type: 'file', size: 1000 }]));
    await builtin_du(['-c', 'a.txt']);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('total'));
  });

  it('skips a directory whose scan returns nothing', async () => {
    mockDataGet.mockResolvedValue(ok([{ type: 'dir' }]));
    mockScanDo.mockResolvedValue(null);
    await builtin_du(['data']);
    expect(mockSetCWD).toHaveBeenLastCalledWith('/home/chris');
  });
});
