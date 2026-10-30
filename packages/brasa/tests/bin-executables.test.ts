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

const { binExecutableMatches_get, binPluginHighest_find, pluginVersions_compare } = await import('../src/chris/binExecutables.js');

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

describe('pluginVersions_compare', () => {
  it('orders dotted versions as numbers, a missing segment as 0, a pre-release word below the bare version', () => {
    const sorted: string[] = ['1.9.9', '1.10.0', '1.0.4-rc1', '1.0.4', '1.0', '0.9', '1.0.1'].sort(pluginVersions_compare);
    expect(sorted).toEqual(['0.9', '1.0', '1.0.1', '1.0.4-rc1', '1.0.4', '1.9.9', '1.10.0']);
    expect(pluginVersions_compare('2.1.2', '2.1.2')).toBe(0);
  });
});

describe('binPluginHighest_find', () => {
  it('resolves a bare plugin name to the highest version /bin lists, with every version lowest first', async () => {
    listing = [
      { name: 'pl-freesurfer-v1.0.1', type: 'plugin' },
      { name: 'pl-freesurfer-v1.0.4', type: 'plugin' },
      { name: 'pl-freesurfer-v1.0.10', type: 'plugin' },
      { name: 'pl-freesurfer-extra-v9.0.0', type: 'plugin' },
      PIPELINE,
    ];
    expect(await binPluginHighest_find('pl-freesurfer')).toEqual({ executable: 'pl-freesurfer-v1.0.10', version: '1.0.10', versions: ['1.0.1', '1.0.4', '1.0.10'] });
  });

  it('finds nothing for a name /bin lists no version of, for a full name, or when /bin cannot be read', async () => {
    expect(await binPluginHighest_find('pl-nothing')).toBeNull();
    expect(await binPluginHighest_find('pl-dymap-v2.1.2')).toBeNull();
    listing = null;
    expect(await binPluginHighest_find('pl-dymap')).toBeNull();
  });
});
