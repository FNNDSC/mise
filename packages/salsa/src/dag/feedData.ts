/**
 * @file What a feed's data is, read once from the first file its root made.
 *
 * A feed begins from data — a DICOM series pulled from a PACS, a NIfTI
 * volume, a folder of JPEGs — and a space arranged by data needs to know
 * which, and for DICOM the modality and the series description. The index
 * learns it once per feed, after the topology sweep, from the root job's
 * output: the first file there, by name, descending into a folder when the
 * output is one; its extension names the format, and for DICOM one header
 * read gives the modality and description. The facts are persisted with the
 * feed's checkpoint shard, so a feed is read once, ever — never at view time.
 *
 * What cannot be known yet (a root still running, a read that failed) is
 * left unset and tried again on the next sweep; what is known to be absent
 * (no output, a root that failed) is recorded as `unknown`, with the reason.
 *
 * @module
 */
import { procCache_get, status_isTerminal, type ProcCache, type ProcFeedDataFacts, type ProcInstance } from '@fnndsc/cumin';
import type { Result } from '@fnndsc/cumin';
import type { VFSItem } from '../vfs/provider.js';
import { dicomTag_find, type DicomTagSet } from '../dicom/tags.js';

/** How deep into nested folders the first file is looked for. */
const DATA_DEPTH_MAX: number = 3;
/**
 * This reader's version, written into every record it makes: facts from an
 * older reader are read again, so a better reading reaches feeds read before
 * it. Raise it whenever what is read, or how, changes.
 */
export const DATA_FACTS_READER: number = 1;
/** Reads of a DICOM-named file that fail before its feed is recorded without a header. */
const HEADER_TRIES_MAX: number = 3;
/** Failed header reads so far, by feed. */
const headerTries: Map<number, number> = new Map();
/** Feeds read at once by a sweep: a feed costs a few CUBE round trips, and one at a time took three seconds each. */
export const DATA_FACTS_IN_FLIGHT: number = 4;
/**
 * How long one feed may take: a read that never answers (a link to a file
 * that went away, a stalled download) must not hold a worker for good —
 * four such hangs once stopped a whole sweep. The feed is tried again later.
 */
export const DATA_FACTS_FEED_MS: number = 45_000;
/** Whether a sweep is under way: one at a time. */
let sweeping: boolean = false;

/**
 * How the sweep reads: injected, so it is testable without a daemon, and so
 * the provider that owns output paths can hand its reader in.
 *
 * @property outputPath - A job's output folder, or null when it has none.
 * @property list - A folder's entries, or null when it cannot be listed.
 * @property header - A DICOM file's tags, or null when it is not one.
 */
export interface DataFactsIO {
  outputPath(instanceID: number): Promise<string | null>;
  list(path: string): Promise<VFSItem[] | null>;
  header(path: string): Promise<DicomTagSet | null>;
}

/**
 * The reader the daemon uses, given the provider's output-path reader.
 *
 * @param outputPath - Reads a job's output folder.
 * @returns The IO.
 */
export function dataFactsIO_of(outputPath: (instanceID: number) => Promise<string | null>): DataFactsIO {
  // The dispatcher and the DICOM reader are reached at call time: the /proc
  // provider that hands this reader in is itself one of the dispatcher's
  // providers, and a module-level import would close that circle.
  return {
    outputPath,
    list: async (path: string): Promise<VFSItem[] | null> => {
      const { vfsDispatcher } = await import('../vfs/dispatcher.js');
      const listed: Result<VFSItem[]> = await vfsDispatcher.list(path);
      return listed.ok ? listed.value : null;
    },
    header: async (path: string): Promise<DicomTagSet | null> => {
      const { dicomHeader_get } = await import('../dicom/series.js');
      const read: Result<DicomTagSet> = await dicomHeader_get(path);
      return read.ok ? read.value : null;
    },
  };
}

/**
 * The format a file's name says, or null when its name says nothing.
 *
 * @param name - The file's name.
 * @returns The format, or null.
 */
export function dataFormat_ofName(name: string): Exclude<ProcFeedDataFacts['format'], 'other' | 'unknown'> | null {
  const lower: string = name.toLowerCase();
  if (/\.(dcm|dicom|ima)$/.test(lower)) return 'dicom';
  if (/\.nii(\.gz)?$/.test(lower)) return 'nifti';
  if (/\.mgz$/.test(lower)) return 'mgz';
  if (/\.jpe?g$/.test(lower)) return 'jpeg';
  if (/\.png$/.test(lower)) return 'png';
  return null;
}

/** A name that is not data: a hidden file, or the sidecars a job leaves beside its output. */
function name_isSidecar(name: string): boolean {
  return name.startsWith('.') || /\.(json|txt|log|csv|md)$/i.test(name);
}

/**
 * The first data file under a folder: by name, a file whose name says its
 * format first, else the first file at all, descending into the first
 * folder when a level holds no file.
 *
 * @returns The file's path and name, or a reason when there is none.
 */
async function dataFile_find(folder: string, io: DataFactsIO): Promise<{ path: string; name: string } | { reason: string } | null> {
  // A copy job's output is often links to what it copied — a file, or a
  // whole folder: a link is data too, named by its own name and read, or
  // descended into, through its target.
  const isData = (item: VFSItem): boolean => (item.type === 'file' || item.type === 'link') && !name_isSidecar(item.name);
  const byName = (a: VFSItem, b: VFSItem): number => a.name.localeCompare(b.name, undefined, { numeric: true });
  const pathOf = (at: string, item: VFSItem): string => (item.type === 'link' && item.target !== undefined ? item.target : `${at}/${item.name}`);
  let at: string = folder.replace(/\/$/, '');
  for (let depth = 0; depth <= DATA_DEPTH_MAX; depth++) {
    const items: VFSItem[] | null = await io.list(at);
    if (items === null) return null;
    const data: VFSItem[] = items.filter(isData).sort(byName);
    // A file whose name says its format, plain or linked.
    const named: VFSItem | undefined = data.find((item: VFSItem): boolean => dataFormat_ofName(item.name) !== null);
    if (named !== undefined) return { path: pathOf(at, named), name: named.name };
    // A plain file whose name says nothing (a DICOM without an extension).
    const plain: VFSItem | undefined = data.find((item: VFSItem): boolean => item.type === 'file');
    if (plain !== undefined) return { path: pathOf(at, plain), name: plain.name };
    // A link whose name says nothing: a folder when its target lists, else a file.
    const link: VFSItem | undefined = data.find((item: VFSItem): boolean => item.type === 'link');
    if (link !== undefined) {
      const target: string = pathOf(at, link);
      const inside: VFSItem[] | null = await io.list(target);
      if (inside === null) return { path: target, name: link.name };
      at = target.replace(/\/$/, '');
      continue;
    }
    const folders: VFSItem[] = items.filter((item: VFSItem): boolean => item.type === 'dir' && !item.name.startsWith('.')).sort(byName);
    const next: VFSItem | undefined = folders[0];
    if (next === undefined) return { reason: 'its first job left no data files' };
    at = `${at}/${next.name}`;
  }
  return { reason: `no data file within ${DATA_DEPTH_MAX} folders of its first job's output` };
}

/**
 * Reads what one feed's data is.
 *
 * @param feedID - The feed.
 * @param io - How to read.
 * @param cache - The index.
 * @returns The facts; null when they cannot be known yet (the topology not
 *   loaded, the root still running, a read that failed) — try again later.
 */
export async function feedDataFacts_read(feedID: number, io: DataFactsIO, cache: ProcCache = procCache_get()): Promise<ProcFeedDataFacts | null> {
  if (!cache.topologyLoaded_has(feedID)) return null;
  const roots: ProcInstance[] = cache.feedInstanceIDs_get(feedID)
    .map((id: number): ProcInstance | undefined => cache.instance_get(id))
    .filter((inst: ProcInstance | undefined): inst is ProcInstance => inst !== undefined && inst.parentID === null)
    .sort((a: ProcInstance, b: ProcInstance): number => a.id - b.id);
  const root: ProcInstance | undefined = roots[0];
  if (root === undefined) return { format: 'unknown', reason: 'the feed has no jobs' };
  if (root.status !== 'finishedSuccessfully') {
    return status_isTerminal(root.status ?? '') ? { format: 'unknown', reason: 'its first job did not finish well' } : null;
  }
  const output: string | null = await io.outputPath(root.id);
  if (output === null) return null;
  const file = await dataFile_find(output, io);
  if (file === null) return null;
  if ('reason' in file) return { format: 'unknown', reason: file.reason };
  const named = dataFormat_ofName(file.name);
  // A DICOM file often carries no extension: a name that says nothing is
  // tried as DICOM before it is called other.
  if (named !== null && named !== 'dicom') return { format: named };
  const header: DicomTagSet | null = await io.header(file.path);
  if (header === null) {
    if (named !== 'dicom') return { format: 'other', reason: `its first file, ${file.name}, is not a format the index names` };
    const tries: number = (headerTries.get(feedID) ?? 0) + 1;
    headerTries.set(feedID, tries);
    // Its name already says DICOM: record that, and why there is no modality.
    return tries < HEADER_TRIES_MAX ? null : { format: 'dicom', reason: `the header of its first file, ${file.name}, could not be read` };
  }
  headerTries.delete(feedID);
  const facts: ProcFeedDataFacts = { format: 'dicom' };
  const modality: string | undefined = dicomTag_find(header.tags, 'Modality')?.value.trim();
  const description: string | undefined = dicomTag_find(header.tags, 'SeriesDescription')?.value.trim();
  if (modality !== undefined && modality.length > 0) facts.modality = modality;
  if (description !== undefined && description.length > 0) facts.seriesDescription = description;
  return facts;
}

/**
 * Reads the data facts of every feed that has none yet — the index's quiet
 * tail after the topology sweep. A few feeds are read at once
 * ({@link DATA_FACTS_IN_FLIGHT}), which is the throttle; what cannot be known
 * yet is tried again on the next sweep.
 *
 * @param io - How to read.
 * @returns How many feeds were read.
 */
export async function procDataFacts_sweep(io: DataFactsIO): Promise<number> {
  if (sweeping) return 0;
  sweeping = true;
  const cache: ProcCache = procCache_get();
  let read: number = 0;
  try {
    // Newest first: the work an operator is looking at now is read first.
    const queue: number[] = cache.feedIDs_get().filter((feedID: number): boolean => !dataFacts_current(cache, feedID)).sort((a: number, b: number): number => b - a);
    const worker = async (): Promise<void> => {
      for (let feedID = queue.shift(); feedID !== undefined; feedID = queue.shift()) {
        if (await procDataFacts_feed(feedID, io, cache)) read += 1;
      }
    };
    await Promise.all(Array.from({ length: DATA_FACTS_IN_FLIGHT }, worker));
  } finally {
    sweeping = false;
  }
  return read;
}

/**
 * Reads one feed's data facts, if it has none yet: a feed whose topology
 * just loaded need not wait for the next sweep.
 *
 * @param feedID - The feed.
 * @param io - How to read.
 * @param cache - The index.
 * @returns Whether facts were recorded.
 */
export async function procDataFacts_feed(feedID: number, io: DataFactsIO, cache: ProcCache = procCache_get()): Promise<boolean> {
  if (dataFacts_current(cache, feedID)) return false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const late: Promise<null> = new Promise<null>((resolve: (value: null) => void): void => {
      timer = setTimeout((): void => resolve(null), DATA_FACTS_FEED_MS);
    });
    const facts: ProcFeedDataFacts | null = await Promise.race([feedDataFacts_read(feedID, io, cache), late]);
    if (facts === null) return false;
    cache.dataFacts_set(feedID, { ...facts, reader: DATA_FACTS_READER });
    return true;
  } catch {
    // A read that throws is a read that failed: the next sweep tries again.
    return false;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** Whether a feed's facts were written by this reader: none, or an older reader's, are read again. */
function dataFacts_current(cache: ProcCache, feedID: number): boolean {
  return cache.dataFacts_of(feedID)?.reader === DATA_FACTS_READER;
}
