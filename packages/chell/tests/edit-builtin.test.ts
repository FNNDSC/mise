import { jest, describe, it, expect, beforeEach } from '@jest/globals';

jest.unstable_mockModule('@fnndsc/salsa', () => ({
  context_getSingle: jest.fn(async () => ({ user: 'chris', folder: '/home/chris' })),
}));
const mockStackPop = jest.fn(() => undefined as { message: string } | undefined);
const mockInvalidate = jest.fn();
jest.unstable_mockModule('@fnndsc/cumin', () => ({
  errorStack: { stack_pop: mockStackPop },
  listCache_get: jest.fn(() => ({ cache_invalidate: mockInvalidate })),
}));
jest.unstable_mockModule('@fnndsc/chili/models/listing.js', () => ({}));
jest.unstable_mockModule('../src/session/index.js', () => ({ session: { getCWD: jest.fn(async () => '/home/chris') } }));

const mockCat = jest.fn();
jest.unstable_mockModule('@fnndsc/chili/commands/fs/cat.js', () => ({ files_cat: mockCat }));
const mockReplace = jest.fn();
jest.unstable_mockModule('@fnndsc/chili/commands/fs/edit.js', () => ({ file_replaceContent: mockReplace }));

const ok = <T>(value: T) => ({ ok: true as const, value });
const err = () => ({ ok: false as const });

const { builtin_edit } = await import('../src/builtins/fs/edit.js');
const { surface_set } = await import('../src/core/surface.js');
import type { Surface, SurfaceCapabilities, LocalEditRequest, LocalEditResult } from '../src/core/surface.js';

// The surface's editor is a mock the tests drive.
const mockLocalEdit = jest.fn(async (_r: LocalEditRequest): Promise<LocalEditResult> => ({ content: '', changed: false }));

/** Installs a surface with the given capabilities and the mock editor. */
function surface_install(capabilities: SurfaceCapabilities): void {
  const surface: Surface = {
    capabilities,
    prompt: async (): Promise<string> => '',
    pipeSegment: async (_c: string, i: Buffer): Promise<Buffer> => i,
    localEdit: mockLocalEdit,
  };
  surface_set(surface);
}

let logSpy: jest.SpiedFunction<typeof console.log>;
let errSpy: jest.SpiedFunction<typeof console.error>;
beforeEach(() => {
  jest.clearAllMocks();
  process.exitCode = 0;
  mockLocalEdit.mockResolvedValue({ content: '', changed: false });
  // The CLI host can edit locally; install a surface that says so.
  surface_install({ hiddenInput: true, localEdit: true, tty: true, pipeSegments: true });
  logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
  errSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('builtin_edit', () => {
  it('prints usage with no file', async () => {
    await builtin_edit([]);
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('Usage: edit'));
    expect(process.exitCode).toBe(1);
  });

  it('fails clearly when the surface cannot edit locally', async () => {
    surface_install({ hiddenInput: false, localEdit: false, tty: false, pipeSegments: false });
    await builtin_edit(['notes.txt']);
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('cannot open a local editor'));
    expect(process.exitCode).toBe(1);
    expect(mockCat).not.toHaveBeenCalled();
  });

  it('refuses to edit a binary file', async () => {
    await builtin_edit(['image.png']);
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('binary file'));
    expect(process.exitCode).toBe(1);
  });

  it('reports a read failure', async () => {
    mockCat.mockResolvedValue(err());
    mockStackPop.mockReturnValue({ message: 'no such file' });
    await builtin_edit(['notes.txt']);
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('no such file'));
    expect(process.exitCode).toBe(1);
  });

  it('hands the file content to the surface editor', async () => {
    mockCat.mockResolvedValue(ok('original'));
    mockLocalEdit.mockResolvedValue({ content: 'original', changed: false });
    await builtin_edit(['notes.txt']);
    expect(mockLocalEdit).toHaveBeenCalledWith(expect.objectContaining({ content: 'original' }));
  });

  it('does nothing when the content is unchanged', async () => {
    mockCat.mockResolvedValue(ok('original'));
    mockLocalEdit.mockResolvedValue({ content: 'original', changed: false });
    await builtin_edit(['notes.txt']);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('no changes'));
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('reports an editor failure', async () => {
    mockCat.mockResolvedValue(ok('original'));
    mockLocalEdit.mockRejectedValue(new Error("failed to launch 'vi'"));
    await builtin_edit(['notes.txt']);
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('failed to launch'));
    expect(process.exitCode).toBe(1);
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('re-uploads edited content and invalidates the cache', async () => {
    mockCat.mockResolvedValue(ok('original'));
    mockLocalEdit.mockResolvedValue({ content: 'EDITED CONTENT', changed: true });
    mockReplace.mockResolvedValue({ success: true });
    await builtin_edit(['notes.txt']);
    expect(mockReplace).toHaveBeenCalled();
    expect(mockInvalidate).toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Saved'));
  });

  it('preserves the edited content when the save fails', async () => {
    mockCat.mockResolvedValue(ok('original'));
    mockLocalEdit.mockResolvedValue({ content: 'EDITED CONTENT', changed: true });
    mockReplace.mockResolvedValue({ success: false, error: 'server rejected' });
    await builtin_edit(['notes.txt']);
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('Save failed'));
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('preserved at'));
    expect(process.exitCode).toBe(1);
  });
});
