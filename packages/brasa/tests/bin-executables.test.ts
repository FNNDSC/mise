/**
 * @file Unit tests for what a word names in the virtual `/bin`: its `/bin`
 * name first, then a pipeline's own CUBE name.
 */
import { describe, it, expect, jest, beforeEach } from '@jest/globals';

/** The `/bin` listing the fake filesystem serves, or null when it fails. */
let listing: Array<Record<string, unknown>> | null = [];
jest.unstable_mockModule('../src/lib/vfs/vfs.js', () => ({
  vfs: { data_get: async () => (listing === null ? { ok: false } : { ok: true, value: listing }) },
}));

const { binExecutableMatches_get } = await import('../src/chris/binExecutables.js');

const PLUGIN = { name: 'pl-dymap-v2.1.2', type: 'plugin' };
const PIPELINE = { name: 'FreeSurfer_8_2_0_mri_convert_per_series_DICOM_id291', type: 'pipeline', title: 'FreeSurfer 8.2.0 mri_convert per series, DICOM', id: 291 };
/** A pipeline whose CUBE name is another entry's /bin name. */
const SHADOW = { name: 'other_id7', type: 'pipeline', title: 'pl-dymap-v2.1.2', id: 7 };

beforeEach(() => {
  listing = [PLUGIN, PIPELINE, SHADOW];
});

describe('binExecutableMatches_get', () => {
  it('finds a plugin and a pipeline by their /bin names', async () => {
    expect(await binExecutableMatches_get('pl-dymap-v2.1.2')).toEqual({ plugin: PLUGIN, pipeline: undefined });
    expect(await binExecutableMatches_get(PIPELINE.name)).toEqual({ plugin: undefined, pipeline: PIPELINE });
  });

  it("finds a pipeline by its CUBE name when nothing in /bin is called that", async () => {
    expect(await binExecutableMatches_get('FreeSurfer 8.2.0 mri_convert per series, DICOM')).toEqual({ plugin: undefined, pipeline: PIPELINE });
  });

  it('lets a /bin name win over a CUBE name that spells it', async () => {
    expect(await binExecutableMatches_get('pl-dymap-v2.1.2')).toEqual({ plugin: PLUGIN, pipeline: undefined });
  });

  it('finds nothing for an unknown word, or when /bin cannot be read', async () => {
    expect(await binExecutableMatches_get('nothing here')).toEqual({ plugin: undefined, pipeline: undefined });
    listing = null;
    expect(await binExecutableMatches_get(PIPELINE.name)).toEqual({ plugin: undefined, pipeline: undefined });
  });
});
