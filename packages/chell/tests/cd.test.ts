/**
 * @file Unit tests for the extracted `cd` path helpers.
 *
 * Covers the pure path-classification logic carved out of `builtin_cd`.
 * Session/cross-package deps are mocked so the module loads in isolation.
 *
 * @module
 */
import { jest, describe, it, expect } from '@jest/globals';

jest.unstable_mockModule('../src/session/index.js', () => ({ session: {} }));
jest.unstable_mockModule('../src/builtins/utils.js', () => ({
  path_resolve: jest.fn(),
  path_resolveLinks: jest.fn(),
  error_stripDebugPrefix: jest.fn(),
}));

const { vfsPath_normalize, vfsPath_isStructural, folder_verifyPathMatch } = await import('../src/builtins/fs/cd.js');

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
