import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const mockCacheGet = jest.fn();
const mockCacheSet = jest.fn();
const mockGetCWD = jest.fn();
const mockVfsList = jest.fn();

jest.unstable_mockModule('../src/session/index.js', () => ({
  session: { getCWD: mockGetCWD },
}));
jest.unstable_mockModule('@fnndsc/salsa', () => ({
  vfsDispatcher: { list: mockVfsList },
}));
jest.unstable_mockModule('@fnndsc/cumin', () => ({
  Err: (): { ok: false } => ({ ok: false }),
  Ok: <T>(value: T): { ok: true; value: T } => ({ ok: true, value }),
  errorStack: { stack_push: jest.fn() },
  listCache_get: (): { cache_get: typeof mockCacheGet; cache_set: typeof mockCacheSet } => ({
    cache_get: mockCacheGet,
    cache_set: mockCacheSet,
  }),
}));

const { wildcard_expandMatches } = await import('../src/builtins/wildcard.js');

describe('wildcard_expandMatches()', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCacheGet.mockReturnValue(undefined);
    mockGetCWD.mockResolvedValue('/home/testuser');
  });

  it('preserves a CFS link match for target classification', async () => {
    mockVfsList.mockResolvedValue({
      ok: true,
      value: [{ name: 'shared', type: 'link', target: '/PUBLIC/shared' }],
    });

    const result = await wildcard_expandMatches('/PUBLIC/*');

    expect(result).toEqual({
      ok: true,
      value: [{ path: '/PUBLIC/shared', type: 'link' }],
    });
  });
});
