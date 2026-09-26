/**
 * Unit tests for a feed's data facts: read once from the first file its
 * root made — the format by name, DICOM's modality and description from one
 * header — with what cannot be known yet left for the next sweep and what is
 * known to be absent recorded with its reason. Real ProcCache; the reads are
 * a fake IO.
 */
import { procCache_get, type ProcCache, type ProcFeed, type ProcInstance } from '@fnndsc/cumin';
import { feedDataFacts_read, procDataFacts_sweep, procDataFacts_feed, dataFormat_ofName, DATA_FACTS_READER, DATA_FACTS_FEED_MS, type DataFactsIO } from '../src/dag/feedData';
import type { VFSItem } from '../src/vfs/provider';
import type { DicomTagSet } from '../src/dicom/tags';

const cache: ProcCache = procCache_get();

function feed(id: number): ProcFeed {
  return {
    id, title: `feed ${id}`, ownerUsername: 'chris', public: false, creationDate: '2026-01-01T00:00:00Z',
    finishedJobs: 1, erroredJobs: 0, startedJobs: 0, scheduledJobs: 0, cancelledJobs: 0, createdJobs: 0,
  };
}

/** A feed with one root job (and a child), its topology loaded. */
function feed_add(id: number, rootStatus: string = 'finishedSuccessfully'): void {
  cache.feed_add(feed(id));
  const root: ProcInstance = { id: id * 10, feedID: id, parentID: null, pluginName: 'pl-dircopy', params: null, status: rootStatus };
  cache.instance_add(root);
  cache.instance_add({ id: id * 10 + 1, feedID: id, parentID: id * 10, pluginName: 'pl-x', params: null, status: 'finishedSuccessfully' });
  cache.topologyLoaded_mark(id);
}

const item = (name: string, type: VFSItem['type'] = 'file'): VFSItem => ({ name, type, size: 1, owner: 'chris', date: '' } as VFSItem);
const tags = (pairs: Record<string, string>): DicomTagSet => ({
  tags: Object.entries(pairs).map(([name, value]) => ({ tag: '(0000,0000)', name, vr: 'CS', value, group: 'other', phi: false })) as DicomTagSet['tags'],
});

/** A fake IO over a folder tree: path to entries; path to header (or null). */
function io_of(tree: Record<string, VFSItem[] | 'refused'>, headers: Record<string, DicomTagSet | null> = {}): DataFactsIO & { reads: string[] } {
  const reads: string[] = [];
  return {
    reads,
    outputPath: async (instanceID: number): Promise<string | null> => `/out/${instanceID}`,
    list: async (path: string): Promise<VFSItem[] | null | 'refused'> => tree[path] ?? null,
    header: async (path: string): Promise<DicomTagSet | null> => { reads.push(path); return headers[path] ?? null; },
  };
}

beforeEach(() => cache.cache_clear());

describe('dataFormat_ofName', () => {
  it('names the formats the index knows by their extensions', () => {
    expect(['a.dcm', 'b.IMA', 'c.nii', 'd.nii.gz', 'e.mgz', 'f.JPG', 'g.jpeg', 'h.png', 'i'].map(dataFormat_ofName))
      .toEqual(['dicom', 'dicom', 'nifti', 'nifti', 'mgz', 'jpeg', 'jpeg', 'png', null]);
  });
});

describe('feedDataFacts_read', () => {
  it('reads a DICOM root\'s modality and series description from one header, descending into its folder', async () => {
    feed_add(1);
    const io = io_of(
      { '/out/10': [item('SAG-anon', 'dir'), item('input.meta.json')], '/out/10/SAG-anon': [item('0002.dcm'), item('0001.dcm')] },
      { '/out/10/SAG-anon/0001.dcm': tags({ Modality: 'MR', SeriesDescription: 'SAG MPRAGE 220 FOV  ' }) },
    );
    expect(await feedDataFacts_read(1, io)).toEqual({ format: 'dicom', modality: 'MR', seriesDescription: 'SAG MPRAGE 220 FOV' });
    expect(io.reads).toEqual(['/out/10/SAG-anon/0001.dcm']);
  });

  it('names a volume by its extension, without a read, and passes over sidecars', async () => {
    feed_add(1);
    const io = io_of({ '/out/10': [item('.hidden'), item('notes.txt'), item('brain.nii.gz')] });
    expect(await feedDataFacts_read(1, io)).toEqual({ format: 'nifti' });
    expect(io.reads).toEqual([]);
  });

  it('tries a file whose name says nothing as DICOM, and calls it other when it is not', async () => {
    feed_add(1);
    feed_add(2);
    const io = io_of(
      { '/out/10': [item('IM0001')], '/out/20': [item('blob.bin')] },
      { '/out/10/IM0001': tags({ Modality: 'CT' }) },
    );
    expect(await feedDataFacts_read(1, io)).toEqual({ format: 'dicom', modality: 'CT' });
    expect(await feedDataFacts_read(2, io)).toEqual({ format: 'other', reason: 'its first file, blob.bin, is not a format the index names' });
  });

  it('passes over a report beside the series and tries a few UID-named files as DICOM', async () => {
    feed_add(1);
    const io = io_of(
      { '/out/10': [item('1.2.3.report.xml'), item('1.2.3.4'), item('1.2.3.5'), item('1.2.3.6'), item('1.2.3.7')] },
      { '/out/10/1.2.3.6': tags({ Modality: 'US' }) },
    );
    expect(await feedDataFacts_read(1, io)).toEqual({ format: 'dicom', modality: 'US' });
    expect(io.reads).toEqual(['/out/10/1.2.3.4', '/out/10/1.2.3.5', '/out/10/1.2.3.6']);
  });

  it('says a link\'s data cannot be read here when it neither lists nor reads', async () => {
    feed_add(1);
    const link = { ...item('home_x_uploads_HNM040', 'link'), target: '/home/x/uploads/HNM040' } as VFSItem;
    expect(await feedDataFacts_read(1, io_of({ '/out/10': [link] }))).toEqual({ format: 'unknown', reason: 'its data is linked from /home/x/uploads/HNM040, which cannot be read here' });
  });

  it('records a root with no data files as unknown, with the reason', async () => {
    feed_add(1);
    expect(await feedDataFacts_read(1, io_of({ '/out/10': [item('meta.json')] }))).toEqual({ format: 'unknown', reason: 'its first job left no data files' });
  });

  it('records a failed root as unknown, and leaves a running one for later', async () => {
    feed_add(1, 'finishedWithError');
    feed_add(2, 'started');
    const io = io_of({});
    expect(await feedDataFacts_read(1, io)).toEqual({ format: 'unknown', reason: 'its first job did not finish well' });
    expect(await feedDataFacts_read(2, io)).toBeNull();
  });

  it('knows nothing of a feed whose topology is not loaded, or whose output cannot be listed', async () => {
    cache.feed_add(feed(1));
    expect(await feedDataFacts_read(1, io_of({}))).toBeNull();
    feed_add(2);
    expect(await feedDataFacts_read(2, io_of({}))).toBeNull();
  });

  it('retries a DICOM-named file whose header will not read, then records it as DICOM with the reason', async () => {
    feed_add(1);
    const io = io_of({ '/out/10': [item('a.dcm')] });
    expect(await feedDataFacts_read(1, io)).toBeNull();
    expect(await feedDataFacts_read(1, io)).toBeNull();
    expect(await feedDataFacts_read(1, io)).toEqual({ format: 'dicom', reason: 'the header of its first file, a.dcm, could not be read' });
  });

  it('follows a link that leads to a folder, and reads the series inside', async () => {
    feed_add(1);
    const link = { ...item('home_u_upload_SAG-anon', 'link'), target: '/home/u/upload/SAG-anon' } as VFSItem;
    const io = io_of(
      { '/out/10': [link, item('input.meta.json')], '/home/u/upload/SAG-anon': [item('0001.dcm')] },
      { '/home/u/upload/SAG-anon/0001.dcm': tags({ Modality: 'MR', SeriesDescription: 'SAG' }) },
    );
    expect(await feedDataFacts_read(1, io)).toEqual({ format: 'dicom', modality: 'MR', seriesDescription: 'SAG' });
  });

  it('says so when a feed\'s data is somewhere this identity may not read', async () => {
    feed_add(1);
    feed_add(2);
    const link = { ...item('home_x_uploads_Z', 'link'), target: '/home/x/uploads/Z' } as VFSItem;
    const io = io_of({ '/out/10': [link], '/home/x/uploads/Z': 'refused', '/out/20': 'refused' });
    expect(await feedDataFacts_read(1, io)).toEqual({ format: 'unknown', reason: 'its data is linked from /home/x/uploads/Z, which this identity may not read' });
    expect(await feedDataFacts_read(2, io)).toEqual({ format: 'unknown', reason: 'its data is in /out/20, which this identity may not read' });
  });

  it('reads a copy job\'s links as data, through their targets', async () => {
    feed_add(1);
    const link = { ...item('home_u_uploads_S_0001.dcm', 'link'), target: '/home/u/uploads/S/0001.dcm' } as VFSItem;
    const io = io_of({ '/out/10': [link, item('input.meta.json')] }, { '/home/u/uploads/S/0001.dcm': tags({ Modality: 'CT', SeriesDescription: 'AX' }) });
    expect(await feedDataFacts_read(1, io)).toEqual({ format: 'dicom', modality: 'CT', seriesDescription: 'AX' });
    expect(io.reads).toEqual(['/home/u/uploads/S/0001.dcm']);
  });
});

describe('the sweep', () => {
  it('records facts for every feed that has none, and leaves the rest', async () => {
    feed_add(1);
    feed_add(2);
    feed_add(3, 'started');
    cache.dataFacts_set(2, { format: 'png', reader: DATA_FACTS_READER });
    const io = io_of({ '/out/10': [item('x.mgz')], '/out/20': [item('y.nii')] });
    expect(await procDataFacts_sweep(io)).toBe(1);
    expect(cache.dataFacts_of(1)).toEqual({ format: 'mgz', reader: DATA_FACTS_READER });
    expect(cache.dataFacts_of(2)).toEqual({ format: 'png', reader: DATA_FACTS_READER });
    expect(cache.dataFacts_of(3)).toBeUndefined();
  });

  it('reads again a feed an older reader answered', async () => {
    feed_add(1);
    cache.dataFacts_set(1, { format: 'unknown', reason: 'its first job left no data files' });
    expect(await procDataFacts_sweep(io_of({ '/out/10': [item('x.png')] }))).toBe(1);
    expect(cache.dataFacts_of(1)).toEqual({ format: 'png', reader: DATA_FACTS_READER });
  });

  it('reads one feed as its topology loads, and never twice', async () => {
    feed_add(1);
    const io = io_of({ '/out/10': [item('x.png')] });
    expect(await procDataFacts_feed(1, io)).toBe(true);
    expect(await procDataFacts_feed(1, io)).toBe(false);
  });

  it('gives up on a feed whose read never answers, and goes on to the next', async () => {
    jest.useFakeTimers();
    try {
      feed_add(1);
      feed_add(2);
      const io: DataFactsIO = {
        outputPath: async (id: number) => (id === 20 ? new Promise<string | null>(() => undefined) : `/out/${id}`),
        list: async (path: string) => (path === '/out/10' ? [item('x.png')] : null),
        header: async () => null,
      };
      const sweep = procDataFacts_sweep(io);
      await jest.advanceTimersByTimeAsync(DATA_FACTS_FEED_MS + 1);
      expect(await sweep).toBe(1);
      expect(cache.dataFacts_of(1)?.format).toBe('png');
      expect(cache.dataFacts_of(2)).toBeUndefined();
    } finally {
      jest.useRealTimers();
    }
  });

  it('survives a read that throws', async () => {
    feed_add(1);
    const io: DataFactsIO = { outputPath: async () => { throw new Error('network'); }, list: async () => null, header: async () => null };
    expect(await procDataFacts_sweep(io)).toBe(0);
    expect(cache.dataFacts_of(1)).toBeUndefined();
  });
});
