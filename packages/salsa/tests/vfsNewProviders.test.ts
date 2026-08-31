/**
 * @file Tests for the three projections that complete the namespace.
 *
 * Each covers a relation CUBE owns that the filesystem could not previously
 * reach: the tags a feed carries, the runs a pipeline produced, and what is
 * known about a plugin as opposed to how to invoke it.
 *
 * The assertions worth keeping are about *shape*: a workflow's jobs are links
 * into `/proc/jobs` rather than copies of them, a tag is one object rather than
 * one per feed, and plugin metadata sits beside `/bin` rather than nested
 * inside it.
 */
const workflowsListAll = jest.fn();
const tagsListAll = jest.fn();
const metasListAll = jest.fn();

jest.mock('../src/workflows/index', () => ({ workflows_listAll: (...a: unknown[]) => workflowsListAll(...a) }));
jest.mock('../src/tags/index', () => ({ tags_listAll: (...a: unknown[]) => tagsListAll(...a) }));
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

import { WorkflowsVfsProvider } from '../src/vfs/providers/workflows';
import { TagsVfsProvider } from '../src/vfs/providers/tags';
import { ShareVfsProvider } from '../src/vfs/providers/share';

describe('WorkflowsVfsProvider', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    workflowsListAll.mockResolvedValue({
      tableData: [{
        id: 7,
        title: 'Archive of series',
        owner_username: 'me',
        creation_date: '2026-08-27',
        pipeline_name: 'zip v20240311',
        plugin_instances: [101, 102],
      }],
      selectedFields: [],
    });
  });

  it('lists runs at its root, one directory each', async () => {
    const result = await new WorkflowsVfsProvider().list('/proc/workflows');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual([expect.objectContaining({ name: '7', type: 'dir', title: 'Archive of series' })]);
    }
  });

  it('presents a run as its pipeline, its jobs, and its title', async () => {
    const result = await new WorkflowsVfsProvider().list('/proc/workflows/7');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.map((item) => `${item.name}:${item.type}`))
        .toEqual(['pipeline:link', 'jobs:dir', 'title:file']);
    }
  });

  it('links a run to the jobs it created rather than restating them', async () => {
    // A job already has a representation under /proc/jobs. Restating it here
    // would be a second view of one fact, drifting the moment either changes.
    const result = await new WorkflowsVfsProvider().list('/proc/workflows/7/jobs');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual([
        expect.objectContaining({ name: '101', type: 'link', target: '/proc/jobs/101' }),
        expect.objectContaining({ name: '102', type: 'link', target: '/proc/jobs/102' }),
      ]);
    }
  });

  it('resolves the pipeline link into /bin only when followed', async () => {
    const provider = new WorkflowsVfsProvider();
    // The listing above named the link without resolving it; resolution is a
    // separate call, so navigation pays for it and browsing does not.
    const target = await provider.linkTarget_resolve('/proc/workflows/7/pipeline');

    expect(target.ok).toBe(true);
    if (target.ok) expect(target.value).toBe('/bin/zip v20240311');
  });

  it('refuses to copy a run', async () => {
    // Copying would assert that a computation happened twice.
    expect(await new WorkflowsVfsProvider().cp('/proc/workflows/7', '/tmp', {})).toBe(false);
  });

  it('reports an unknown run rather than an empty directory', async () => {
    const result = await new WorkflowsVfsProvider().list('/proc/workflows/999/jobs');

    expect(result.ok).toBe(false);
  });

  it('reads a run title', async () => {
    const result = await new WorkflowsVfsProvider().read('/proc/workflows/7/title');

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe('Archive of series\n');
  });

  it('refuses paths that name no workflow file or link', async () => {
    const provider = new WorkflowsVfsProvider();

    expect((await provider.list('/proc/workflows/7/jobs/101/extra')).ok).toBe(false);
    expect((await provider.read('/proc/workflows/7/jobs')).ok).toBe(false);
    expect((await provider.linkTarget_resolve('/proc/workflows/7/title')).ok).toBe(false);
  });

  it('reports an unknown run when reading or following one of its entries', async () => {
    const provider = new WorkflowsVfsProvider();

    expect((await provider.read('/proc/workflows/999/title')).ok).toBe(false);
    expect((await provider.linkTarget_resolve('/proc/workflows/999/pipeline')).ok).toBe(false);
  });

  it('lists no jobs for a run that created none', async () => {
    workflowsListAll.mockResolvedValue({
      tableData: [{ id: 8, title: 'empty', owner_username: 'me', creation_date: '', pipeline_name: 'p' }],
      selectedFields: [],
    });

    const result = await new WorkflowsVfsProvider().list('/proc/workflows/8/jobs');

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual([]);
  });
});

describe('TagsVfsProvider', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    tagsListAll.mockResolvedValue({
      tableData: [
        { id: 1, name: 'urgent', color: 'red', owner_username: 'me', creation_date: '2026-08-01' },
        { id: 2, name: 'review', color: 'blue', owner_username: 'me', creation_date: '2026-08-02' },
      ],
      selectedFields: [],
    });
  });

  it('lists each tag once, however many feeds carry it', async () => {
    // A tag points at many feeds. Projecting it per-feed would flatten that
    // many-to-many and make editing ambiguous about which copy changed.
    const result = await new TagsVfsProvider().list('/tags');

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.map((item) => item.name)).toEqual(['urgent', 'review']);
  });

  it('reads a tag as its own properties', async () => {
    const result = await new TagsVfsProvider().read('/tags/urgent');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toContain('name: urgent');
      expect(result.value).toContain('color: red');
    }
  });

  it('refuses to copy a tag, because copying is not what tagging means', async () => {
    expect(await new TagsVfsProvider().cp('/tags/urgent', '/tags/urgent2', {})).toBe(false);
  });

  it('reports an unknown tag', async () => {
    expect((await new TagsVfsProvider().read('/tags/nope')).ok).toBe(false);
  });

  it('treats a tag as a leaf, not a directory', async () => {
    expect((await new TagsVfsProvider().list('/tags/urgent')).ok).toBe(false);
  });

  it('lists nothing when the tag fetch fails, rather than inventing tags', async () => {
    tagsListAll.mockResolvedValue(null);

    const result = await new TagsVfsProvider().list('/tags');

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual([]);
  });
});

describe('ShareVfsProvider', () => {
  beforeEach(() => {
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
    expect(await new ShareVfsProvider().cp('/usr/share/pl-dcm2niix', '/tmp', {})).toBe(false);
  });
});
