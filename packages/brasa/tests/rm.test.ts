/**
 * @file Unit tests for the extracted `rm` helpers.
 *
 * Covers the pure flag/path parser and the multi-target summary formatter
 * carved out of `builtin_rm`. Heavy IO/cross-package deps are mocked.
 *
 * @module
 */
import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { MemoryVfsProvider, VFSDispatcher, errorStack, vfs_fail, type VFSProvider } from '@fnndsc/fond';

const state: { dispatcher: VFSDispatcher } = { dispatcher: new VFSDispatcher() };
jest.unstable_mockModule('../src/core/filesystem.js', () => ({
  vfsDispatcher_get: () => state.dispatcher,
  listingCache_get: () => ({ cache_invalidate: jest.fn(), cache_invalidateTree: jest.fn() }),
}));
const mockResolve = jest.fn(async (p: string): Promise<string> => (p.startsWith('/') ? p : `/home/me/${p}`));
jest.unstable_mockModule('../src/builtins/utils.js', () => ({ path_resolve: mockResolve }));
const mockConfirm = jest.fn(async (): Promise<boolean> => true);
jest.unstable_mockModule('../src/core/question.js', () => ({ repl_confirm: mockConfirm }));
const mockSinkWrite = jest.fn();
jest.unstable_mockModule('../src/core/sink.js', () => ({
  sink_get: (): unknown => ({ data_write: mockSinkWrite, err_write: mockSinkWrite }),
}));

const { rmArgs_parse, rmSummary_format, rm_run, builtin_rm } = await import('../src/builtins/fs/rm.js');

/** What /home/me lists, by name. */
async function home_names(folder: string = '/home/me'): Promise<string[]> {
  const listed = await state.dispatcher.list(folder);
  return listed.ok ? listed.value.map((item) => item.name).sort() : [];
}

/** A fresh session filesystem; `mount` adjusts the store first. */
function filesystem_reset(mount?: (store: MemoryVfsProvider) => void): void {
  const store: MemoryVfsProvider = new MemoryVfsProvider('', {
    '/home/me/a': 'a', '/home/me/b': 'b', '/home/me/c': 'c', '/home/me/d': 'd', '/home/me/only.txt': 'o',
    '/home/me/docs/inner/deep.txt': 'x', '/home/me/empty': null,
  });
  if (mount) mount(store);
  state.dispatcher = new VFSDispatcher(store);
  const tags: MemoryVfsProvider = new MemoryVfsProvider('/proc/tags', { '/proc/tags/qc/feed_1': null });
  (tags as Partial<VFSProvider>).rm = async () => vfs_fail('EPERM', 'Operation not permitted (setfattr -x tag -v qc feed_1 untags the feed)');
  state.dispatcher.provider_register(tags);
}

beforeEach(() => {
  errorStack.stack_clear();
  mockSinkWrite.mockClear();
  filesystem_reset();
});

describe('rmArgs_parse', () => {
  it('parses combined short flags and paths', () => {
    expect(rmArgs_parse(['-rf', 'a', 'b'])).toEqual({ recursive: true, force: true, interactive: false, once: false, paths: ['a', 'b'] });
  });
  it('handles fully-combined flags in any order', () => {
    expect(rmArgs_parse(['-rfi'])).toEqual({ recursive: true, force: true, interactive: true, once: false, paths: [] });
    expect(rmArgs_parse(['-iR'])).toEqual({ recursive: true, force: false, interactive: true, once: false, paths: [] });
  });
  it('treats everything after -- as a path', () => {
    expect(rmArgs_parse(['--', '-weird-name', '-r'])).toEqual({ recursive: false, force: false, interactive: false, once: false, paths: ['-weird-name', '-r'] });
  });
  it('refuses an unknown option by name', () => {
    expect(rmArgs_parse(['-x', 'foo']).refused).toBe("rm: invalid option -- 'x'");
    expect(rmArgs_parse(['--verbose', 'foo']).refused).toBe("rm: unrecognized option '--verbose'");
  });
  it('reads long options whole, never letter by letter', () => {
    expect(rmArgs_parse(['--force', 'a'])).toEqual({ recursive: false, force: true, interactive: false, once: false, paths: ['a'] });
    expect(rmArgs_parse(['--recursive', 'a']).recursive).toBe(true);
  });
  it('builtin_rm removes nothing when an option is refused', async () => {
    const envelope = await builtin_rm(['-v', 'a']);
    expect(envelope.status).toBe('error');
    expect(envelope.renderedErr).toContain("rm: invalid option -- 'v'");
    expect(await home_names()).toContain('a');
  });

  it('reads -I as one question for the whole list, distinct from -i', () => {
    expect(rmArgs_parse(['-I', 'a', 'b'])).toEqual({ recursive: false, force: false, interactive: false, once: true, paths: ['a', 'b'] });
    expect(rmArgs_parse(['-rI', 'a'])).toEqual({ recursive: true, force: false, interactive: false, once: true, paths: ['a'] });
  });
});

describe('rm removes as a disk does', () => {
  it('removes a file, says so, and refuses a folder without -r', async () => {
    const one = await rm_run({ recursive: false, force: false, interactive: false, once: false, paths: ['a'] });
    expect(one.rendered).toContain('Removed file: /home/me/a');
    const folder = await rm_run({ recursive: false, force: false, interactive: false, once: false, paths: ['docs'] });
    expect(folder.renderedErr).toContain("rm: cannot remove 'docs': Is a directory");
    expect(await home_names()).toContain('docs');
  });

  it('removes a folder with all it holds under -r, walked where the mount has no rmTree', async () => {
    filesystem_reset((store) => { (store as Partial<VFSProvider>).rmTree = undefined; });
    const envelope = await rm_run({ recursive: true, force: false, interactive: false, once: false, paths: ['docs'] });
    expect(envelope.status).toBe('ok');
    expect(envelope.rendered).toContain('Removed dir: /home/me/docs');
    expect(await home_names()).not.toContain('docs');
  });

  it('says nothing there as Linux does, and passes a mount\'s refusal on with its words', async () => {
    const missing = await rm_run({ recursive: false, force: false, interactive: false, once: false, paths: ['gone'] });
    expect(missing.renderedErr).toContain("rm: cannot remove 'gone': No such file or directory");
    const tagged = await rm_run({ recursive: false, force: false, interactive: false, once: false, paths: ['/proc/tags/qc/feed_1'] });
    expect(tagged.renderedErr).toContain("rm: cannot remove '/proc/tags/qc/feed_1': Operation not permitted (setfattr -x tag -v qc feed_1 untags the feed)");
  });

  it('summarises several operands', async () => {
    const envelope = await rm_run({ recursive: false, force: false, interactive: false, once: false, paths: ['a', 'b', 'gone'] });
    expect(envelope.rendered).toContain("removed 'a'");
    expect(envelope.rendered).toContain('Removed 2 items, failed 1');
    expect(envelope.status).toBe('error');
  });
});

describe('rm -f on a missing operand', () => {
  it('says nothing and succeeds, as on Linux', async () => {
    const envelope = await rm_run({ recursive: false, force: true, interactive: false, once: false, paths: ['gone'] });
    expect(envelope.status).toBe('ok');
    expect(envelope.rendered).toBe('');
  });
});

describe('rmSummary_format', () => {
  it('returns null when nothing happened', () => {
    expect(rmSummary_format(0, 0)).toBeNull();
  });
  it('reports all-success (with singular/plural)', () => {
    expect(rmSummary_format(3, 0)).toContain('Successfully removed 3 items');
    expect(rmSummary_format(1, 0)).toContain('Successfully removed 1 item');
  });
  it('reports mixed success/failure', () => {
    expect(rmSummary_format(2, 1)).toContain('Removed 2 items, failed 1');
  });
  it('reports all-failure', () => {
    expect(rmSummary_format(0, 2)).toContain('Failed to remove 2 items');
  });
});

describe('rm -I', () => {
  beforeEach(() => {
    mockConfirm.mockClear();
  });

  it('asks once for the whole list, naming how many', async () => {
    mockConfirm.mockResolvedValue(true);
    await rm_run({ recursive: false, force: false, interactive: false, once: true, paths: ['a', 'b', 'c'] });
    expect(mockConfirm).toHaveBeenCalledTimes(1);
    expect(mockConfirm).toHaveBeenCalledWith('rm: remove 3 items? (y/n): ');
    expect(await home_names()).toEqual(['d', 'docs', 'empty', 'only.txt']);
  });

  it('removes nothing at all when the one question is answered no', async () => {
    mockConfirm.mockResolvedValue(false);
    const envelope = await rm_run({ recursive: false, force: false, interactive: false, once: true, paths: ['a', 'b'] });
    expect(await home_names()).toContain('a');
    expect(envelope.rendered).toContain('nothing removed (2 kept)');
  });

  it('names the one thing when the list is one long', async () => {
    mockConfirm.mockResolvedValue(true);
    await rm_run({ recursive: false, force: false, interactive: false, once: true, paths: ['only.txt'] });
    expect(mockConfirm).toHaveBeenCalledWith("rm: remove 'only.txt'? (y/n): ");
  });
});

describe('a question that is never answered', () => {
  beforeEach(() => {
    mockConfirm.mockClear();
    mockSinkWrite.mockClear();
  });

  /** Everything the command wrote to the surface, as one string. */
  function said(): string {
    return mockSinkWrite.mock.calls.map((call: unknown[]): string => String(call[0])).join('');
  }

  it('keeps everything under -I, and says why, rather than reporting a failure', async () => {
    mockConfirm.mockRejectedValue(new Error('the operator abandoned the question'));
    const envelope = await rm_run({ recursive: false, force: false, interactive: false, once: true, paths: ['a', 'b'] });
    expect(await home_names()).toContain('b');
    expect(envelope.status).toBe('ok');
    expect(envelope.rendered).toContain('nothing removed (2 kept)');
    // The reason travels: a surface that has lost its voice must not read
    // as an operator who declined.
    expect(envelope.rendered).toContain('the operator abandoned the question');
  });

  it('skips the file under -i, the way a no does, and does not report a failure', async () => {
    mockConfirm.mockRejectedValue(new Error('the operator abandoned the question'));
    const envelope = await rm_run({ recursive: false, force: false, interactive: true, once: false, paths: ['only.txt'] });
    expect(await home_names()).toContain('only.txt');
    // Not `rm: cannot remove ...`, which is what an unguarded await made of
    // an abandoned question: an error, over a file nothing had touched.
    expect(said()).toContain("skipped 'only.txt': the operator abandoned the question");
    expect(said()).not.toContain('cannot remove');
    expect(envelope.status).toBe('ok');
    expect(envelope.model).toEqual({ kind: 'fs.rm', data: [{ path: 'only.txt', removed: false, skipped: true }] });
  });

  it('stops asking about the rest, and says how many it left alone', async () => {
    mockConfirm
      .mockResolvedValueOnce(true)
      .mockRejectedValue(new Error('the operator abandoned the question'));

    const envelope = await rm_run({ recursive: false, force: false, interactive: true, once: false, paths: ['a', 'b', 'c', 'd'] });

    // One removed, one abandoned, and the two behind it never put to an
    // operator who had already walked away.
    expect(await home_names()).toEqual(['b', 'c', 'd', 'docs', 'empty', 'only.txt']);
    expect(mockConfirm).toHaveBeenCalledTimes(2);
    expect(said()).toContain('2 more not asked about, and kept');
    expect(envelope.model).toEqual({
      kind: 'fs.rm',
      data: [
        { path: 'a', removed: true, skipped: false },
        { path: 'b', removed: false, skipped: true },
        { path: 'c', removed: false, skipped: true },
        { path: 'd', removed: false, skipped: true },
      ],
    });
  });

  it('still asks about every file when the operator keeps answering', async () => {
    mockConfirm.mockResolvedValue(false);
    const envelope = await rm_run({ recursive: false, force: false, interactive: true, once: false, paths: ['a', 'b', 'c'] });
    expect(mockConfirm).toHaveBeenCalledTimes(3);
    expect(said()).not.toContain('not asked about');
    expect(envelope.status).toBe('ok');
  });
});
