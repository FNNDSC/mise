import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import type { CommandEnvelope } from '@fnndsc/cumin';

// Deps of builtins/utils + the builtins themselves, so real commandArgs_process
// and path_resolve run.
jest.unstable_mockModule('@fnndsc/salsa', () => ({
  context_getSingle: jest.fn(async () => ({ user: 'chris', URL: 'x', folder: '/home/chris' })),
}));
jest.unstable_mockModule('../src/session/index.js', () => ({
  session: { getCWD: jest.fn(async () => '/home/chris') },
}));
jest.unstable_mockModule('@fnndsc/chili/models/listing.js', () => ({}));

const mockInvalidate = jest.fn();
const mockStackPop = jest.fn(() => null);
jest.unstable_mockModule('@fnndsc/cumin', () => ({
  listCache_get: () => ({ cache_invalidate: mockInvalidate }),
  errorStack: { stack_pop: mockStackPop },
  envelope_ok: (rendered: string, model?: unknown) =>
    model === undefined ? { status: 'ok', rendered } : { status: 'ok', rendered, model },
  envelope_error: (rendered: string, errors?: unknown, renderedErr?: string) => {
    const envelope: Record<string, unknown> = { status: 'error', rendered };
    if (errors !== undefined) envelope.errors = errors;
    if (renderedErr !== undefined) envelope.renderedErr = renderedErr;
    return envelope;
  },
}));

const mockMkdirCmd = jest.fn();
const mockMkdirRender = jest.fn((p: string, ok: boolean) => `mkdir:${p}:${ok}`);
jest.unstable_mockModule('@fnndsc/chili/commands/fs/mkdir.js', () => ({ files_mkdir: mockMkdirCmd }));

const mockTouchCmd = jest.fn();
const mockTouchRender = jest.fn((p: string, ok: boolean) => `touch:${p}:${ok}`);
jest.unstable_mockModule('@fnndsc/chili/commands/fs/touch.js', () => ({ files_touch: mockTouchCmd }));

const mockCpCmd = jest.fn();
const mockMvCmd = jest.fn();
jest.unstable_mockModule('@fnndsc/chili/commands/fs/cp.js', () => ({ files_cp: mockCpCmd }));
jest.unstable_mockModule('@fnndsc/chili/commands/fs/mv.js', () => ({ files_mv: mockMvCmd }));

jest.unstable_mockModule('@fnndsc/chili/views/fs.js', () => ({
  mkdir_render: mockMkdirRender,
  touch_render: mockTouchRender,
  cp_render: jest.fn((s: string, d: string, ok: boolean) => `cp:${s}->${d}:${ok}`),
  mv_render: jest.fn((s: string, d: string, ok: boolean) => `mv:${s}->${d}:${ok}`),
}));

const { builtin_mkdir } = await import('../src/builtins/fs/mkdir.js');
const { builtin_touch } = await import('../src/builtins/fs/touch.js');
const { builtin_cp } = await import('../src/builtins/fs/cp.js');
const { builtin_mv } = await import('../src/builtins/fs/mv.js');

let logSpy: jest.SpiedFunction<typeof console.log>;
let errSpy: jest.SpiedFunction<typeof console.error>;
beforeEach(() => {
  jest.clearAllMocks();
  logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
  errSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('builtin_mkdir', () => {
  it('reports usage with no arguments', async () => {
    const envelope: CommandEnvelope = await builtin_mkdir([]);
    expect(envelope.status).toBe('error');
    expect(envelope.renderedErr).toContain('Usage: mkdir');
  });

  it('creates a directory and invalidates the parent cache', async () => {
    mockMkdirCmd.mockResolvedValue(true);
    const envelope: CommandEnvelope = await builtin_mkdir(['newdir']);
    expect(mockMkdirCmd).toHaveBeenCalledWith('/home/chris/newdir');
    expect(envelope.rendered).toContain('mkdir:/home/chris/newdir:true');
    expect(envelope.model?.kind).toBe('fs.mkdir');
    expect(mockInvalidate).toHaveBeenCalledWith('/home/chris');
  });

  it('reports a per-path error without aborting the loop', async () => {
    mockMkdirCmd.mockRejectedValueOnce(new Error('exists')).mockResolvedValueOnce(true);
    const envelope: CommandEnvelope = await builtin_mkdir(['a', 'b']);
    expect(envelope.status).toBe('error');
    expect(envelope.renderedErr).toContain('exists');
    expect(mockMkdirCmd).toHaveBeenCalledTimes(2);
  });
});

describe('builtin_touch', () => {
  it('reports usage with no file argument', async () => {
    const envelope: CommandEnvelope = await builtin_touch([]);
    expect(envelope.status).toBe('error');
    expect(envelope.renderedErr).toContain('Usage: touch');
  });

  it('creates a file and invalidates the parent cache', async () => {
    mockTouchCmd.mockResolvedValue(true);
    const envelope: CommandEnvelope = await builtin_touch(['note.txt']);
    expect(mockTouchCmd).toHaveBeenCalledWith('/home/chris/note.txt', {});
    expect(envelope.rendered).toContain('touch:/home/chris/note.txt:true');
    expect(envelope.model?.kind).toBe('fs.touch');
    expect(mockInvalidate).toHaveBeenCalledWith('/home/chris');
  });

  it('passes withContents and only touches the first file', async () => {
    mockTouchCmd.mockResolvedValue(true);
    await builtin_touch(['a.txt', 'b.txt', '--withContents', 'hi']);
    expect(mockTouchCmd).toHaveBeenCalledTimes(1);
    expect(mockTouchCmd).toHaveBeenCalledWith('/home/chris/a.txt', { withContents: 'hi' });
  });

  it('reports a failure via the error stack', async () => {
    mockTouchCmd.mockResolvedValue(false);
    const envelope: CommandEnvelope = await builtin_touch(['bad.txt']);
    expect(envelope.status).toBe('error');
    expect(envelope.renderedErr).toContain('Failed to create file');
  });
});

describe('builtin_cp', () => {
  it('reports usage with fewer than two paths', async () => {
    const envelope: CommandEnvelope = await builtin_cp(['only']);
    expect(envelope.status).toBe('error');
    expect(envelope.rendered).toContain('Usage: cp');
  });

  it('copies a single source and renders the result', async () => {
    mockCpCmd.mockResolvedValue(true);
    const envelope: CommandEnvelope = await builtin_cp(['a.txt', 'b.txt']);
    expect(mockCpCmd).toHaveBeenCalledWith('/home/chris/a.txt', '/home/chris/b.txt', { recursive: false });
    expect(envelope.rendered).toContain('cp:/home/chris/a.txt->/home/chris/b.txt:true');
    expect(envelope.model?.kind).toBe('fs.cp');
    expect(mockInvalidate).toHaveBeenCalledWith('/home/chris/b.txt');
  });

  it('passes -r recursive and summarises multiple sources', async () => {
    mockCpCmd.mockResolvedValue(true);
    const envelope: CommandEnvelope = await builtin_cp(['-r', 'a', 'b', 'dest']);
    expect(mockCpCmd).toHaveBeenCalledWith('/home/chris/a', '/home/chris/dest', { recursive: true });
    expect(mockCpCmd).toHaveBeenCalledWith('/home/chris/b', '/home/chris/dest', { recursive: true });
    expect(envelope.rendered).toContain('Copied 2 file(s)');
  });

  it('reports failures in the multi-source summary', async () => {
    mockCpCmd.mockResolvedValue(false);
    const envelope: CommandEnvelope = await builtin_cp(['a', 'b', 'dest']);
    expect(envelope.status).toBe('error');
    expect(envelope.rendered).toContain('failed');
  });
});

describe('builtin_mv', () => {
  it('reports usage with fewer than two paths', async () => {
    const envelope: CommandEnvelope = await builtin_mv(['only']);
    expect(envelope.status).toBe('error');
    expect(envelope.rendered).toContain('Usage: mv');
  });

  it('moves a single source and invalidates source + dest', async () => {
    mockMvCmd.mockResolvedValue(true);
    const envelope: CommandEnvelope = await builtin_mv(['a.txt', 'b.txt']);
    expect(mockMvCmd).toHaveBeenCalledWith('/home/chris/a.txt', '/home/chris/b.txt');
    expect(envelope.rendered).toContain('mv:/home/chris/a.txt->/home/chris/b.txt:true');
    expect(envelope.model?.kind).toBe('fs.mv');
    expect(mockInvalidate).toHaveBeenCalledWith('/home/chris/b.txt');
  });

  it('summarises multiple moved sources', async () => {
    mockMvCmd.mockResolvedValue(true);
    const envelope: CommandEnvelope = await builtin_mv(['a', 'b', 'dest']);
    expect(envelope.rendered).toContain('Moved 2 file(s)');
  });

  it('reports a per-source error', async () => {
    mockMvCmd.mockRejectedValue(new Error('nope'));
    const envelope: CommandEnvelope = await builtin_mv(['a.txt', 'b.txt']);
    expect(envelope.status).toBe('error');
    expect(envelope.renderedErr).toContain('nope');
  });
});
