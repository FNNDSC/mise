/**
 * Unit tests for a feed's data facts: read once from the first file its
 * root made — the format by name, DICOM's modality and description from one
 * header — with what cannot be known yet left for the next sweep and what is
 * known to be absent recorded with its reason. Real ProcCache; the reads are
 * a fake IO.
 */
import { procCache_get, type ProcCache, type ProcFeed, type ProcInstance } from '@fnndsc/cumin';
import { feedDataFacts_read, procDataFacts_sweep, procDataFacts_feed, dataFormat_ofName, type DataFactsIO } from '../src/dag/feedData';
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
function io_of(tree: Record<string, VFSItem[]>, headers: Record<string, DicomTagSet | null> = {}): DataFactsIO & { reads: string[] } {
  const reads: string[] = [];
  return {
    reads,
    outputPath: async (instanceID: number): Promise<string | null> => `/out/${instanceID}`,
    list: async (path: string): Promise<VFSItem[] | null> => tree[path] ?? null,
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

  it('retries a DICOM-named file whose header will not read, then calls it unknown', async () => {
    feed_add(1);
    const io = io_of({ '/out/10': [item('a.dcm')] });
    expect(await feedDataFacts_read(1, io)).toBeNull();
    expect(await feedDataFacts_read(1, io)).toBeNull();
    expect(await feedDataFacts_read(1, io)).toEqual({ format: 'unknown', reason: 'its first file, a.dcm, is named DICOM but its header could not be read' });
  });
});

describe('the sweep', () => {
  it('records facts for every feed that has none, and leaves the rest', async () => {
    feed_add(1);
    feed_add(2);
    feed_add(3, 'started');
    cache.dataFacts_set(2, { format: 'png' });
    const io = io_of({ '/out/10': [item('x.mgz')], '/out/20': [item('y.nii')] });
    expect(await procDataFacts_sweep(io)).toBe(1);
    expect(cache.dataFacts_of(1)).toEqual({ format: 'mgz' });
    expect(cache.dataFacts_of(2)).toEqual({ format: 'png' });
    expect(cache.dataFacts_of(3)).toBeUndefined();
  });

  it('reads one feed as its topology loads, and never twice', async () => {
    feed_add(1);
    const io = io_of({ '/out/10': [item('x.png')] });
    expect(await procDataFacts_feed(1, io)).toBe(true);
    expect(await procDataFacts_feed(1, io)).toBe(false);
  });

  it('survives a read that throws', async () => {
    feed_add(1);
    const io: DataFactsIO = { outputPath: async () => { throw new Error('network'); }, list: async () => null, header: async () => null };
    expect(await procDataFacts_sweep(io)).toBe(0);
    expect(cache.dataFacts_of(1)).toBeUndefined();
  });
});
