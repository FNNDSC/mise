/**
 * @file Tests for the PACS VFS content handler (metadata.json synthesis and
 * the image_slices.dcm placeholder). Pure logic; only the query-result
 * fetch callback is faked.
 */

import { pacsVfs_read, pacsVfs_readBinary } from '../src/vfs/providers/pacs_content';
import { errorStack, PACSQueryDecodedResult } from '@fnndsc/cumin';

const SERIES_PATH: string =
  '/net/pacs/queries/12_PatientID:X/Study_1.2_Brain/Series_1.2.3_T1/metadata.json';

const decoded = (json: unknown): PACSQueryDecodedResult => ({ raw: 'r', json });

const fetch_make = (json: unknown): jest.Mock =>
  jest.fn(async () => decoded(json));

const standardPayload = {
  studies: [{
    StudyInstanceUID: { value: '1.2' },
    series: [
      { SeriesInstanceUID: '1.2.3', SeriesDescription: 'T1 MPRAGE' },
      { SeriesInstanceUID: '9.9.9', SeriesDescription: 'other' },
    ],
  }],
};

let pushSpy: jest.SpyInstance;
beforeEach(() => {
  jest.clearAllMocks();
  pushSpy = jest.spyOn(errorStack, 'stack_push').mockImplementation(() => undefined);
});
afterEach(() => {
  pushSpy.mockRestore();
});

describe('pacsVfs_read', () => {
  it('returns the matched series as pretty-printed JSON', async () => {
    const result = await pacsVfs_read(SERIES_PATH, fetch_make(standardPayload));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(JSON.parse(result.value)).toEqual({
        SeriesInstanceUID: '1.2.3',
        SeriesDescription: 'T1 MPRAGE',
      });
    }
  });

  it('handles Studies/results key variants and trailing slashes', async () => {
    const viaStudies = { Studies: [{ uid: '1.2', results: [{ uid: '1.2.3', d: 1 }] }] };
    const result = await pacsVfs_read(SERIES_PATH + '/', fetch_make(viaStudies));
    expect(result.ok).toBe(true);

    const bareArray = [{ StudyInstanceUID: '1.2', data: [{ SeriesInstanceUID: '1.2.3' }] }];
    expect((await pacsVfs_read(SERIES_PATH, fetch_make(bareArray))).ok).toBe(true);
  });

  it('blocks the image_slices.dcm placeholder', async () => {
    const path: string = SERIES_PATH.replace('metadata.json', 'image_slices.dcm');
    expect((await pacsVfs_read(path, fetch_make(standardPayload))).ok).toBe(false);
    expect(pushSpy).toHaveBeenCalledWith('error', expect.stringContaining('virtual placeholder'));
  });

  it('rejects unknown filenames and malformed paths', async () => {
    const wrongFile: string = SERIES_PATH.replace('metadata.json', 'other.txt');
    expect((await pacsVfs_read(wrongFile, fetch_make(standardPayload))).ok).toBe(false);

    expect((await pacsVfs_read('/net/pacs/queries/12_x/metadata.json', fetch_make(standardPayload))).ok).toBe(false);
    expect((await pacsVfs_read('/home/chris/metadata.json', fetch_make(standardPayload))).ok).toBe(false);
  });

  it('rejects a non-numeric query id', async () => {
    const badId: string = SERIES_PATH.replace('12_PatientID:X', 'abc_desc');
    expect((await pacsVfs_read(badId, fetch_make(standardPayload))).ok).toBe(false);
    expect(pushSpy).toHaveBeenCalledWith('error', expect.stringContaining('Invalid query ID'));
  });

  it('errors when the query result is missing or empty', async () => {
    expect((await pacsVfs_read(SERIES_PATH, jest.fn(async () => null))).ok).toBe(false);
    expect(pushSpy).toHaveBeenCalledWith('error', expect.stringContaining('no result payload'));
  });

  it('errors when the study or series UID is not in the results', async () => {
    const otherStudy = { studies: [{ StudyInstanceUID: '5.5', series: [] }] };
    expect((await pacsVfs_read(SERIES_PATH, fetch_make(otherStudy))).ok).toBe(false);
    expect(pushSpy).toHaveBeenCalledWith('error', expect.stringContaining('Study with UID 1.2 not found'));

    const otherSeries = { studies: [{ StudyInstanceUID: '1.2', series: [{ SeriesInstanceUID: '5.5' }] }] };
    expect((await pacsVfs_read(SERIES_PATH, fetch_make(otherSeries))).ok).toBe(false);
    expect(pushSpy).toHaveBeenCalledWith('error', expect.stringContaining('Series with UID 1.2.3 not found'));
  });

  it('wraps a throwing fetch callback into an error result', async () => {
    const result = await pacsVfs_read(SERIES_PATH, jest.fn(async () => { throw new Error('cache down'); }));
    expect(result.ok).toBe(false);
    expect(pushSpy).toHaveBeenCalledWith('error', expect.stringContaining('cache down'));
  });
});

describe('pacsVfs_readBinary', () => {
  it('returns the metadata as a Buffer', async () => {
    const result = await pacsVfs_readBinary(SERIES_PATH, fetch_make(standardPayload));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.toString()).toContain('T1 MPRAGE');
  });

  it('propagates read failures', async () => {
    expect((await pacsVfs_readBinary('/bad', fetch_make(standardPayload))).ok).toBe(false);
  });
});
