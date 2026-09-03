/**
 * @file Unit tests for the extracted `cd` path helpers.
 *
 * Covers the pure path-classification logic carved out of `builtin_cd`.
 * Session/cross-package deps are mocked so the module loads in isolation.
 *
 * @module
 */
import { jest, describe, it, expect } from '@jest/globals';

const folderByPath = jest.fn<(path: string) => Promise<unknown>>();
const directoryChange = jest.fn<(path: string) => Promise<void>>();
jest.unstable_mockModule('../src/session/index.js', () => ({
  session: {
    physicalMode_get: (): boolean => true,
    getCWD: async (): Promise<string> => '/home/u',
    directory_change: directoryChange,
    previousCWD_get: (): string | undefined => undefined,
    connection: { config: { debug: false }, client_get: async (): Promise<unknown> => ({ getFileBrowserFolderByPath: folderByPath }) },
  },
}));
jest.unstable_mockModule('@fnndsc/cumin', () => ({
  envelope_ok: (rendered: string, model?: unknown) =>
    model === undefined ? { status: 'ok', rendered } : { status: 'ok', rendered, model },
  envelope_error: (rendered: string, errors?: unknown, renderedErr?: string) => {
    const envelope: Record<string, unknown> = { status: 'error', rendered };
    if (errors !== undefined) envelope.errors = errors;
    if (renderedErr !== undefined) envelope.renderedErr = renderedErr;
    return envelope;
  },
}));
jest.unstable_mockModule('../src/builtins/utils.js', () => ({
  path_resolve: jest.fn(async (p: string): Promise<string> => p),
  path_resolveLinks: jest.fn(async (p: string): Promise<string> => p),
  error_stripDebugPrefix: jest.fn((m: string): string => m),
}));
const vfsList = jest.fn<(path: string) => Promise<{ ok: boolean; value?: unknown[] }>>();
jest.unstable_mockModule('@fnndsc/salsa', () => ({
  vfsDispatcher: {
    list: vfsList,
    providers_get: (): Array<{ prefix: string }> => [{ prefix: '/proc' }],
    provider_get: (): { prefix: string } => ({ prefix: '' }),
  },
}));

const { vfsPath_normalize, vfsPath_isStructural, folder_verifyPathMatch, cfsLink_target, cd_run } = await import('../src/builtins/fs/cd.js');

describe('cd through a CFS link', () => {
  const link: string = '/home/u/feeds/feed_1/pl-dircopy_2/data/home_u_uploads_x';
  beforeEach(() => {
    vfsList.mockResolvedValue({ ok: true, value: [
      { name: 'home_u_uploads_x', type: 'link', size: 48, owner: 'u', date: '', target: '/home/u/uploads/x' },
    ] });
    folderByPath.mockReset();
    directoryChange.mockReset();
  });
  it('follows the link to its target', async () => {
    folderByPath.mockResolvedValue({ data: { path: '/home/u/uploads/x' } });
    const result = await cd_run({ path: link });
    expect(result.status).toBe('ok');
    expect(directoryChange).toHaveBeenCalledWith('/home/u/uploads/x');
  });
  it('names the target when the link dangles', async () => {
    folderByPath.mockResolvedValue(null);
    const result = await cd_run({ path: link });
    expect(result.status).toBe('error');
    expect(result.renderedErr).toContain('link target /home/u/uploads/x');
    expect(directoryChange).not.toHaveBeenCalled();
  });
});

describe('cfsLink_target', () => {
  it('names the target of a link in its parent listing, and nothing for a directory', async () => {
    vfsList.mockResolvedValue({ ok: true, value: [
      { name: 'data', type: 'dir', size: 0, owner: 'u', date: '' },
      { name: 'home_u_uploads_x', type: 'link', size: 48, owner: 'u', date: '', target: '/home/u/uploads/x' },
      { name: 'dangling', type: 'link', size: 0, owner: 'u', date: '' },
    ] });
    expect(await cfsLink_target('/home/u/feeds/feed_1/pl-dircopy_2/data/home_u_uploads_x')).toBe('/home/u/uploads/x');
    expect(await cfsLink_target('/home/u/feeds/feed_1/pl-dircopy_2/data/data')).toBeNull();
    expect(await cfsLink_target('/home/u/feeds/feed_1/pl-dircopy_2/data/dangling')).toBeNull();
    expect(await cfsLink_target('/home/u/feeds/feed_1/pl-dircopy_2/data/absent')).toBeNull();
    expect(vfsList).toHaveBeenCalledWith('/home/u/feeds/feed_1/pl-dircopy_2/data');
  });
  it('is nothing for the root, a relative path, or an unlistable parent', async () => {
    expect(await cfsLink_target('/')).toBeNull();
    expect(await cfsLink_target('relative/x')).toBeNull();
    vfsList.mockResolvedValue({ ok: false });
    expect(await cfsLink_target('/home/u/x')).toBeNull();
  });
});

describe('vfsPath_normalize', () => {
  it('strips a single trailing slash', () => {
    expect(vfsPath_normalize('/a/b/')).toBe('/a/b');
  });
  it('leaves the root path intact', () => {
    expect(vfsPath_normalize('/')).toBe('/');
  });
  it('leaves slash-less paths intact', () => {
    expect(vfsPath_normalize('/a/b')).toBe('/a/b');
  });
});

describe('vfsPath_isStructural', () => {
  it('accepts known structural containers', () => {
    for (const p of ['/', '/net', '/net/pacs', '/net/pacs/queries', '/proc', '/proc/jobs']) {
      expect(vfsPath_isStructural(p)).toBe(true);
    }
  });
  it('rejects arbitrary paths', () => {
    expect(vfsPath_isStructural('/proc/jobs/5')).toBe(false);
    expect(vfsPath_isStructural('/home/user')).toBe(false);
  });
});

describe('folder_verifyPathMatch', () => {
  it('is false for null/undefined folder', () => {
    expect(folder_verifyPathMatch(null, '/a')).toBe(false);
    expect(folder_verifyPathMatch(undefined, '/a')).toBe(false);
  });
  it('matches ignoring leading/trailing slashes', () => {
    expect(folder_verifyPathMatch({ path: 'home/user/' }, '/home/user')).toBe(true);
    expect(folder_verifyPathMatch({ data: { path: '/home/user' } }, 'home/user')).toBe(true);
  });
  it('rejects mismatched paths', () => {
    expect(folder_verifyPathMatch({ path: '/home/other' }, '/home/user')).toBe(false);
  });
});
