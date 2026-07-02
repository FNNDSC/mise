import { jest, describe, it, expect, beforeEach } from '@jest/globals';

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
}));

const mockMkdirCmd = jest.fn();
const mockMkdirRender = jest.fn((p: string, ok: boolean) => `mkdir:${p}:${ok}`);
jest.unstable_mockModule('@fnndsc/chili/commands/fs/mkdir.js', () => ({ files_mkdir: mockMkdirCmd }));

const mockTouchCmd = jest.fn();
const mockTouchRender = jest.fn((p: string, ok: boolean) => `touch:${p}:${ok}`);
jest.unstable_mockModule('@fnndsc/chili/commands/fs/touch.js', () => ({ files_touch: mockTouchCmd }));
jest.unstable_mockModule('@fnndsc/chili/views/fs.js', () => ({
  mkdir_render: mockMkdirRender,
  touch_render: mockTouchRender,
}));

const { builtin_mkdir } = await import('../src/builtins/fs/mkdir.js');
const { builtin_touch } = await import('../src/builtins/fs/touch.js');

let logSpy: jest.SpiedFunction<typeof console.log>;
let errSpy: jest.SpiedFunction<typeof console.error>;
beforeEach(() => {
  jest.clearAllMocks();
  logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
  errSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('builtin_mkdir', () => {
  it('prints usage with no arguments', async () => {
    await builtin_mkdir([]);
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('Usage: mkdir'));
  });

  it('creates a directory and invalidates the parent cache', async () => {
    mockMkdirCmd.mockResolvedValue(true);
    await builtin_mkdir(['newdir']);
    expect(mockMkdirCmd).toHaveBeenCalledWith('/home/chris/newdir');
    expect(logSpy).toHaveBeenCalledWith('mkdir:/home/chris/newdir:true');
    expect(mockInvalidate).toHaveBeenCalledWith('/home/chris');
  });

  it('reports a per-path error without aborting the loop', async () => {
    mockMkdirCmd.mockRejectedValueOnce(new Error('exists')).mockResolvedValueOnce(true);
    await builtin_mkdir(['a', 'b']);
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('exists'));
    expect(mockMkdirCmd).toHaveBeenCalledTimes(2);
  });
});

describe('builtin_touch', () => {
  it('prints usage with no file argument', async () => {
    await builtin_touch([]);
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('Usage: touch'));
  });

  it('creates a file and invalidates the parent cache', async () => {
    mockTouchCmd.mockResolvedValue(true);
    await builtin_touch(['note.txt']);
    expect(mockTouchCmd).toHaveBeenCalledWith('/home/chris/note.txt', {});
    expect(logSpy).toHaveBeenCalledWith('touch:/home/chris/note.txt:true');
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
    await builtin_touch(['bad.txt']);
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('Failed to create file'));
  });
});
