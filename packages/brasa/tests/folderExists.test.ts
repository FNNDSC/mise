/**
 * @file Tests for folder_checkExists: an exact-path folder lookup whose
 * misses leave nothing on the error stack.
 */
import { jest, describe, it, expect, beforeEach } from '@jest/globals';

const stack: string[] = [];
const lookup = jest.fn<(path: string) => Promise<unknown>>();
jest.unstable_mockModule('@fnndsc/cumin', () => ({
  errorStack: {
    checkpoint_mark: (): number => stack.length,
    checkpoint_drain: (checkpoint: number): string[] => stack.splice(checkpoint),
  },
}));
jest.unstable_mockModule('../src/session/index.js', () => ({
  session: {
    connection: { client_get: async (): Promise<unknown> => ({ getFileBrowserFolderByPath: lookup }) },
    physicalMode_get: (): boolean => true,
  },
}));
jest.unstable_mockModule('../src/builtins/utils.js', () => ({
  path_resolveLinks: async (p: string): Promise<string> => p,
}));
jest.unstable_mockModule('../src/builtins/fs/cd.js', () => ({
  folder_verifyPathMatch: (folder: { path?: string } | null, p: string): boolean => folder?.path === p.replace(/^\/+/, ''),
  vfsPath_isStructural: (p: string): boolean => p === '/',
  vfsPath_normalize: (p: string): string => p,
}));

const { folder_checkExists } = await import('../src/builtins/fs/folderExists.js');

describe('folder_checkExists', () => {
  beforeEach(() => { stack.length = 0; lookup.mockReset(); });

  it('is true only for a folder at exactly the path', async () => {
    lookup.mockResolvedValueOnce({ path: 'home/me/a' });
    expect(await folder_checkExists('/home/me/a')).toBe(true);
    // CUBE answers a missing path with its nearest ancestor.
    lookup.mockResolvedValueOnce({ path: 'home/me' });
    expect(await folder_checkExists('/home/me/nope')).toBe(false);
  });

  it('drains what a miss leaves on the error stack, keeping what was there', async () => {
    stack.push('earlier');
    lookup.mockImplementationOnce(async () => { stack.push('404 from the lookup'); throw new Error('404'); });
    expect(await folder_checkExists('/home/me/nope')).toBe(false);
    expect(stack).toEqual(['earlier']);
  });

  it('takes the root as standing without asking', async () => {
    expect(await folder_checkExists('/')).toBe(true);
    expect(lookup).not.toHaveBeenCalled();
  });
});
