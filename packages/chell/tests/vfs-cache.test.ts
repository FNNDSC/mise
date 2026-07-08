import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';

const mockDispatcherList = jest.fn();
jest.unstable_mockModule('@fnndsc/salsa', () => ({
  plugins_listAll: jest.fn(),
  vfsDispatcher: { list: mockDispatcherList },
}));

const mockGetCWD = jest.fn(async () => '/home/chris');
jest.unstable_mockModule('../src/session/index.js', () => ({ session: { getCWD: mockGetCWD } }));

interface CacheEntry { data: unknown; fresh: boolean }
const cacheStore: Map<string, CacheEntry> = new Map();
const mockCacheSet = jest.fn((key: string, data: unknown) => { cacheStore.set(key, { data, fresh: true }); });
const mockCacheInvalidate = jest.fn((key: string) => { cacheStore.delete(key); });
const mockStackPush = jest.fn();
jest.unstable_mockModule('@fnndsc/cumin', () => ({
  listCache_get: () => ({
    cache_get: (key: string): CacheEntry | undefined => cacheStore.get(key),
    cache_set: mockCacheSet,
    cache_invalidate: mockCacheInvalidate,
  }),
  Ok: <T>(value: T) => ({ ok: true as const, value }),
  Err: () => ({ ok: false as const }),
  errorStack: {
    stack_push: mockStackPush,
    stack_pop: jest.fn(() => ({ message: 'listing failed' })),
    checkpoint_mark: jest.fn(() => 0),
    checkpoint_drain: jest.fn(() => []),
    scope_run: (fn: () => unknown) => fn(),
  },
}));

jest.unstable_mockModule('@fnndsc/chili/models/listing.js', () => ({}));
const mockGridRender = jest.fn(() => 'GRID');
const mockLongRender = jest.fn(() => 'LONG');
jest.unstable_mockModule('@fnndsc/chili/views/ls.js', () => ({
  grid_render: mockGridRender,
  long_render: mockLongRender,
}));
const mockApplySort = jest.fn((items: unknown) => items);
jest.unstable_mockModule('@fnndsc/chili/utils/sort.js', () => ({ list_applySort: mockApplySort }));
const mockSpinner = { start: jest.fn(), stop: jest.fn(), updateMessage: jest.fn() };
jest.unstable_mockModule('../src/lib/spinner.js', () => ({ spinner: mockSpinner }));
jest.unstable_mockModule('../src/builtins/utils.js', () => ({
  error_stripDebugPrefix: (s: string): string => s,
}));

const ok = <T>(value: T) => ({ ok: true as const, value });
const err = () => ({ ok: false as const });

const { VFS } = await import('../src/lib/vfs/vfs.js');

const item = (name: string) => ({ name, type: 'dir', size: 0, owner: 'chris', date: '' });

let logSpy: jest.SpiedFunction<typeof console.log>;
let errSpy: jest.SpiedFunction<typeof console.error>;
beforeEach(() => {
  jest.clearAllMocks();
  cacheStore.clear();
  mockGetCWD.mockResolvedValue('/home/chris');
  mockApplySort.mockImplementation((items: unknown) => items);
  logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
  errSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  jest.useRealTimers();
});

describe('VFS.data_get caching', () => {
  it('serves a cache hit through the sorter without dispatching', async () => {
    cacheStore.set('/home/chris/data', { data: [item('a')], fresh: true });
    const result = await new VFS().data_get('data', { sort: 'size', reverse: true });
    expect(result.ok).toBe(true);
    expect(mockApplySort).toHaveBeenCalledWith([item('a')], 'size', true);
    expect(mockDispatcherList).not.toHaveBeenCalled();
  });

  it('fetches on a cache miss and populates the cache', async () => {
    mockDispatcherList.mockResolvedValue(ok([item('b')]));
    const result = await new VFS().data_get('/data');
    expect(result.ok).toBe(true);
    expect(mockCacheSet).toHaveBeenCalledWith('/data', [item('b')]);
  });

  it('bypasses the cache for /proc paths', async () => {
    cacheStore.set('/proc/status', { data: [item('stale')], fresh: true });
    mockDispatcherList.mockResolvedValue(ok([item('live')]));
    const result = await new VFS().data_get('/proc/status');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value[0].name).toBe('live');
    expect(mockCacheSet).not.toHaveBeenCalled();
  });

  it('propagates dispatcher failures and wraps thrown errors', async () => {
    mockDispatcherList.mockResolvedValue(err());
    expect((await new VFS().data_get('/data')).ok).toBe(false);

    mockGetCWD.mockRejectedValue(new Error('no session'));
    expect((await new VFS().data_get()).ok).toBe(false);
    expect(mockStackPush).toHaveBeenCalledWith('error', expect.stringContaining('no session'));
  });
});

describe('VFS.data_get -d (directory entry)', () => {
  it('returns the root marker for /', async () => {
    const root = await new VFS().data_get('/', { directory: true });
    expect(root.ok).toBe(true);
    if (root.ok) expect(root.value[0].name).toBe('/');
  });

  it('finds the entry in a cached parent listing', async () => {
    cacheStore.set('/home/chris', { data: [item('data'), item('other')], fresh: true });
    const matched = await new VFS().data_get('/home/chris/data', { directory: true });
    expect(matched.ok).toBe(true);
    if (matched.ok) expect(matched.value).toEqual([item('data')]);
  });

  it('fetches the parent listing when uncached and caches it', async () => {
    mockDispatcherList.mockResolvedValue(ok([item('data')]));
    const result = await new VFS().data_get('/home/chris/data', { directory: true });
    expect(result.ok).toBe(true);
    expect(mockDispatcherList).toHaveBeenCalledWith('/home/chris', expect.anything());
    expect(mockCacheSet).toHaveBeenCalledWith('/home/chris', [item('data')]);
  });

  it('synthesizes an entry when the parent has no match', async () => {
    mockDispatcherList.mockResolvedValue(ok([item('unrelated')]));
    const synthesized = await new VFS().data_get('/home/chris/ghost', { directory: true });
    expect(synthesized.ok).toBe(true);
    if (synthesized.ok) expect(synthesized.value[0]).toMatchObject({ name: 'ghost', owner: 'system' });
  });
});

describe('VFS.list rendering and refresh', () => {
  it('renders a grid by default and long format with --long', async () => {
    cacheStore.set('/home/chris', { data: [item('a')], fresh: true });
    await new VFS().list();
    expect(logSpy).toHaveBeenCalledWith('GRID');

    await new VFS().list(undefined, { long: true, human: true });
    expect(logSpy).toHaveBeenCalledWith('LONG');
    expect(mockLongRender).toHaveBeenCalledWith([item('a')], { human: true });
  });

  it('prints nothing for an empty listing', async () => {
    cacheStore.set('/home/chris', { data: [], fresh: true });
    await new VFS().list();
    expect(logSpy).not.toHaveBeenCalled();
  });

  it('reports errors from the stack', async () => {
    mockDispatcherList.mockResolvedValue(err());
    await new VFS().list('/nope');
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('listing failed'));
  });

  it('serves stale cache with an indicator and refreshes in the background', async () => {
    cacheStore.set('/home/chris', { data: [item('a')], fresh: false });
    mockDispatcherList.mockResolvedValue(ok([item('a')]));
    await new VFS().list();
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('(cached, refreshing...)'));
    // Let the un-awaited background refresh run.
    await new Promise((r: (v: unknown) => void) => setImmediate(r));
    expect(mockCacheInvalidate).toHaveBeenCalledWith('/home/chris');
  });

  it('shows a spinner when a cache miss takes longer than 500ms', async () => {
    jest.useFakeTimers();
    let resolveList: (v: unknown) => void = () => undefined;
    mockDispatcherList.mockReturnValue(new Promise((r: (v: unknown) => void) => { resolveList = r; }));
    const pending: Promise<void> = new VFS().list('/slow');
    await jest.advanceTimersByTimeAsync(600);
    expect(mockSpinner.start).toHaveBeenCalledWith('Fetching directory from remote', true);
    resolveList(ok([item('x')]));
    await pending;
    expect(mockSpinner.stop).toHaveBeenCalled();
  });

  it('never starts the spinner on a fast fetch', async () => {
    mockDispatcherList.mockResolvedValue(ok([item('x')]));
    await new VFS().list('/fast');
    expect(mockSpinner.start).not.toHaveBeenCalled();
  });
});
