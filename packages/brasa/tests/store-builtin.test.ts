import { jest, describe, it, expect, beforeEach } from '@jest/globals';

// utils.commandArgs_process runs for real; stub only its load-time boundary.
jest.unstable_mockModule('@fnndsc/salsa', () => ({ context_getSingle: jest.fn() }));
jest.unstable_mockModule('@fnndsc/cumin', () => ({
  envelope_ok: (rendered: string) => ({ status: 'ok', rendered }),
  envelope_error: (rendered: string, _errors?: unknown, renderedErr?: string) => (renderedErr !== undefined ? { status: 'error', rendered, renderedErr } : { status: 'error', rendered }),}));
jest.unstable_mockModule('@fnndsc/chili/models/listing.js', () => ({}));
jest.unstable_mockModule('../src/session/index.js', () => ({ session: {} }));

const mockListPlugins = jest.fn();
const mockSearchPlugins = jest.fn();
jest.unstable_mockModule('@fnndsc/chili/commands/store/list.js', () => ({
  store_listPlugins: mockListPlugins,
  store_searchPlugins: mockSearchPlugins,
}));

const mockGrid = jest.fn(() => 'GRID');
const mockLong = jest.fn(() => 'LONG');
jest.unstable_mockModule('@fnndsc/chili/views/ls.js', () => ({ grid_render: mockGrid, long_render: mockLong }));

const mockStart = jest.fn();
const mockStop = jest.fn();
jest.unstable_mockModule('../src/lib/spinner.js', () => ({ spinner: { start: mockStart, stop: mockStop } }));

// res/plugin.js drags in the whole chili plugin chain (figlet et al.); stub it.
const mockAddInteractive = jest.fn();
jest.unstable_mockModule('../src/builtins/res/plugin.js', () => ({ plugin_addInteractive: mockAddInteractive }));

const mockPersist = jest.fn();
let storeUrl: string | undefined;
const STORE_DEFAULT = 'https://default/api/v1/';
jest.unstable_mockModule('../src/config/storeConfig.js', () => ({
  DEFAULT_STORE_URL: STORE_DEFAULT,
  storeUrl_get: (): string => storeUrl ?? STORE_DEFAULT,
  storeUrl_isDefault: (): boolean => storeUrl === undefined,
  storeUrl_set: (url: string): void => { storeUrl = url; },
  storeUrl_clear: (): void => { storeUrl = undefined; },
  storeConfig_persist: mockPersist,
}));

const { builtin_store } = await import('../src/builtins/store.js');

let logSpy: jest.SpiedFunction<typeof console.log>;
let errSpy: jest.SpiedFunction<typeof console.error>;
beforeEach(() => {
  jest.clearAllMocks();
  storeUrl = undefined;
  process.exitCode = 0;
  logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
  errSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('builtin_store', () => {
  it('renders usage with no subcommand', async () => {
    const env = await builtin_store([]);
    expect(env.rendered).toContain('Usage: store');
  });

  it('lists store plugins with the grid view', async () => {
    mockListPlugins.mockResolvedValue([{ name: 'pl-a' }]);
    const env = await builtin_store(['list']);
    expect(mockGrid).toHaveBeenCalled();
    expect(env.rendered).toContain('GRID');
  });

  it('uses the long view with -l', async () => {
    mockListPlugins.mockResolvedValue([{ name: 'pl-a' }]);
    const env = await builtin_store(['list', '-l']);
    expect(mockLong).toHaveBeenCalled();
    expect(env.rendered).toContain('LONG');
  });

  it('notes an empty listing', async () => {
    mockListPlugins.mockResolvedValue([]);
    const env = await builtin_store(['list']);
    expect(env.rendered).toContain('No plugins found');
  });

  it('requires a query for search', async () => {
    const env = await builtin_store(['search']);
    expect(env.rendered).toContain('Usage: store search');
  });

  it('searches the store', async () => {
    mockSearchPlugins.mockResolvedValue([{ name: 'pl-b' }]);
    const env = await builtin_store(['search', 'brain']);
    expect(mockSearchPlugins).toHaveBeenCalledWith('brain', expect.anything());
    expect(env.rendered).toContain('GRID');
  });

  it('notes no search matches', async () => {
    mockSearchPlugins.mockResolvedValue([]);
    const env = await builtin_store(['search', 'nope']);
    expect(env.rendered).toContain("matching 'nope'");
  });

  it('installs via plugin_addInteractive', async () => {
    mockAddInteractive.mockResolvedValue({ status: 'ok', rendered: '' });
    await builtin_store(['install', 'pl-c']);
    expect(mockAddInteractive).toHaveBeenCalled();
  });

  it('inspects the current store URL', async () => {
    const env = await builtin_store(['inspect']);
    expect(env.rendered).toContain('Peer store URL');
  });

  it('sets a custom store URL and saves', async () => {
    const env = await builtin_store(['set', 'http://custom/api/']);
    expect(storeUrl).toBe('http://custom/api/');
    expect(mockPersist).toHaveBeenCalled();
    expect(env.rendered).toContain('Store URL set');
  });

  it('rejects set with no URL', async () => {
    const env = await builtin_store(['set']);
    expect(env.renderedErr).toContain('Usage: store set');
    expect(process.exitCode).toBe(1);
  });

  it('resets the store URL and saves', async () => {
    storeUrl = 'http://custom/';
    await builtin_store(['reset']);
    expect(storeUrl).toBeUndefined();
    expect(mockPersist).toHaveBeenCalled();
  });

  it('rejects an unknown subcommand', async () => {
    const env = await builtin_store(['frobnicate']);
    expect(env.renderedErr).toContain('Unknown subcommand');
  });

  it('reports an error from the store command', async () => {
    mockListPlugins.mockRejectedValue(new Error('boom'));
    const env = await builtin_store(['list']);
    expect(env.renderedErr).toContain('boom');
  });
});
