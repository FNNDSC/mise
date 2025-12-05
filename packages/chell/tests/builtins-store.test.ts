import { describe, test, expect, jest, beforeEach } from '@jest/globals';

const mockSpinnerStart = jest.fn();
const mockSpinnerStop = jest.fn();
const mockStoreListPlugins = jest.fn();
const mockStoreSearchPlugins = jest.fn();
const mockGridRender = jest.fn();
const mockLongRender = jest.fn();

jest.unstable_mockModule('../src/lib/spinner.js', () => ({
  spinner: {
    start: mockSpinnerStart,
    stop: mockSpinnerStop
  }
}));

jest.unstable_mockModule('@fnndsc/chili/commands/store/list.js', () => ({
  store_listPlugins: mockStoreListPlugins,
  store_searchPlugins: mockStoreSearchPlugins
}));

jest.unstable_mockModule('@fnndsc/chili/views/ls.js', () => ({
  grid_render: mockGridRender,
  long_render: mockLongRender
}));

const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

const { builtin_store } = await import('../src/builtins/store.js');

describe('builtin_store', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('shows help when no subcommand provided', async () => {
    await builtin_store([]);
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Usage: store <list|search>'));
  });

  test('lists plugins successfully', async () => {
    const mockItems = [
      { name: 'pl-test-v1.0.0', type: 'plugin', size: 0, owner: 'store', date: '2024-01-01' }
    ];
    mockStoreListPlugins.mockResolvedValue(mockItems);
    mockGridRender.mockReturnValue('pl-test-v1.0.0');

    await builtin_store(['list']);

    expect(mockSpinnerStart).toHaveBeenCalled();
    expect(mockStoreListPlugins).toHaveBeenCalled();
    expect(mockSpinnerStop).toHaveBeenCalled();
    expect(mockGridRender).toHaveBeenCalledWith(mockItems);
    expect(consoleLogSpy).toHaveBeenCalledWith('pl-test-v1.0.0');
  });

  test('handles empty list results', async () => {
    mockStoreListPlugins.mockResolvedValue([]);

    await builtin_store(['list']);

    expect(consoleLogSpy).toHaveBeenCalledWith('No plugins found in store.');
  });

  test('searches plugins successfully', async () => {
    const mockItems = [
      { name: 'pl-test-v1.0.0', type: 'plugin', size: 0, owner: 'store', date: '2024-01-01' }
    ];
    mockStoreSearchPlugins.mockResolvedValue(mockItems);
    mockGridRender.mockReturnValue('pl-test-v1.0.0');

    await builtin_store(['search', 'test']);

    expect(mockSpinnerStart).toHaveBeenCalled();
    expect(mockStoreSearchPlugins).toHaveBeenCalledWith('test', { store: undefined });
    expect(mockSpinnerStop).toHaveBeenCalled();
    expect(consoleLogSpy).toHaveBeenCalledWith('pl-test-v1.0.0');
  });

  test('handles empty search results', async () => {
    mockStoreSearchPlugins.mockResolvedValue([]);

    await builtin_store(['search', 'missing']);

    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('No plugins found matching'));
  });

  test('handles missing search query', async () => {
    await builtin_store(['search']);
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Usage: store search <query>'));
  });

  test('handles errors gracefully', async () => {
    mockStoreListPlugins.mockRejectedValue(new Error('Network error'));

    await builtin_store(['list']);

    expect(mockSpinnerStop).toHaveBeenCalled();
    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Store error: Network error'));
  });

  test('uses long render with -l flag', async () => {
    const mockItems = [{ name: 'pl-test' }];
    mockStoreListPlugins.mockResolvedValue(mockItems);
    mockLongRender.mockReturnValue('long output');

    await builtin_store(['list', '-l']);

    expect(mockLongRender).toHaveBeenCalledWith(mockItems, { human: false });
    expect(consoleLogSpy).toHaveBeenCalledWith('long output');
  });
});