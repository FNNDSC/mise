/**
 * @file The series as the kernel knows it.
 *
 * A DICOM series in ChRIS is a folder of files. Files are the truth; a
 * viewer hides them. This module answers "what is this folder as a series"
 * without walking every file: the listing gives the count, the bytes and
 * the order (oxidicom names each file by its InstanceNumber, so the name
 * sorts the stack), and one header read gives identity, modality and
 * geometry. A full positional sort is a volume renderer's business and is
 * deferred to it.
 *
 * Headers read once are kept, keyed by path, so a tag listing that follows
 * a scroll costs nothing on the second visit.
 *
 * @module
 */
import { Ok, Err, type Result } from '@fnndsc/cumin';
import { vfsDispatcher } from '../vfs/dispatcher.js';
import type { VFSItem } from '../vfs/provider.js';
import { fileContent_getBinary } from '../files/index.js';
import { TRANSFER_SYNTAX_NAMES } from './dictionary.js';
import { dicomTags_read, dicomTag_find, type DicomTag, type DicomTagSet } from './tags.js';

/** How a folder is read; injected so the summary is testable without a daemon. */
export interface DicomFolderIO {
  list(path: string): Promise<Result<VFSItem[]>>;
  readBinary(path: string): Promise<Result<Buffer>>;
}

/** The real folder reader: the VFS for listings, CFS for bytes. */
export const dicomFolderIO_default: DicomFolderIO = {
  list: (path: string): Promise<Result<VFSItem[]>> => vfsDispatcher.list(path),
  readBinary: (path: string): Promise<Result<Buffer>> => fileContent_getBinary(path),
};

/** How a folder's files are ordered into a stack. */
export type DicomSeriesOrder = 'filename' | 'unknown';

/** The voxel grid, from one header. */
export interface DicomGeometry {
  rows: number;
  columns: number;
  /** Row and column spacing in mm. */
  pixelSpacing?: [number, number];
  sliceThickness?: number;
  spacingBetweenSlices?: number;
}

/** What one folder is as a series. */
export interface DicomSeriesSummary {
  path: string;
  seriesInstanceUID?: string;
  studyInstanceUID?: string;
  modality: string;
  seriesDescription: string;
  seriesNumber?: number;
  /** DICOM files in the folder. */
  instances: number;
  /** Frames in the header read; one for a classic single-frame file. */
  frames: number;
  order: DicomSeriesOrder;
  geometry?: DicomGeometry;
  transferSyntax?: { uid: string; name?: string };
  /** Sum of the folder's DICOM file sizes. */
  bytes: number;
  /** The file whose header answered, first in stack order. */
  header: string;
  /** Files ordered for a stack, first to last. */
  files: string[];
  /** Annotation files found for the series' UID. */
  annotations: string[];
}

/** Options for a series summary. */
export interface DicomSeriesOptions {
  /** Where annotation folders live; `<root>/<SeriesInstanceUID>` is listed when given. */
  annotationRoot?: string;
}

/** A folder's DICOM files, ordered. */
export interface DicomFolderListing {
  files: Array<{ path: string; size: number }>;
  order: DicomSeriesOrder;
}

/** Headers kept by path. Bounded; the oldest entry leaves first. */
const HEADER_CACHE_LIMIT: number = 4096;
const headerCache: Map<string, DicomTagSet> = new Map<string, DicomTagSet>();

/**
 * Reads one file's header through the cache.
 *
 * @param path - The file's VFS path.
 * @param io - The folder reader.
 * @returns The tag set, or an error when the file could not be read or parsed.
 */
export async function dicomHeader_get(path: string, io: DicomFolderIO = dicomFolderIO_default): Promise<Result<DicomTagSet>> {
  const cached: DicomTagSet | undefined = headerCache.get(path);
  if (cached !== undefined) return Ok(cached);
  const bytes: Result<Buffer> = await io.readBinary(path);
  if (!bytes.ok) return Err();
  const parsed: Result<DicomTagSet> = dicomTags_read(bytes.value);
  if (!parsed.ok) return Err();
  if (headerCache.size >= HEADER_CACHE_LIMIT) {
    const oldest: string | undefined = headerCache.keys().next().value;
    if (oldest !== undefined) headerCache.delete(oldest);
  }
  headerCache.set(path, parsed.value);
  return parsed;
}

/**
 * Forgets every cached header.
 */
export function dicomHeaderCache_clear(): void {
  headerCache.clear();
}

/**
 * Lists a folder's DICOM files in stack order.
 *
 * Order is `filename` when every file starts with a number and a dash
 * (oxidicom's `<InstanceNumber>-<SOPInstanceUID>.dcm`), sorted by that number;
 * otherwise `unknown`, sorted by name.
 *
 * @param folder - The folder's VFS path.
 * @param io - The folder reader.
 * @returns The ordered files with sizes, or an error when the folder cannot be listed.
 */
export async function dicomFolder_list(folder: string, io: DicomFolderIO = dicomFolderIO_default): Promise<Result<DicomFolderListing>> {
  const listing: Result<VFSItem[]> = await io.list(folder);
  if (!listing.ok) return Err();
  const base: string = folder.endsWith('/') ? folder.slice(0, -1) : folder;
  const entries: VFSItem[] = listing.value.filter(
    (item: VFSItem): boolean => item.type === 'file' && /\.dcm$/i.test(item.name),
  );
  const numbered: boolean = entries.length > 0 && entries.every((item: VFSItem): boolean => /^\d+-/.test(item.name));
  const sorted: VFSItem[] = [...entries].sort((a: VFSItem, b: VFSItem): number =>
    numbered ? parseInt(a.name, 10) - parseInt(b.name, 10) || a.name.localeCompare(b.name) : a.name.localeCompare(b.name),
  );
  return Ok({
    files: sorted.map((item: VFSItem): { path: string; size: number } => ({ path: `${base}/${item.name}`, size: item.size })),
    order: numbered ? 'filename' : 'unknown',
  });
}

/**
 * Picks at most `cap` files spread evenly across the stack, always keeping
 * the first and the last.
 *
 * @param files - The ordered files.
 * @param cap - The most to keep.
 * @returns The chosen files, in order.
 */
export function dicomFiles_sample<T>(files: T[], cap: number): T[] {
  if (cap <= 0) return [];
  if (files.length <= cap) return files;
  if (cap === 1) return [files[0]];
  const chosen: T[] = [];
  const step: number = (files.length - 1) / (cap - 1);
  for (let i = 0; i < cap; i++) chosen.push(files[Math.round(i * step)]);
  return chosen;
}

/**
 * Summarizes a folder as a series from its listing and one header.
 *
 * @param folder - The folder's VFS path.
 * @param options - Where to look for annotations.
 * @param io - The folder reader.
 * @returns The summary; an error when the folder cannot be listed, holds no
 *   DICOM files, or its first file cannot be read.
 */
export async function dicomSeries_summarize(
  folder: string,
  options: DicomSeriesOptions = {},
  io: DicomFolderIO = dicomFolderIO_default,
): Promise<Result<DicomSeriesSummary>> {
  const listed: Result<DicomFolderListing> = await dicomFolder_list(folder, io);
  if (!listed.ok || listed.value.files.length === 0) return Err();
  const files: Array<{ path: string; size: number }> = listed.value.files;
  const header: Result<DicomTagSet> = await dicomHeader_get(files[0].path, io);
  if (!header.ok) return Err();
  const tags: DicomTag[] = header.value.tags;

  const seriesInstanceUID: string | undefined = tagText_of(tags, 'SeriesInstanceUID');
  const summary: DicomSeriesSummary = {
    path: folder,
    ...(seriesInstanceUID !== undefined ? { seriesInstanceUID } : {}),
    ...(tagText_of(tags, 'StudyInstanceUID') !== undefined ? { studyInstanceUID: tagText_of(tags, 'StudyInstanceUID') } : {}),
    modality: tagText_of(tags, 'Modality') ?? 'OT',
    seriesDescription: tagText_of(tags, 'SeriesDescription') ?? '',
    ...(tagNumber_of(tags, 'SeriesNumber') !== undefined ? { seriesNumber: tagNumber_of(tags, 'SeriesNumber') } : {}),
    instances: files.length,
    frames: tagNumber_of(tags, 'NumberOfFrames') ?? 1,
    order: listed.value.order,
    ...(geometry_of(tags) !== undefined ? { geometry: geometry_of(tags) } : {}),
    ...(header.value.transferSyntaxUID !== undefined
      ? {
          transferSyntax: {
            uid: header.value.transferSyntaxUID,
            ...(TRANSFER_SYNTAX_NAMES[header.value.transferSyntaxUID] !== undefined ? { name: TRANSFER_SYNTAX_NAMES[header.value.transferSyntaxUID] } : {}),
          },
        }
      : {}),
    bytes: files.reduce((total: number, file: { size: number }): number => total + file.size, 0),
    header: files[0].path,
    files: files.map((file: { path: string }): string => file.path),
    annotations: [],
  };

  if (options.annotationRoot !== undefined && seriesInstanceUID !== undefined) {
    const root: string = options.annotationRoot.endsWith('/') ? options.annotationRoot.slice(0, -1) : options.annotationRoot;
    const found: Result<VFSItem[]> = await io.list(`${root}/${seriesInstanceUID}`);
    if (found.ok) {
      summary.annotations = found.value
        .filter((item: VFSItem): boolean => item.type === 'file')
        .map((item: VFSItem): string => `${root}/${seriesInstanceUID}/${item.name}`)
        .sort();
    }
  }
  return Ok(summary);
}

/**
 * A tag's text, or nothing when absent or empty.
 */
function tagText_of(tags: DicomTag[], name: string): string | undefined {
  const tag: DicomTag | undefined = dicomTag_find(tags, name);
  return tag === undefined || tag.value === '' ? undefined : tag.value;
}

/**
 * A tag's first value as a number, or nothing when absent or not numeric.
 */
function tagNumber_of(tags: DicomTag[], name: string): number | undefined {
  const text: string | undefined = tagText_of(tags, name);
  if (text === undefined) return undefined;
  const parsed: number = Number(text.split('\\')[0]);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * The voxel grid from a header, when it has one.
 */
function geometry_of(tags: DicomTag[]): DicomGeometry | undefined {
  const rows: number | undefined = tagNumber_of(tags, 'Rows');
  const columns: number | undefined = tagNumber_of(tags, 'Columns');
  if (rows === undefined || columns === undefined) return undefined;
  const geometry: DicomGeometry = { rows, columns };
  const spacing: string | undefined = tagText_of(tags, 'PixelSpacing');
  if (spacing !== undefined) {
    const parts: number[] = spacing.split('\\').map(Number);
    if (parts.length === 2 && parts.every(Number.isFinite)) geometry.pixelSpacing = [parts[0], parts[1]];
  }
  const thickness: number | undefined = tagNumber_of(tags, 'SliceThickness');
  if (thickness !== undefined) geometry.sliceThickness = thickness;
  const between: number | undefined = tagNumber_of(tags, 'SpacingBetweenSlices');
  if (between !== undefined) geometry.spacingBetweenSlices = between;
  return geometry;
}
