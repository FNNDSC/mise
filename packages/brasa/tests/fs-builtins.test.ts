import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { cuminMock_install } from './support/cuminMock.js';
import type { CommandEnvelope } from '@fnndsc/cumin';

// Deps of builtins/utils + the builtins themselves, so real commandArgs_process
// and path_resolve run.
const mockVirtual = jest.fn((_p: string): boolean => false);
const mockVfsRename = jest.fn(async (_a: string, _b: string) => ({ ok: true as const, value: true as const }));
const mockVfsList = jest.fn(async (_p: string): Promise<{ ok: boolean; value?: Array<{ name: string }> }> => ({ ok: true, value: [] }));
jest.unstable_mockModule('@fnndsc/salsa', () => ({
  context_getSingle: jest.fn(async () => ({ user: 'chris', URL: 'x', folder: '/home/chris' })),
  PROC_TAGS_PREFIX: '/proc/tags',
  vfsDispatcher: { path_isVirtual: mockVirtual, rename: mockVfsRename, list: mockVfsList },
}));
jest.unstable_mockModule('../src/session/index.js', () => ({
  session: { getCWD: jest.fn(async () => '/home/chris') },
}));
jest.unstable_mockModule('@fnndsc/chili/models/listing.js', () => ({}));

const mockInvalidate = jest.fn();
const mockStackPop = jest.fn(() => null);
cuminMock_install(() => ({
  listCache_get: () => ({ cache_invalidate: mockInvalidate, cache_invalidateTree: mockInvalidate }),
  errorStack: { stack_pop: mockStackPop, stack_search: () => [] },
  envelope_ok: (rendered: string, model?: unknown) =>
    model === undefined ? { status: 'ok', rendered } : { status: 'ok', rendered, model },
  envelope_error: (rendered: string, errors?: unknown, renderedErr?: string) => {
    const envelope: Record<string, unknown> = { status: 'error', rendered };
    if (errors !== undefined) envelope.errors = errors;
    if (renderedErr !== undefined) envelope.renderedErr = renderedErr;
    return envelope;
  },
}));

const mockTouchCmd = jest.fn();
const mockTouchRender = jest.fn((p: string, ok: boolean) => `touch:${p}:${ok}`);
jest.unstable_mockModule('@fnndsc/chili/commands/fs/touch.js', () => ({ files_touch: mockTouchCmd }));

const mockCpCmd = jest.fn();
const mockMvCmd = jest.fn();
jest.unstable_mockModule('@fnndsc/chili/commands/fs/cp.js', () => ({ files_cp: mockCpCmd }));
jest.unstable_mockModule('@fnndsc/chili/commands/fs/mv.js', () => ({ files_mv: mockMvCmd }));
// One operand names what to move and not where: that is a question now, so
// the surface's answer is scripted here.
const mockDestination = jest.fn<(request: Record<string, unknown>) => Promise<string>>(
  async () => '/home/chris/dest.txt');
jest.unstable_mockModule('../src/core/question.js', () => ({
  repl_questionPath: (message: string, path: unknown, commit?: string): Promise<string> =>
    mockDestination({ message, path, commit }),
}));

jest.unstable_mockModule('@fnndsc/chili/views/fs.js', () => ({
  touch_render: mockTouchRender,
  cp_render: jest.fn((s: string, d: string, ok: boolean) => `cp:${s}->${d}:${ok}`),
  mv_render: jest.fn((s: string, d: string, ok: boolean) => `mv:${s}->${d}:${ok}`),
}));

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

describe('unknown options', () => {
  it('cp, mv and touch refuse an option they do not have, by name', async () => {
    const cp: CommandEnvelope = await builtin_cp(['-x', 'a', 'b']);
    expect(cp.renderedErr).toContain("cp: invalid option -- 'x'");
    const mv: CommandEnvelope = await builtin_mv(['--force', 'a', 'b']);
    expect(mv.renderedErr).toContain("mv: unrecognized option '--force'");
    const touch: CommandEnvelope = await builtin_touch(['-p', 'a']);
    expect(touch.renderedErr).toContain("touch: invalid option -- 'p'");
    expect(mockCpCmd).not.toHaveBeenCalled();
    expect(mockMvCmd).not.toHaveBeenCalled();
    expect(mockTouchCmd).not.toHaveBeenCalled();
  });

  it('cp says why a copy failed without the stack\'s stamp, and with one cp:', async () => {
    mockCpCmd.mockResolvedValue(false);
    mockStackPop.mockReturnValueOnce({ type: 'error', message: "[vfsOutcome_toResult        ] | cp: Copying from static VFS path '/bin/x' is not supported." });
    const envelope = await builtin_cp(['/bin/x', 'y']);
    expect(envelope.renderedErr).toContain("cp: Copying from static VFS path '/bin/x' is not supported.");
    expect(envelope.renderedErr).not.toContain('[vfsOutcome_toResult');
    expect(envelope.renderedErr).not.toContain('cp: cp:');
    process.exitCode = undefined;
  });

  it('cp --recursive keeps the operand that follows it', async () => {
    mockCpCmd.mockResolvedValue(true);
    await builtin_cp(['--recursive', 'src', 'dest']);
    expect(mockCpCmd).toHaveBeenCalled();
    expect(JSON.stringify(mockCpCmd.mock.calls[0])).toContain('/home/chris/src');
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
  it('asks where a lone source should go, and copies it there', async () => {
    mockCpCmd.mockResolvedValue(true);
    mockDestination.mockResolvedValue('/home/chris/copy.txt');
    const envelope: CommandEnvelope = await builtin_cp(['only.txt']);
    expect(mockDestination).toHaveBeenCalledTimes(1);
    expect(envelope.status).toBe('ok');
    expect(mockCpCmd).toHaveBeenCalledWith(
      expect.stringContaining('only.txt'), '/home/chris/copy.txt', { recursive: false });
  });

  it('copies nothing when the destination is abandoned', async () => {
    mockDestination.mockResolvedValue('   ');
    const envelope: CommandEnvelope = await builtin_cp(['only.txt']);
    expect(envelope.status).toBe('error');
    expect(envelope.renderedErr).toContain('nothing copied');
    expect(mockCpCmd).not.toHaveBeenCalled();
  });

  it('still reports usage when given nothing at all', async () => {
    const envelope: CommandEnvelope = await builtin_cp([]);
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
  it('asks where a lone source should go, and moves it there', async () => {
    mockMvCmd.mockResolvedValue(true);
    mockDestination.mockResolvedValue('/home/chris/moved.txt');
    const envelope: CommandEnvelope = await builtin_mv(['only.txt']);
    expect(mockDestination).toHaveBeenCalledTimes(1);
    expect(envelope.status).toBe('ok');
    expect(mockMvCmd).toHaveBeenCalledWith(expect.stringContaining('only.txt'), '/home/chris/moved.txt');
  });

  it('moves nothing when the destination is abandoned', async () => {
    mockDestination.mockResolvedValue('   ');
    const envelope: CommandEnvelope = await builtin_mv(['only.txt']);
    expect(envelope.status).toBe('error');
    expect(envelope.renderedErr).toContain('nothing moved');
    expect(mockMvCmd).not.toHaveBeenCalled();
  });

  it('still reports usage when given nothing at all', async () => {
    const envelope: CommandEnvelope = await builtin_mv([]);
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

describe('mv inside a projection (/proc/tags)', () => {
  const inTags = (p: string): boolean => p.startsWith('/proc/');
  afterEach(() => { mockVirtual.mockImplementation((): boolean => false); });

  it('mv renames inside the projection and passes its refusal on once, never "mv: mv:"', async () => {
    mockVirtual.mockImplementation(inTags);
    mockVfsRename.mockResolvedValueOnce({ ok: true as const, value: true as const });
    expect((await builtin_mv(['/proc/tags/a', '/proc/tags/b'])).status).toBe('ok');
    expect(mockVfsRename).toHaveBeenCalledWith('/proc/tags/a', '/proc/tags/b');
    expect(mockMvCmd).not.toHaveBeenCalled();
    mockVfsRename.mockResolvedValueOnce({ ok: false as const, errno: 'EIO' as const });
    mockStackPop.mockReturnValueOnce({ message: "[dispatcher] | mv: cannot move '/proc/tags/a' to '/home/x': Invalid cross-device link" } as never);
    const refused: CommandEnvelope = await builtin_mv(['/proc/tags/a', '/home/x']);
    expect(refused.renderedErr).toContain("mv: cannot move '/proc/tags/a' to '/home/x': Invalid cross-device link");
    expect(refused.renderedErr).not.toContain('mv: mv:');
  });
});
