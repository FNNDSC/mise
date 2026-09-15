/**
 * `dicomSlice_gray`: one slice read to an 8-bit luminance grid for a text
 * thumbnail. dcmjs writes the fixtures, so the decode path is real; the reader
 * is injected so no daemon is needed.
 */
import { describe, it, expect } from '@jest/globals';
import type { Result } from '@fnndsc/cumin';
import { fixtureInstance_write } from './dicomFixture';
import { dicomSlice_gray, type DicomGrayOutcome, type DicomFolderIO } from '../src/dicom/index.js';

/** A reader that hands back one file's bytes for every path. */
function io_of(bytes: Buffer): DicomFolderIO {
  return {
    list: async () => ({ ok: false } as Result<never>),
    readBinary: async () => ({ ok: true, value: bytes }),
  };
}

/** A 4×4 slice whose value rises with the column: 0, 85, 170, 255. */
function gradient(extra: Record<string, unknown> = {}): Buffer {
  const pixels = new Uint16Array(16);
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) pixels[y * 4 + x] = x * 85;
  return fixtureInstance_write({ instanceNumber: 1, rows: 4, columns: 4, extra, raw: { '7FE00010': { vr: 'OW', Value: [pixels.buffer] } } });
}

describe('dicomSlice_gray', () => {
  it('reads a slice to an 8-bit grid, bright where the pixels are high', async () => {
    const result: Result<DicomGrayOutcome> = await dicomSlice_gray('/s/1.dcm', io_of(gradient()));
    expect(result.ok).toBe(true);
    if (!result.ok || result.value.kind !== 'gray') throw new Error('expected a gray grid');
    const { width, height, gray } = result.value;
    expect(width).toBe(4);
    expect(height).toBe(4);
    // A column gradient: the left edge is dark, the right edge bright.
    expect(gray[0]).toBeLessThan(gray[3]);
    expect(gray[3]).toBeGreaterThan(200);
  });

  it('inverts MONOCHROME1 so bright still reads high', async () => {
    const result: Result<DicomGrayOutcome> = await dicomSlice_gray('/s/1.dcm', io_of(gradient({ PhotometricInterpretation: 'MONOCHROME1' })));
    if (!result.ok || result.value.kind !== 'gray') throw new Error('expected a gray grid');
    const { gray } = result.value;
    // MONOCHROME1: the high stored value is dark, so the mapping flips.
    expect(gray[0]).toBeGreaterThan(gray[3]);
  });

  it('errors when the bytes are not a DICOM file', async () => {
    const result: Result<DicomGrayOutcome> = await dicomSlice_gray('/s/x', io_of(Buffer.from('not a dicom')));
    expect(result.ok).toBe(false);
  });

  it('errors when the file cannot be read', async () => {
    const io: DicomFolderIO = { list: async () => ({ ok: false } as Result<never>), readBinary: async () => ({ ok: false } as Result<never>) };
    const result: Result<DicomGrayOutcome> = await dicomSlice_gray('/s/gone', io);
    expect(result.ok).toBe(false);
  });
});
