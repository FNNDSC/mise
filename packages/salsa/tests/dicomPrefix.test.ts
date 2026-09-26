/**
 * Unit tests for reading a DICOM header from the start of a file alone: the
 * download stops after a bound and the parse at the pixel data, so a cine
 * loop costs its first megabytes, not all of them.
 */
const mockStream = jest.fn();
jest.mock('../src/files/index', () => ({
  ...jest.requireActual('../src/files/index'),
  fileContent_getBinaryStream: (path: string) => mockStream(path),
}));

import { Readable } from 'stream';
import { dicomHeaderPrefix_get, DICOM_HEADER_PREFIX_BYTES } from '../src/dicom/series';
import { dicomTags_read, dicomTag_find } from '../src/dicom/tags';
import { fixtureInstance_write } from './dicomFixture';

beforeEach(() => jest.clearAllMocks());

describe('dicomTags_read, header only', () => {
  it('reads every tag before the pixels, and none of the pixels', () => {
    const bytes = fixtureInstance_write({ instanceNumber: 1 });
    const whole = dicomTags_read(bytes);
    const header = dicomTags_read(bytes, true);
    expect(whole.ok && header.ok).toBe(true);
    if (!whole.ok || !header.ok) return;
    expect(dicomTag_find(header.value.tags, 'Modality')?.value).toBe(dicomTag_find(whole.value.tags, 'Modality')?.value);
    expect(dicomTag_find(header.value.tags, 'PixelData')).toBeUndefined();
  });
});

describe('dicomHeaderPrefix_get', () => {
  it('reads a whole buffer\'s start, when a provider answers with bytes', async () => {
    mockStream.mockResolvedValueOnce({ ok: true, value: { stream: fixtureInstance_write({ instanceNumber: 2 }) } });
    const read = await dicomHeaderPrefix_get('/SERVICES/PACS/x.dcm');
    expect(read.ok && dicomTag_find(read.value.tags, 'Modality') !== undefined).toBe(true);
  });

  it('stops a stream once it has the bound, and ends the download', async () => {
    const bytes = fixtureInstance_write({ instanceNumber: 3 });
    // The header, then far more than the bound of what would be pixels.
    const filler = Buffer.alloc(DICOM_HEADER_PREFIX_BYTES, 0);
    let served = 0;
    const stream = new Readable({
      read(): void {
        if (served === 0) { served += bytes.length; this.push(bytes); return; }
        if (served > DICOM_HEADER_PREFIX_BYTES * 4) { this.push(null); return; }
        served += filler.length;
        this.push(filler);
      },
    });
    mockStream.mockResolvedValueOnce({ ok: true, value: { stream } });
    const read = await dicomHeaderPrefix_get('/home/u/cine.dcm');
    expect(read.ok).toBe(true);
    expect(served).toBeLessThan(DICOM_HEADER_PREFIX_BYTES * 3);
    expect(stream.destroyed).toBe(true);
  });

  it('fails when the file cannot be opened, or is not a stream of bytes', async () => {
    mockStream.mockResolvedValueOnce({ ok: false });
    expect((await dicomHeaderPrefix_get('/nowhere')).ok).toBe(false);
    mockStream.mockResolvedValueOnce({ ok: true, value: { stream: 42 } });
    expect((await dicomHeaderPrefix_get('/odd')).ok).toBe(false);
  });
});
