/**
 * @file `find`: POSIX's expression over the namespace, walked through the
 * listing cache, in the order find prints, refusing what it does not know.
 */
import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { cuminMock_install } from './support/cuminMock.js';

jest.unstable_mockModule('@fnndsc/salsa', () => ({
  context_getSingle: jest.fn(async () => ({ user: 'chris', folder: '/home/chris' })),
}));
cuminMock_install(() => ({
  envelope_ok: (rendered: string) => ({ status: 'ok', rendered }),
  envelope_error: (rendered: string, _errors?: unknown, renderedErr?: string) => (renderedErr !== undefined ? { status: 'error', rendered, renderedErr } : { status: 'error', rendered }),
}));
jest.unstable_mockModule('@fnndsc/chili/models/listing.js', () => ({}));
jest.unstable_mockModule('../src/session/index.js', () => ({ session: { getCWD: jest.fn(async () => '/home/chris'), setCWD: jest.fn() } }));

/** The tree: what each folder lists. */
const TREE: Record<string, Array<{ name: string; type: string; date?: string }>> = {
  '/home/chris': [{ name: 'a.nii', type: 'file', date: '2026-10-01T00:00:00Z' }, { name: 'feeds', type: 'dir' }, { name: 'link1', type: 'link' }],
  '/home/chris/feeds': [{ name: 'feed_1', type: 'dir' }, { name: 'notes.txt', type: 'file', date: '2026-10-15T00:00:00Z' }],
  '/home/chris/feeds/feed_1': [{ name: 'b.nii', type: 'file', date: '2026-10-16T00:00:00Z' }],
};
const listed: string[] = [];
const mockListingGet = jest.fn(async (target: string, options: { directory?: boolean } = {}) => {
  if (options.directory) {
    if (target in TREE) return { ok: true, value: { path: target, items: [{ name: target.split('/').pop(), type: 'dir', size: 0, owner: '', date: '' }], fresh: true } };
    return { ok: false };
  }
  listed.push(target);
  const items = TREE[target];
  return items === undefined ? { ok: false } : { ok: true, value: { path: target, items: items.map((i) => ({ size: 0, owner: '', date: '', ...i })), fresh: true } };
});
jest.unstable_mockModule('../src/lib/vfs/vfs.js', () => ({ vfs: { listing_get: mockListingGet } }));
jest.unstable_mockModule('../src/lib/spinner.js', () => ({ spinner: { start: jest.fn(), stop: jest.fn(), updateMessage: jest.fn() } }));

const { builtin_find, find_parse, pattern_toRegExp } = await import('../src/builtins/fs/find.js');

beforeEach(() => { listed.length = 0; process.exitCode = 0; });

describe('find', () => {
  it('prints everything beneath a path, an entry before what lies under it', async () => {
    const result = await builtin_find(['.']);
    expect(result.rendered).toBe(['.', './a.nii', './feeds', './feeds/feed_1', './feeds/feed_1/b.nii', './feeds/notes.txt', './link1', ''].join('\n'));
  });

  it('selects by name and type, and does not follow links', async () => {
    expect((await builtin_find(['.', '-name', '*.nii'])).rendered).toBe('./a.nii\n./feeds/feed_1/b.nii\n');
    expect((await builtin_find(['.', '-type', 'd'])).rendered).toBe('.\n./feeds\n./feeds/feed_1\n');
    expect((await builtin_find(['.', '-type', 'l'])).rendered).toBe('./link1\n');
  });

  it('joins tests with -o, ! and parentheses, and -path matches across /', async () => {
    expect((await builtin_find(['.', '-name', '*.txt', '-o', '-name', 'b.*'])).rendered).toBe('./feeds/feed_1/b.nii\n./feeds/notes.txt\n');
    expect((await builtin_find(['.', '-type', 'f', '!', '-name', '*.nii'])).rendered).toBe('./feeds/notes.txt\n');
    expect((await builtin_find(['.', '(', '-name', 'a.*', '-o', '-name', 'notes*', ')', '-type', 'f'])).rendered).toBe('./a.nii\n./feeds/notes.txt\n');
    expect((await builtin_find(['.', '-path', './feeds*nii'])).rendered).toBe('./feeds/feed_1/b.nii\n');
  });

  it('bounds the walk with -maxdepth and -mindepth, never listing below the bound', async () => {
    expect((await builtin_find(['.', '-maxdepth', '1'])).rendered).toBe('.\n./a.nii\n./feeds\n./link1\n');
    expect(listed).toEqual(['/home/chris']);
    expect((await builtin_find(['.', '-mindepth', '2', '-type', 'f'])).rendered).toBe('./feeds/feed_1/b.nii\n./feeds/notes.txt\n');
  });

  it('-newermt compares the listing date; -print0 ends paths with NUL', async () => {
    expect((await builtin_find(['.', '-newermt', '2026-10-10'])).rendered).toBe('./feeds/feed_1/b.nii\n./feeds/notes.txt\n');
    expect((await builtin_find(['.', '-name', '*.nii', '-print0'])).rendered).toBe('./a.nii\0./feeds/feed_1/b.nii\0');
  });

  it('refuses an unknown predicate or a bad argument by name, and names a path that is not there', async () => {
    expect(find_parse(['.', '-bogus'])).toBe("find: unknown predicate '-bogus'");
    expect(find_parse(['.', '-type', 'x'])).toBe("find: -type takes f, d or l, not 'x'");
    expect(find_parse(['.', '-maxdepth', 'two'])).toBe("find: -maxdepth takes a number, not 'two'");
    expect(find_parse(['.', '-name'])).toBe('find: -name needs an argument');
    expect(find_parse(['.', '(', '-name', 'x'])).toBe("find: a '(' is not closed");
    const refused = await builtin_find(['.', '-bogus']);
    expect(refused.status).toBe('error');
    expect(process.exitCode).toBe(1);
    const missing = await builtin_find(['/nowhere']);
    expect(missing.renderedErr).toContain("find: '/nowhere': No such file or directory");
  });

  it('matches shell patterns: * crosses /, ? one character, [..] a class, \\ escapes', () => {
    expect(pattern_toRegExp('*.nii').test('a/b.nii')).toBe(true);
    expect(pattern_toRegExp('?.nii').test('ab.nii')).toBe(false);
    expect(pattern_toRegExp('[ab].nii').test('b.nii')).toBe(true);
    expect(pattern_toRegExp('[!ab].nii').test('b.nii')).toBe(false);
    expect(pattern_toRegExp('\\*').test('*')).toBe(true);
    expect(pattern_toRegExp('A*', true).test('abc')).toBe(true);
  });
});
