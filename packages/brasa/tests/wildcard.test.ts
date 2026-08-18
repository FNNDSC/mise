import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const mockCacheGet = jest.fn();
const mockCacheSet = jest.fn();
const mockGetCWD = jest.fn();
const mockVfsList = jest.fn();
const mockResolveChrisFs = jest.fn();

jest.unstable_mockModule('../src/session/index.js', () => ({
  session: { getCWD: mockGetCWD },
}));
jest.unstable_mockModule('@fnndsc/salsa', () => ({
  vfsDispatcher: { list: mockVfsList },
  context_getSingle: jest.fn(async () => ({ user: 'testuser' })),
}));
jest.unstable_mockModule('@fnndsc/chili/utils/cli.js', () => ({
  path_resolveChrisFs: mockResolveChrisFs,
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

const { shellWords_expand, wildcard_expandMatches } = await import('../src/builtins/wildcard.js');
const { shellWords_tokenize } = await import('../src/lib/parser.js');

describe('wildcard_expandMatches()', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCacheGet.mockReturnValue(undefined);
    mockGetCWD.mockResolvedValue('/home/testuser');
    mockResolveChrisFs.mockImplementation(async (value: string): Promise<string> => value);
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

  it('expands an unquoted CFS/VFS word without a command allow-list', async () => {
    mockVfsList.mockResolvedValue({
      ok: true,
      value: [
        { name: 'scan-one.nii', type: 'file' },
        { name: 'scan-two.nii', type: 'file' },
      ],
    });

    const result = await shellWords_expand(shellWords_tokenize('scan-*.nii'), (): boolean => true);

    expect(result).toEqual({
      ok: true,
      value: [
        expect.objectContaining({ value: 'scan-one.nii', pathnameExpanded: true }),
        expect.objectContaining({ value: 'scan-two.nii', pathnameExpanded: true }),
      ],
    });
  });

  it('normalizes a home-relative pattern before listing', async () => {
    mockVfsList.mockResolvedValue({ ok: true, value: [{ name: 'scan.nii', type: 'file' }] });

    const result = await shellWords_expand(shellWords_tokenize('~/feeds/*.nii'), (): boolean => true);

    expect(mockVfsList).toHaveBeenCalledWith('/home/testuser/feeds');
    expect(result).toEqual({
      ok: true,
      value: [expect.objectContaining({ value: '/home/testuser/feeds/scan.nii' })],
    });
  });

  it('lists through a CFS directory link but retains its logical output path', async () => {
    mockResolveChrisFs.mockResolvedValue('/PUBLIC/shared');
    mockVfsList.mockResolvedValue({ ok: true, value: [{ name: 'scan.nii', type: 'file' }] });

    const result = await shellWords_expand(shellWords_tokenize('~/public/*.nii'), (): boolean => true);

    expect(mockVfsList).toHaveBeenCalledWith('/PUBLIC/shared');
    expect(result).toEqual({
      ok: true,
      value: [expect.objectContaining({ value: '/home/testuser/public/scan.nii' })],
    });
  });

  it('keeps quoted wildcard syntax literal', async () => {
    const result = await shellWords_expand(shellWords_tokenize("'scan-*.nii'"), (): boolean => true);

    expect(result).toEqual({
      ok: true,
      value: [expect.objectContaining({ value: 'scan-*.nii', pathnameExpanded: false })],
    });
    expect(mockVfsList).not.toHaveBeenCalled();
  });

  it('expands an unquoted wildcard fragment beside a quoted literal fragment', async () => {
    mockVfsList.mockResolvedValue({
      ok: true,
      value: [
        { name: 'scan*1.nii', type: 'file' },
        { name: 'scan-a.nii', type: 'file' },
      ],
    });

    const result = await shellWords_expand(shellWords_tokenize('scan"*"?.nii'), (): boolean => true);

    expect(result).toEqual({
      ok: true,
      value: [expect.objectContaining({ value: 'scan*1.nii', pathnameExpanded: true })],
    });
  });
});
