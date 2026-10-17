/**
 * @file Tests for `/usr/share`: what is known about a plugin as opposed to
 * how to invoke it.
 *
 * The assertion worth keeping is about *shape*: plugin metadata sits beside
 * `/bin` rather than nested inside it. (The tags are at /proc/tags:
 * procTagsProvider.test.ts; /proc/workflows was unmounted, docs/proc.adoc.)
 */
const metasListAll = jest.fn();

jest.mock('../src/pluginmetas/index', () => ({ pluginMetas_listAll: (...a: unknown[]) => metasListAll(...a) }));
const PACKAGE_FIXTURE = {
  id: 7,
  name: 'brainy',
  authors: 'FNNDSC',
  category: 'MRI',
  manifest: { pipelineID: 7, name: 'brainy', rootIDs: [1], nodes: [] },
};
jest.mock('../src/pipelines/packages', () => ({
  pipelinePackages_restore: async (): Promise<void> => undefined,
  pipelinePackages_all: () => [PACKAGE_FIXTURE],
  pipelinePackage_find: (name: string) => (name === 'brainy' ? PACKAGE_FIXTURE : null),
}));

import { listCache_get } from '@fnndsc/cumin';
import { ShareVfsProvider } from '../src/vfs/providers/share';

describe('ShareVfsProvider', () => {
  beforeEach(() => {
    listCache_get().cache_invalidate();
    jest.clearAllMocks();
    metasListAll.mockResolvedValue({
      tableData: [{
        id: 3,
        name: 'pl-dcm2niix',
        title: 'DICOM to NIfTI',
        authors: 'FNNDSC',
        license: 'MIT',
        type: 'ds',
        stars: 4,
        public_repo: 'https://github.com/FNNDSC/pl-dcm2niix',
        documentation: '',
        creation_date: '2026-01-01',
      }],
      selectedFields: [],
    });
  });

  it('keeps the plugin metas: a second read answers without walking them again', async () => {
    const provider = new ShareVfsProvider();
    await provider.list('/usr/share');
    await provider.list('/usr/share');
    expect(metasListAll).toHaveBeenCalledTimes(1);
  });

  it('lists plugins beside /bin rather than nesting them inside it', async () => {
    const result = await new ShareVfsProvider().list('/usr/share');

    expect(result.ok).toBe(true);
    if (result.ok) {
      // The packages subdirectory (registered pipelines) leads; plugin
      // directories stay flat beside it.
      expect(result.value).toEqual([
        expect.objectContaining({ name: 'packages', type: 'dir' }),
        expect.objectContaining({ name: 'pl-dcm2niix', type: 'dir' }),
      ]);
    }
  });

  it('lists the packages tree: pipeline dirs, then fields plus manifest.yaml', async () => {
    const provider = new ShareVfsProvider();
    const roster = await provider.list('/usr/share/packages');
    expect(roster.ok).toBe(true);
    if (roster.ok) {
      expect(roster.value).toEqual([expect.objectContaining({ name: 'brainy', type: 'dir', id: 7 })]);
    }
    const files = await provider.list('/usr/share/packages/brainy');
    expect(files.ok).toBe(true);
    if (files.ok) {
      const names = files.value.map((item) => item.name);
      expect(names).toEqual(expect.arrayContaining(['name', 'authors', 'category', 'manifest.yaml']));
    }
    const missing = await provider.list('/usr/share/packages/ghost');
    expect(missing.ok).toBe(false);
  });

  it('reads a package field and the canonical manifest as YAML', async () => {
    const provider = new ShareVfsProvider();
    const field = await provider.read('/usr/share/packages/brainy/category');
    expect(field.ok).toBe(true);
    if (field.ok) expect(field.value).toBe('MRI\n');
    const manifest = await provider.read('/usr/share/packages/brainy/manifest.yaml');
    expect(manifest.ok).toBe(true);
    if (manifest.ok) expect(manifest.value).toContain('pipelineID: 7');
    const bogus = await provider.read('/usr/share/packages/brainy/nonsense');
    expect(bogus.ok).toBe(false);
  });

  it('omits fields the plugin left empty rather than showing blanks', async () => {
    const result = await new ShareVfsProvider().list('/usr/share/pl-dcm2niix');

    expect(result.ok).toBe(true);
    if (result.ok) {
      const names = result.value.map((item) => item.name);
      expect(names).toContain('license');
      expect(names).not.toContain('documentation');
    }
  });

  it('accepts the versioned name a /bin entry carries', async () => {
    // /bin names a plugin version; a meta is version-independent. Someone
    // reading a listing and pasting the name should land on the metadata.
    const result = await new ShareVfsProvider().read('/usr/share/pl-dcm2niix-v1.0.2/license');

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe('MIT\n');
  });

  it('reports an unknown plugin and an unknown field separately', async () => {
    expect((await new ShareVfsProvider().read('/usr/share/pl-nope/license')).ok).toBe(false);
    expect((await new ShareVfsProvider().read('/usr/share/pl-dcm2niix/secrets')).ok).toBe(false);
  });

  it('refuses paths deeper than a field, and an unknown plugin directory', async () => {
    const provider = new ShareVfsProvider();

    expect((await provider.list('/usr/share/pl-nope')).ok).toBe(false);
    expect((await provider.list('/usr/share/pl-dcm2niix/license/more')).ok).toBe(false);
    expect((await provider.read('/usr/share/pl-dcm2niix')).ok).toBe(false);
  });

  it('refuses to copy plugin metadata', async () => {
    expect(await new ShareVfsProvider().cp('/usr/share/pl-dcm2niix', '/tmp', {})).toEqual({ ok: false, errno: 'EROFS', reason: "Plugin metadata is CUBE's record of a plugin; it cannot be copied." });
  });
});
