import { jest, describe, it, expect, beforeEach } from '@jest/globals';

// utils.commandArgs_process runs for real; stub only its load-time boundary.
jest.unstable_mockModule('@fnndsc/salsa', () => ({ context_getSingle: jest.fn() }));
jest.unstable_mockModule('@fnndsc/cumin', () => ({}));
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

const mockSettingsSave = jest.fn();
const settings: { config: { storeUrl?: string } } = { config: {} };
jest.unstable_mockModule('../src/config/settings.js', () => ({ settings, settings_save: mockSettingsSave }));

const { builtin_store } = await import('../src/builtins/store.js');

let logSpy: jest.SpiedFunction<typeof console.log>;
let errSpy: jest.SpiedFunction<typeof console.error>;
beforeEach(() => {
  jest.clearAllMocks();
  settings.config = {};
  process.exitCode = 0;
  logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
  errSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('builtin_store', () => {
  it('prints usage with no subcommand', async () => {
    await builtin_store([]);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Usage: store'));
  });

  it('lists store plugins with the grid view', async () => {
    mockListPlugins.mockResolvedValue([{ name: 'pl-a' }]);
    await builtin_store(['list']);
    expect(mockGrid).toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith('GRID');
  });

  it('uses the long view with -l', async () => {
    mockListPlugins.mockResolvedValue([{ name: 'pl-a' }]);
    await builtin_store(['list', '-l']);
    expect(mockLong).toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith('LONG');
  });

  it('notes an empty listing', async () => {
    mockListPlugins.mockResolvedValue([]);
    await builtin_store(['list']);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('No plugins found'));
  });

  it('requires a query for search', async () => {
    await builtin_store(['search']);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Usage: store search'));
  });

  it('searches the store', async () => {
    mockSearchPlugins.mockResolvedValue([{ name: 'pl-b' }]);
    await builtin_store(['search', 'brain']);
    expect(mockSearchPlugins).toHaveBeenCalledWith('brain', expect.anything());
    expect(logSpy).toHaveBeenCalledWith('GRID');
  });

  it('notes no search matches', async () => {
    mockSearchPlugins.mockResolvedValue([]);
    await builtin_store(['search', 'nope']);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("matching 'nope'"));
  });

  it('installs via plugin_addInteractive', async () => {
    await builtin_store(['install', 'pl-c']);
    expect(mockAddInteractive).toHaveBeenCalled();
  });

  it('inspects the current store URL', async () => {
    await builtin_store(['inspect']);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Peer store URL'));
  });

  it('sets a custom store URL and saves', async () => {
    await builtin_store(['set', 'http://custom/api/']);
    expect(settings.config.storeUrl).toBe('http://custom/api/');
    expect(mockSettingsSave).toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Store URL set'));
  });

  it('rejects set with no URL', async () => {
    await builtin_store(['set']);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Usage: store set'));
    expect(process.exitCode).toBe(1);
  });

  it('resets the store URL and saves', async () => {
    settings.config.storeUrl = 'http://custom/';
    await builtin_store(['reset']);
    expect(settings.config.storeUrl).toBeUndefined();
    expect(mockSettingsSave).toHaveBeenCalled();
  });

  it('rejects an unknown subcommand', async () => {
    await builtin_store(['frobnicate']);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Unknown subcommand'));
  });

  it('reports an error from the store command', async () => {
    mockListPlugins.mockRejectedValue(new Error('boom'));
    await builtin_store(['list']);
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('boom'));
  });
});
