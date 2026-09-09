/**
 * The series as a folder: order from file names, identity and geometry from
 * one header, bytes from the listing, annotations by UID, and the header
 * cache that makes a second look free.
 */
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import dcmjs from 'dcmjs';
import type { Result } from '@fnndsc/cumin';
import type { VFSItem } from '../src/vfs/provider';
import {
  dicomSeries_summarize,
  dicomFolder_list,
  dicomHeader_get,
  dicomHeaderCache_clear,
  dicomFiles_sample,
  type DicomFolderIO,
} from '../src/dicom/series';
import { fixtureSeries_write, fixtureInstance_write, FIXTURE_SERIES_UID, FIXTURE_STUDY_UID } from './dicomFixture';

dcmjs.log.setLevel('silent');

const ok = <T>(value: T): Result<T> => ({ ok: true, value });
const err = <T>(): Result<T> => ({ ok: false });

/** An in-memory folder reader over a map of path to bytes. */
function io_over(files: Map<string, Buffer>, extraFolders: Record<string, VFSItem[]> = {}): DicomFolderIO & { reads: string[] } {
  const reads: string[] = [];
  return {
    reads,
    list: async (path: string): Promise<Result<VFSItem[]>> => {
      if (extraFolders[path] !== undefined) return ok(extraFolders[path]);
      const base: string = path.endsWith('/') ? path.slice(0, -1) : path;
      const items: VFSItem[] = [...files.entries()]
        .filter(([filePath]): boolean => filePath.startsWith(`${base}/`) && !filePath.slice(base.length + 1).includes('/'))
        .map(([filePath, bytes]): VFSItem => ({ name: filePath.slice(base.length + 1), type: 'file', size: bytes.length, owner: 'synth', date: '' }));
      return items.length === 0 ? err() : ok(items);
    },
    readBinary: async (path: string): Promise<Result<Buffer>> => {
      reads.push(path);
      const bytes: Buffer | undefined = files.get(path);
      return bytes === undefined ? err() : ok(bytes);
    },
  };
}

beforeEach(() => {
  dicomHeaderCache_clear();
});

describe('dicomFolder_list', () => {
  it('orders numbered files by their instance prefix, not lexically', () => {
    const files: Map<string, Buffer> = new Map<string, Buffer>();
    for (const n of [10, 2, 1]) files.set(`/s/${String(n).padStart(4, '0')}-x.dcm`, Buffer.alloc(1));
    files.set('/s/notes.txt', Buffer.alloc(1));
    return dicomFolder_list('/s', io_over(files)).then((listed) => {
      expect(listed.ok && listed.value.order).toBe('filename');
      expect(listed.ok && listed.value.files.map((file): string => file.path)).toEqual(['/s/0001-x.dcm', '/s/0002-x.dcm', '/s/0010-x.dcm']);
    });
  });

  it('falls back to name order when files are not numbered, a bare leading digit included', async () => {
    const files: Map<string, Buffer> = new Map<string, Buffer>([
      ['/s/b.dcm', Buffer.alloc(1)],
      ['/s/a.DCM', Buffer.alloc(1)],
      ['/s/1x.dcm', Buffer.alloc(1)],
    ]);
    const listed = await dicomFolder_list('/s/', io_over(files));
    expect(listed.ok && listed.value.order).toBe('unknown');
    expect(listed.ok && listed.value.files.map((file): string => file.path)).toEqual(['/s/1x.dcm', '/s/a.DCM', '/s/b.dcm']);
  });

  it('fails when the folder cannot be listed', async () => {
    expect((await dicomFolder_list('/missing', io_over(new Map()))).ok).toBe(false);
  });
});

describe('dicomSeries_summarize', () => {
  const folder: string = '/SERVICES/PACS/SYNTH/P/S/00005-Synthesized-abcdef0';
  const files: Map<string, Buffer> = fixtureSeries_write(folder, 16);

  it('answers identity, count, order, geometry and bytes from the listing plus one header', async () => {
    const io = io_over(files);
    const result = await dicomSeries_summarize(folder, {}, io);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({
      path: folder,
      seriesInstanceUID: FIXTURE_SERIES_UID,
      studyInstanceUID: FIXTURE_STUDY_UID,
      modality: 'MR',
      seriesDescription: 'Synthesized T1',
      seriesNumber: 5,
      instances: 16,
      frames: 1,
      order: 'filename',
      geometry: { rows: 8, columns: 8, pixelSpacing: [0.9375, 0.9375], sliceThickness: 1.5 },
      transferSyntax: { uid: '1.2.840.10008.1.2.1', name: 'Explicit VR Little Endian' },
      annotations: [],
    });
    expect(result.value.bytes).toBe([...files.values()].reduce((total: number, bytes: Buffer): number => total + bytes.length, 0));
    expect(result.value.header).toBe(result.value.files[0]);
    expect(result.value.files).toHaveLength(16);
    expect(io.reads).toEqual([result.value.header]);
  });

  it('lists annotations found under the root by series UID', async () => {
    const root: string = '/home/synth/annotations';
    const io = io_over(files, {
      [`${root}/${FIXTURE_SERIES_UID}`]: [
        { name: 'measurements.dcm', type: 'file', size: 10, owner: 'synth', date: '' },
        { name: 'drafts', type: 'dir', size: 0, owner: 'synth', date: '' },
      ],
    });
    const result = await dicomSeries_summarize(folder, { annotationRoot: `${root}/` }, io);
    expect(result.ok && result.value.annotations).toEqual([`${root}/${FIXTURE_SERIES_UID}/measurements.dcm`]);
  });

  it('reports no annotations when the folder is absent', async () => {
    const result = await dicomSeries_summarize(folder, { annotationRoot: '/home/synth/annotations' }, io_over(files));
    expect(result.ok && result.value.annotations).toEqual([]);
  });

  it('fails on a folder with no DICOM files or an unreadable first file', async () => {
    const empty: Map<string, Buffer> = new Map<string, Buffer>([['/f/readme.md', Buffer.alloc(1)]]);
    expect((await dicomSeries_summarize('/f', {}, io_over(empty))).ok).toBe(false);
    const broken: Map<string, Buffer> = new Map<string, Buffer>([['/g/0001-x.dcm', Buffer.from('nope')]]);
    expect((await dicomSeries_summarize('/g', {}, io_over(broken))).ok).toBe(false);
  });

  it('defaults absent tags: modality OT, empty description, no geometry, one frame', async () => {
    const bare: Map<string, Buffer> = new Map<string, Buffer>([
      ['/h/0001-x.dcm', fixtureInstance_write({ instanceNumber: 1, extra: { Modality: undefined, SeriesDescription: undefined, Rows: undefined, Columns: undefined, SeriesNumber: 'abc', NumberOfFrames: '30' } })],
    ]);
    const result = await dicomSeries_summarize('/h', {}, io_over(bare));
    expect(result.ok && result.value).toMatchObject({ modality: 'OT', seriesDescription: '', frames: 30 });
    expect(result.ok && result.value.geometry).toBeUndefined();
    expect(result.ok && result.value.seriesNumber).toBeUndefined();
  });
});

describe('dicomHeader_get', () => {
  it('reads a path once and serves it from the cache after', async () => {
    const files: Map<string, Buffer> = fixtureSeries_write('/c', 1);
    const io = io_over(files);
    const path: string = [...files.keys()][0];
    const first = await dicomHeader_get(path, io);
    const second = await dicomHeader_get(path, io);
    expect(first.ok && second.ok && first.value === second.value).toBe(true);
    expect(io.reads).toEqual([path]);
  });

  it('does not cache a failed read', async () => {
    const io = io_over(new Map<string, Buffer>());
    expect((await dicomHeader_get('/nowhere.dcm', io)).ok).toBe(false);
    expect((await dicomHeader_get('/nowhere.dcm', io)).ok).toBe(false);
    expect(io.reads).toHaveLength(2);
  });

  it('bounds the cache by evicting the oldest header', async () => {
    const files: Map<string, Buffer> = fixtureSeries_write('/big', 1);
    const bytes: Buffer = [...files.values()][0];
    const many: Map<string, Buffer> = new Map<string, Buffer>();
    for (let i = 0; i < 4097; i++) many.set(`/big/${i}.dcm`, bytes);
    const io = io_over(many);
    for (let i = 0; i < 4097; i++) await dicomHeader_get(`/big/${i}.dcm`, io);
    await dicomHeader_get('/big/0.dcm', io);
    expect(io.reads.filter((path: string): boolean => path === '/big/0.dcm')).toHaveLength(2);
  });
});

describe('dicomFiles_sample', () => {
  it('keeps everything under the cap and spreads evenly over it, first and last included', () => {
    expect(dicomFiles_sample([1, 2, 3], 5)).toEqual([1, 2, 3]);
    expect(dicomFiles_sample([1, 2, 3, 4, 5, 6, 7, 8, 9], 3)).toEqual([1, 5, 9]);
    expect(dicomFiles_sample([1, 2, 3], 1)).toEqual([1]);
    expect(dicomFiles_sample([1, 2, 3], 0)).toEqual([]);
  });
});

describe('dicomFolderIO_default', () => {
  it('routes listings to the VFS and bytes to CFS', async () => {
    jest.resetModules();
    const list = jest.fn(async (_path: string) => ok([] as VFSItem[]));
    const readBinary = jest.fn(async (_path: string) => ok(Buffer.alloc(0)));
    jest.doMock('../src/vfs/dispatcher', () => ({ vfsDispatcher: { list } }));
    jest.doMock('../src/files/index', () => ({ fileContent_getBinary: readBinary }));
    const { dicomFolderIO_default } = await import('../src/dicom/series');
    await dicomFolderIO_default.list('/x');
    await dicomFolderIO_default.readBinary('/x/y.dcm');
    expect(list).toHaveBeenCalledWith('/x');
    expect(readBinary).toHaveBeenCalledWith('/x/y.dcm');
    jest.dontMock('../src/vfs/dispatcher');
    jest.dontMock('../src/files/index');
  });
});
