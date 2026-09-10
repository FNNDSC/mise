/**
 * @file Unit tests for the extracted `rm` helpers.
 *
 * Covers the pure flag/path parser and the multi-target summary formatter
 * carved out of `builtin_rm`. Heavy IO/cross-package deps are mocked.
 *
 * @module
 */
import { jest, describe, it, expect, beforeEach } from '@jest/globals';

jest.unstable_mockModule('@fnndsc/chili/commands/fs/rm.js', () => ({ files_rm: jest.fn() }));
jest.unstable_mockModule('@fnndsc/chili/views/fs.js', () => ({ rm_render: jest.fn() }));
jest.unstable_mockModule('@fnndsc/cumin', () => ({
  // A real cache: the removal path invalidates the parent listing and the
  // tree beneath the target, and a bare jest.fn() returning undefined turns
  // a successful removal into a caught TypeError.
  listCache_get: jest.fn(() => ({ cache_invalidate: jest.fn(), cache_invalidateTree: jest.fn() })),
  envelope_ok: (rendered: string, model?: unknown) =>
    model === undefined ? { status: 'ok', rendered } : { status: 'ok', rendered, model },
  envelope_error: (rendered: string, errors?: unknown, renderedErr?: string) => {
    const envelope: Record<string, unknown> = { status: 'error', rendered };
    if (errors !== undefined) envelope.errors = errors;
    if (renderedErr !== undefined) envelope.renderedErr = renderedErr;
    return envelope;
  },
}));
const mockResolve = jest.fn(async (p: string): Promise<string> => `/home/me/${p}`);
jest.unstable_mockModule('../src/builtins/utils.js', () => ({ path_resolve: mockResolve }));
const mockConfirm = jest.fn(async (): Promise<boolean> => true);
jest.unstable_mockModule('../src/core/question.js', () => ({ repl_confirm: mockConfirm }));
const mockSinkWrite = jest.fn();
jest.unstable_mockModule('../src/core/sink.js', () => ({
  sink_get: (): unknown => ({ data_write: mockSinkWrite, err_write: mockSinkWrite }),
}));

const { rmArgs_parse, rmSummary_format, rm_run } = await import('../src/builtins/fs/rm.js');
const { files_rm } = await import('@fnndsc/chili/commands/fs/rm.js');

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
  it('ignores unknown flags and collects bare paths', () => {
    expect(rmArgs_parse(['-x', 'foo', 'bar'])).toEqual({ recursive: false, force: false, interactive: false, once: false, paths: ['foo', 'bar'] });
  });

  it('reads -I as one question for the whole list, distinct from -i', () => {
    expect(rmArgs_parse(['-I', 'a', 'b'])).toEqual({ recursive: false, force: false, interactive: false, once: true, paths: ['a', 'b'] });
    expect(rmArgs_parse(['-rI', 'a'])).toEqual({ recursive: true, force: false, interactive: false, once: true, paths: ['a'] });
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
    (files_rm as jest.Mock).mockClear();
    mockConfirm.mockClear();
  });

  it('asks once for the whole list, naming how many', async () => {
    mockConfirm.mockResolvedValue(true);
    (files_rm as jest.Mock).mockResolvedValue({ success: true });
    await rm_run({ recursive: false, force: false, interactive: false, once: true, paths: ['a', 'b', 'c'] });
    expect(mockConfirm).toHaveBeenCalledTimes(1);
    expect(mockConfirm).toHaveBeenCalledWith('rm: remove 3 items? (y/n): ');
    expect(files_rm).toHaveBeenCalledTimes(3);
  });

  it('removes nothing at all when the one question is answered no', async () => {
    mockConfirm.mockResolvedValue(false);
    (files_rm as jest.Mock).mockResolvedValue({ success: true });
    const envelope = await rm_run({ recursive: false, force: false, interactive: false, once: true, paths: ['a', 'b'] });
    expect(files_rm).not.toHaveBeenCalled();
    expect(envelope.rendered).toContain('nothing removed (2 kept)');
  });

  it('names the one thing when the list is one long', async () => {
    mockConfirm.mockResolvedValue(true);
    (files_rm as jest.Mock).mockResolvedValue({ success: true });
    await rm_run({ recursive: false, force: false, interactive: false, once: true, paths: ['only.txt'] });
    expect(mockConfirm).toHaveBeenCalledWith("rm: remove 'only.txt'? (y/n): ");
  });
});

describe('a question that is never answered', () => {
  beforeEach(() => {
    (files_rm as jest.Mock).mockClear();
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
    expect(files_rm).not.toHaveBeenCalled();
    expect(envelope.status).toBe('ok');
    expect(envelope.rendered).toContain('nothing removed (2 kept)');
    // The reason travels: a surface that has lost its voice must not read
    // as an operator who declined.
    expect(envelope.rendered).toContain('the operator abandoned the question');
  });

  it('skips the file under -i, the way a no does, and does not report a failure', async () => {
    mockConfirm.mockRejectedValue(new Error('the operator abandoned the question'));
    const envelope = await rm_run({ recursive: false, force: false, interactive: true, once: false, paths: ['only.txt'] });
    expect(files_rm).not.toHaveBeenCalled();
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
    (files_rm as jest.Mock).mockResolvedValue({ success: true });

    const envelope = await rm_run({ recursive: false, force: false, interactive: true, once: false, paths: ['a', 'b', 'c', 'd'] });

    // One removed, one abandoned, and the two behind it never put to an
    // operator who had already walked away.
    expect(files_rm).toHaveBeenCalledTimes(1);
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
