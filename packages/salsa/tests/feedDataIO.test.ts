/**
 * Unit tests for the data-facts reader's own IO: a CFS folder is read to its
 * first page of folders, files and links (never walked whole), a folder that
 * answers nothing is asked once whether it was refused, and a projected
 * folder is left to its provider.
 */
const mockFilesList = jest.fn();
const mockListOutcome = jest.fn();
const mockIsVirtual = jest.fn();
const mockDispatcherList = jest.fn();
const mockHeader = jest.fn();

jest.mock('../src/files/index', () => ({
  ...jest.requireActual('../src/files/index'),
  files_list: (...args: unknown[]) => mockFilesList(...args),
  files_listOutcome: (...args: unknown[]) => mockListOutcome(...args),
}));
jest.mock('../src/vfs/dispatcher', () => ({
  vfsDispatcher: { path_isVirtual: (p: string) => mockIsVirtual(p), list: (p: string) => mockDispatcherList(p) },
}));
jest.mock('../src/dicom/series', () => ({ dicomHeaderPrefix_get: (p: string) => mockHeader(p) }));

import { dataFactsIO_of } from '../src/dag/feedData';

const io = dataFactsIO_of(async () => '/out/1');

beforeEach(() => {
  jest.clearAllMocks();
  mockIsVirtual.mockReturnValue(false);
});

describe('dataFactsIO_of', () => {
  it('reads a CFS folder to its first page of each kind, links with their targets', async () => {
    mockFilesList.mockImplementation(async (_opts: unknown, kind: string) => ({
      tableData: kind === 'dirs' ? [{ path: 'home/u/out/sub' }] : kind === 'files' ? [{ fname: 'home/u/out/a.dcm', fsize: 9 }] : [{ fname: 'home/u/out/l.chrislink', path: 'home/u/uploads/S' }],
    }));
    const items = await io.list('/home/u/out');
    expect(Array.isArray(items) && items.map((i) => `${i.type}:${i.name}:${i.target ?? ''}`)).toEqual(['dir:sub:/home/u/out/sub', 'file:a.dcm:', 'link:l:/home/u/uploads/S']);
    expect(mockFilesList.mock.calls.every(([opts]) => (opts as { limit: number }).limit === 50)).toBe(true);
    expect(mockListOutcome).not.toHaveBeenCalled();
  });

  it('tells a refused folder from an empty or a missing one', async () => {
    mockFilesList.mockResolvedValue(null);
    mockListOutcome.mockResolvedValueOnce({ kind: 'refused', error: new Error('403') });
    expect(await io.list('/home/x/uploads')).toBe('refused');
    mockListOutcome.mockResolvedValueOnce({ kind: 'missing' });
    expect(await io.list('/nowhere')).toBeNull();
    mockListOutcome.mockResolvedValueOnce({ kind: 'empty' });
    expect(await io.list('/home/u/empty')).toEqual([]);
    mockFilesList.mockRejectedValueOnce(new Error('403'));
    expect(await io.list('/home/x/other')).toBe('refused');
  });

  it('leaves a projected folder to its provider, and reads a header', async () => {
    mockIsVirtual.mockReturnValue(true);
    mockDispatcherList.mockResolvedValueOnce({ ok: true, value: [{ name: 'x', type: 'file' }] }).mockResolvedValueOnce({ ok: false });
    expect(await io.list('/SERVICES/PACS/a')).toEqual([{ name: 'x', type: 'file' }]);
    expect(await io.list('/SERVICES/PACS/b')).toBeNull();
    expect(mockFilesList).not.toHaveBeenCalled();
    mockHeader.mockResolvedValueOnce({ ok: true, value: { tags: [] } }).mockResolvedValueOnce({ ok: false });
    expect(await io.header('/a.dcm')).toEqual({ tags: [] });
    expect(await io.header('/b.dcm')).toBeNull();
    expect(await io.outputPath(1)).toBe('/out/1');
  });
});
