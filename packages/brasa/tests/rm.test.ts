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
  listCache_get: jest.fn(),
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
