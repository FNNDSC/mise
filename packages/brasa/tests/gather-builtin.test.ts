/**
 * @file Unit tests for the cohort as a kernel subject.
 *
 * The claims worth pinning are the ones that decide whether a cohort built
 * by a script and a cohort built by a surface are the same cohort: identity
 * is the PATH, a second sighting merges rather than doubles, a record
 * written before members had kinds still reads, and the fields the kernel
 * has no name for survive a kernel rewrite.
 */
import { describe, it, expect, jest, beforeEach } from '@jest/globals';

/** The cohort file's content, as the fake filesystem holds it. */
let stored: string | null = null;
/** Directories the code asked for. */
const madeDirs: string[] = [];
/** Listing paths the code invalidated after writing. */
const invalidated: string[] = [];
/** Paths the fake filesystem calls directories. */
const directories: Set<string> = new Set(['/home/chris/uploads/brain']);

jest.unstable_mockModule('@fnndsc/cumin', () => ({
  envelope_ok: (rendered: string, model?: unknown) => ({ status: 'ok', rendered, model }),
  envelope_error: (rendered: string, _errors?: unknown, renderedErr?: string) => ({ status: 'error', rendered, renderedErr }),
  listCache_get: () => ({ cache_invalidate: (p: string): void => { invalidated.push(p); } }),
}));

/** Files the fake filesystem holds, by parent folder. */
const filesByFolder: Map<string, string[]> = new Map([
  ['/home/chris/uploads', ['notes.txt', 'brain']],
]);

jest.unstable_mockModule('@fnndsc/salsa', () => ({
  fileContent_get: async (): Promise<{ ok: boolean; value?: string }> => (
    stored === null ? { ok: false } : { ok: true, value: stored }
  ),
  files_path_isDirectory: async (target: string): Promise<boolean> => directories.has(target),
  // A file is gathered only when its parent says it is there.
  vfsDispatcher: {
    list: async (folder: string): Promise<{ ok: boolean; value?: Array<{ name: string }> }> => {
      const held: string[] | undefined = filesByFolder.get(folder);
      return held === undefined ? { ok: false } : { ok: true, value: held.map((name: string) => ({ name })) };
    },
  },
}));

jest.unstable_mockModule('@fnndsc/chili/commands/fs/touch.js', () => ({
  files_touch: async (_target: string, options: { withContents?: string }): Promise<boolean> => {
    stored = options.withContents ?? '';
    return true;
  },
}));

jest.unstable_mockModule('@fnndsc/chili/commands/fs/mkdir.js', () => ({
  files_mkdir: async (target: string): Promise<boolean> => { madeDirs.push(target); return true; },
}));

jest.unstable_mockModule('@fnndsc/chili/screen/screen.js', () => ({
  // The table is chili's to render; these tests are about the cohort, so the
  // rows are rendered flat enough to assert on.
  table_render: (rows: Record<string, unknown>[], fields: string[]): string =>
    rows.map((row) => fields.map((f: string): string => `${row[f]}`).join('|')).join('\n'),
}));

jest.unstable_mockModule('../src/builtins/utils.js', () => ({
  commandArgs_process: (args: string[]) => {
    const parsed: { _: string[] } = { _: [] };
    for (const arg of args) parsed._.push(arg);
    return parsed;
  },
  path_resolve: async (p: string): Promise<string> => (
    p.startsWith('/') || p.startsWith('~') ? p.replace(/^~/, '/home/chris') : `/home/chris/${p}`
  ),
}));

const { builtin_gather } = await import('../src/builtins/res/gather.js');
const { member_key, members_merge, members_drop } = await import('../src/builtins/res/gather.store.js');

/** The cohort as the fake filesystem currently holds it. */
function cohort_held(): { name: string | null; series: Record<string, unknown>[] } {
  return JSON.parse(stored ?? '{"series":[]}') as { name: string | null; series: Record<string, unknown>[] };
}

beforeEach(() => {
  stored = null;
  madeDirs.length = 0;
  invalidated.length = 0;
});

describe('gather', () => {
  it('says the cohort is empty before anything is gathered', async () => {
    const envelope = await builtin_gather([]);
    expect(envelope.status).toBe('ok');
    expect(envelope.rendered).toMatch(/empty/);
  });

  it('gathers a PACS projection as a series, keeping its UID', async () => {
    await builtin_gather(['add', '/net/pacs/queries/qid:1/1.2.840.113619.2']);
    const held = cohort_held();
    expect(held.series).toHaveLength(1);
    expect(held.series[0].kind).toBe('series');
    expect(held.series[0].seriesUID).toBe('1.2.840.113619.2');
    expect(held.series[0].vfsPath).toBe('/net/pacs/queries/qid:1/1.2.840.113619.2');
  });

  it('asks the filesystem whether a gathered place is a directory', async () => {
    await builtin_gather(['add', '/home/chris/uploads/brain', '/home/chris/uploads/notes.txt']);
    const kinds: unknown[] = cohort_held().series.map((m) => m.kind);
    expect(kinds).toEqual(['dir', 'file']);
  });

  it('merges a second sighting rather than holding it twice', async () => {
    await builtin_gather(['add', '/net/pacs/queries/qid:1/1.2.3']);
    await builtin_gather(['add', '/net/pacs/queries/qid:1/1.2.3']);
    expect(cohort_held().series).toHaveLength(1);
  });

  it('resolves a relative operand against the session, so `gather add .` means here', async () => {
    await builtin_gather(['add', 'uploads/brain']);
    expect(cohort_held().series[0].vfsPath).toBe('/home/chris/uploads/brain');
  });

  it('creates the holding directory and invalidates the listing it wrote into', async () => {
    await builtin_gather(['add', '/net/pacs/queries/qid:1/1.2.3']);
    expect(madeDirs).toContain('/home/chris/gather');
    expect(invalidated).toContain('/home/chris/gather');
  });

  it('removes by the index the operator read back', async () => {
    await builtin_gather(['add', '/net/pacs/queries/qid:1/1.2.3', '/net/pacs/queries/qid:1/4.5.6']);
    const envelope = await builtin_gather(['remove', '1']);
    expect(envelope.status).toBe('ok');
    const paths: unknown[] = cohort_held().series.map((m) => m.vfsPath);
    expect(paths).toEqual(['/net/pacs/queries/qid:1/4.5.6']);
  });

  it('refuses to remove what it is not holding, by name', async () => {
    await builtin_gather(['add', '/net/pacs/queries/qid:1/1.2.3']);
    const envelope = await builtin_gather(['remove', '/net/pacs/queries/qid:1/9.9.9']);
    expect(envelope.status).toBe('error');
    expect(envelope.renderedErr).toMatch(/9\.9\.9/);
    expect(cohort_held().series).toHaveLength(1);
  });

  it('clears the name and the feed with the members', async () => {
    await builtin_gather(['add', '/net/pacs/queries/qid:1/1.2.3']);
    await builtin_gather(['name', 'sag', 'cohort']);
    expect(cohort_held().name).toBe('sag cohort');
    await builtin_gather(['clear']);
    expect(cohort_held().series).toHaveLength(0);
    expect(cohort_held().name).toBeNull();
  });

  it('reads a cohort written before members had paths, and keeps what it does not understand', async () => {
    stored = JSON.stringify({
      version: 1, name: 'from the surface', feed: null,
      series: [{ seriesUID: '1.2.3', description: 'SAG T1', patient: '1279049', studyFacts: { extra: true } }],
    });
    await builtin_gather(['add', '/home/chris/uploads/brain']);
    const held = cohort_held();
    expect(held.series).toHaveLength(2);
    expect(held.series[0].studyFacts).toEqual({ extra: true });
    expect(held.name).toBe('from the surface');
  });

  it('refuses an unknown subcommand by name', async () => {
    const envelope = await builtin_gather(['frobnicate']);
    expect(envelope.status).toBe('error');
    expect(envelope.renderedErr).toMatch(/frobnicate/);
  });
});

describe('cohort membership', () => {
  it('keys a member by its path, falling back to the UID of an older record', () => {
    expect(member_key({ vfsPath: '/a', kind: 'dir' })).toBe('/a');
    expect(member_key({ vfsPath: '', kind: 'series', seriesUID: '1.2.3' })).toBe('1.2.3');
  });

  it('merges what a later sighting knows onto what the cohort held', () => {
    const { members, added, merged } = members_merge(
      [{ vfsPath: '/a', kind: 'series', description: 'SAG' }],
      [{ vfsPath: '/a', kind: 'series', folderPath: '/home/chris/feeds/feed_1' }],
    );
    expect(added).toBe(0);
    expect(merged).toBe(1);
    expect(members[0].description).toBe('SAG');
    expect(members[0].folderPath).toBe('/home/chris/feeds/feed_1');
  });

  it('names what it could not drop', () => {
    const { dropped, missing } = members_drop([{ vfsPath: '/a', kind: 'dir' }], ['/a', '/b']);
    expect(dropped).toBe(1);
    expect(missing).toEqual(['/b']);
  });
});

describe('what is not there', () => {
  it('refuses to gather a path that names nothing, before taking anything', async () => {
    const envelope = await builtin_gather(['add', '/home/chris/uploads/brain', '/home/chris/uploads/nope.txt']);
    expect(envelope.status).toBe('error');
    expect(envelope.renderedErr).toContain('nope.txt');
    expect(envelope.renderedErr).toContain('nothing is there');
    expect(stored).toBeNull();
  });
});
