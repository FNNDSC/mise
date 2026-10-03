/**
 * @file rmdir: an empty folder goes, one that holds anything is refused by
 * name; inside a projection (/proc/tags) the projection removes it; rm
 * refuses under /proc/tags and names the verb that does the job.
 */
import { jest, describe, it, expect, beforeEach } from '@jest/globals';

const mockVirtual = jest.fn((p: string): boolean => p.startsWith('/proc/'));
const mockVfsRmdir = jest.fn(async (_p: string): Promise<boolean> => true);
const mockVfsList = jest.fn(async (_p: string): Promise<{ ok: boolean; value?: unknown[] }> => ({ ok: true, value: [] }));
jest.unstable_mockModule('@fnndsc/salsa', () => ({
  PROC_TAGS_PREFIX: '/proc/tags',
  vfsDispatcher: { path_isVirtual: mockVirtual, rmdir: mockVfsRmdir, list: mockVfsList },
}));
const mockStackPop = jest.fn((): { message: string } | undefined => undefined);
jest.unstable_mockModule('@fnndsc/cumin', () => ({
  envelope_ok: (rendered: string, model?: unknown) => ({ status: 'ok', rendered, model }),
  envelope_error: (rendered: string, _e?: unknown, renderedErr?: string) => ({ status: 'error', rendered, renderedErr }),
  errorStack: { stack_pop: mockStackPop },
  listCache_get: () => ({ cache_invalidate: jest.fn() }),
}));
jest.unstable_mockModule('../src/builtins/utils.js', () => ({
  path_resolve: async (p: string): Promise<string> => (p.startsWith('/') ? p : `/home/chris/${p}`),
  error_stripDebugPrefix: (m: string): string => m.replace(/^\[[^\]]*\]\s*\|\s*/, ''),
}));
const mockFolderExists = jest.fn(async (_p: string): Promise<boolean> => true);
jest.unstable_mockModule('../src/builtins/fs/folderExists.js', () => ({ folder_checkExists: mockFolderExists }));
const mockRmRun = jest.fn(async (_a: unknown) => ({ status: 'ok', rendered: '' }));
jest.unstable_mockModule('../src/builtins/fs/rm.js', () => ({ rm_run: mockRmRun }));

const { builtin_rmdir, rmdirArgs_parse } = await import('../src/builtins/fs/rmdir.js');

beforeEach(() => {
  jest.clearAllMocks();
  process.exitCode = 0;
});

describe('rmdir', () => {
  it('removes an empty store folder through rm, silently', async () => {
    const env = await builtin_rmdir(['scratch']);
    expect(env.status).toBe('ok');
    expect(env.rendered).toBe('');
    expect(mockRmRun).toHaveBeenCalledWith({ recursive: true, force: false, interactive: false, once: false, paths: ['/home/chris/scratch'] });
  });

  it('refuses a folder that holds anything, and one that is not there, by name', async () => {
    mockVfsList.mockResolvedValueOnce({ ok: true, value: [{ name: 'f' }] });
    expect((await builtin_rmdir(['full'])).renderedErr).toContain("rmdir: failed to remove 'full': Directory not empty");
    mockFolderExists.mockResolvedValueOnce(false);
    expect((await builtin_rmdir(['gone'])).renderedErr).toContain("rmdir: failed to remove 'gone': No such file or directory");
    expect(mockRmRun).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  it("deletes a tag through the projection, and says the projection's refusal in rmdir's words", async () => {
    expect((await builtin_rmdir(['/proc/tags/old'])).status).toBe('ok');
    expect(mockVfsRmdir).toHaveBeenCalledWith('/proc/tags/old');
    mockVfsRmdir.mockResolvedValueOnce(false);
    mockStackPop.mockReturnValueOnce({ message: '[tag_delete ] | urgent: Directory not empty (2 feeds wear it)' });
    expect((await builtin_rmdir(['/proc/tags/urgent'])).renderedErr).toContain("rmdir: failed to remove '/proc/tags/urgent': Directory not empty (2 feeds wear it)");
    mockVfsRmdir.mockResolvedValueOnce(false);
    mockStackPop.mockReturnValueOnce({ message: "[dispatcher] | rmdir: failed to remove '/proc/jobs/feed_1': Read-only file system" });
    expect((await builtin_rmdir(['/proc/jobs/feed_1'])).renderedErr).toContain("rmdir: failed to remove '/proc/jobs/feed_1': Read-only file system");
  });

  it('takes paths only, refusing any option by name', () => {
    expect(rmdirArgs_parse(['-p', 'x'])).toEqual({ refused: "rmdir: invalid option -- 'p'" });
    expect(rmdirArgs_parse(['--parents'])).toEqual({ refused: "rmdir: unrecognized option '--parents'" });
    expect(rmdirArgs_parse(['--', '-odd'])).toEqual({ paths: ['-odd'] });
  });

  it('reports usage with nothing to remove', async () => {
    expect((await builtin_rmdir([])).renderedErr).toContain('Usage: rmdir');
  });
});
