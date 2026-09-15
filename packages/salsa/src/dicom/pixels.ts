/**
 * @file One DICOM slice as an 8-bit grayscale grid, for a text thumbnail.
 *
 * The kernel reads a slice's pixels, applies the modality rescale and a
 * window/level (the file's own, or an auto range when it declares none), and
 * normalises to 0..255 with MONOCHROME1 inverted so bright always reads high.
 * A surface then renders that grid — an ASCII ramp on any pipe, ANSI
 * half-blocks on a colour terminal — without knowing anything about DICOM.
 *
 * Only uncompressed transfer syntaxes are read here; a compressed one (the
 * JPEG family, RLE) needs a codec the kernel does not carry, and says so
 * rather than pretending. dcmjs decodes the endianness of the uncompressed
 * ones, so the pixels arrive native-endian in the naturalised dataset.
 *
 * @module
 */
import dcmjs from 'dcmjs';
import { Ok, Err, type Result } from '@fnndsc/cumin';
import { fileContent_getBinary } from '../files/index.js';
import { type DicomFolderIO, dicomFolderIO_default } from './series.js';

/** A slice's luminance: `gray[y * width + x]`, 0 (black) to 255 (white). */
export interface DicomGray {
  width: number;
  height: number;
  gray: Uint8Array;
}

/**
 * The outcome of reading a slice for a thumbnail: the grid, or the news that
 * the pixels are compressed and this build cannot decode them. An unreadable
 * or non-DICOM file is an error, not an outcome.
 */
export type DicomGrayOutcome = ({ kind: 'gray' } & DicomGray) | { kind: 'compressed'; transferSyntax: string };

/** Transfer syntaxes the kernel cannot decode without a codec: JPEG* and RLE. */
const COMPRESSED_SYNTAX: RegExp = /^1\.2\.840\.10008\.1\.2\.[45]/;

/**
 * Reads one DICOM slice as an 8-bit grayscale grid.
 *
 * @param path - The slice file's VFS path.
 * @param io - The reader, injected for tests.
 * @returns The grid, the compressed verdict, or an error when the bytes are
 *   not a readable DICOM file.
 */
export async function dicomSlice_gray(path: string, io: DicomFolderIO = dicomFolderIO_default): Promise<Result<DicomGrayOutcome>> {
  const bytes: Result<Buffer> = await io.readBinary(path);
  if (!bytes.ok) return Err();
  try {
    const buffer: ArrayBuffer = new Uint8Array(bytes.value).slice().buffer as ArrayBuffer;
    const message = dcmjs.data.DicomMessage.readFile(buffer, { ignoreErrors: true });
    const meta: Record<string, unknown> = dcmjs.data.DicomMetaDictionary.naturalizeDataset(message.meta) as Record<string, unknown>;
    const ds: Record<string, unknown> = dcmjs.data.DicomMetaDictionary.naturalizeDataset(message.dict) as Record<string, unknown>;
    const transferSyntax: string = typeof meta.TransferSyntaxUID === 'string' ? meta.TransferSyntaxUID : '';
    if (COMPRESSED_SYNTAX.test(transferSyntax)) return Ok({ kind: 'compressed', transferSyntax });

    const height: number = numberOf(ds.Rows) ?? 0;
    const width: number = numberOf(ds.Columns) ?? 0;
    if (height === 0 || width === 0) return Err();
    const count: number = width * height;
    const pixelData: unknown = Array.isArray(ds.PixelData) ? ds.PixelData[0] : ds.PixelData;
    if (!(pixelData instanceof ArrayBuffer)) return Err();

    const bits: number = numberOf(ds.BitsAllocated) ?? 16;
    const signed: boolean = numberOf(ds.PixelRepresentation) === 1;
    const src: Float64Array = new Float64Array(count);
    if (bits === 16) {
      const view = signed ? new Int16Array(pixelData, 0, count) : new Uint16Array(pixelData, 0, count);
      for (let i = 0; i < count; i++) src[i] = view[i];
    } else if (bits === 8) {
      const view = new Uint8Array(pixelData, 0, count);
      for (let i = 0; i < count; i++) src[i] = view[i];
    } else {
      return Err();
    }

    // Modality rescale: stored value to a physical unit (HU for CT, etc.).
    const slope: number = numberOf(ds.RescaleSlope) ?? 1;
    const intercept: number = numberOf(ds.RescaleIntercept) ?? 0;
    if (slope !== 1 || intercept !== 0) for (let i = 0; i < count; i++) src[i] = src[i] * slope + intercept;

    // The file's own window/level, or an auto range when it declares none.
    let center: number | undefined = firstNumber(ds.WindowCenter);
    let width_wl: number | undefined = firstNumber(ds.WindowWidth);
    if (center === undefined || width_wl === undefined || width_wl <= 0) {
      const auto = autoWindow(src);
      center = auto.center;
      width_wl = auto.width;
    }
    const low: number = center - width_wl / 2;
    const invert: boolean = ds.PhotometricInterpretation === 'MONOCHROME1';
    const gray: Uint8Array = new Uint8Array(count);
    for (let i = 0; i < count; i++) {
      let t: number = ((src[i] - low) / width_wl) * 255;
      t = t < 0 ? 0 : t > 255 ? 255 : t;
      gray[i] = invert ? 255 - t : t;
    }
    return Ok({ kind: 'gray', width, height, gray });
  } catch {
    return Err();
  }
}

/** The first number of a DICOM value that may be a number, an array, or a DS string. */
function firstNumber(value: unknown): number | undefined {
  const one: unknown = Array.isArray(value) ? value[0] : value;
  if (typeof one === 'number') return Number.isFinite(one) ? one : undefined;
  if (typeof one === 'string') {
    const parsed: number = Number.parseFloat(one);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

/** A whole number from a DICOM value that may arrive as a number or a string. */
function numberOf(value: unknown): number | undefined {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const parsed: number = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

/** A window from the robust range of the data: its 2nd to 98th percentile. */
function autoWindow(src: Float64Array): { center: number; width: number } {
  const sorted: Float64Array = src.slice().sort();
  const low: number = sorted[Math.floor(sorted.length * 0.02)] ?? 0;
  const high: number = sorted[Math.floor(sorted.length * 0.98)] ?? low + 1;
  const width: number = Math.max(1, high - low);
  return { center: low + width / 2, width };
}
