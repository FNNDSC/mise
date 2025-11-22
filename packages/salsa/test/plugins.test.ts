import {
  plugin_run,
  plugins_searchableToIDs,
  pluginMeta_readmeContentFetch,
  pluginMeta_documentationUrlGet,
  pluginMeta_pluginIDFromSearch,
  PluginSearchOptions
} from '../src/plugins/index';
import { ChRISPlugin, QueryHits } from '@fnndsc/cumin';
import axios from 'axios';

jest.mock('@fnndsc/cumin');
jest.mock('axios');

describe('plugins', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('plugin_run should call ChRISPlugin.plugin_run', async () => {
    const mockPluginRun = jest.fn().mockResolvedValue({ id: 'plugin-instance-1' });
    (ChRISPlugin as jest.Mock).mockImplementation(() => ({
      plugin_run: mockPluginRun,
      pluginIDs_resolve: jest.fn(),
      pluginData_getFromSearch: jest.fn()
    }));

    const searchable = 'test-plugin';
    const parameters = { someKey: 'someValue' };
    const result = await plugin_run(searchable, parameters);

    expect(ChRISPlugin).toHaveBeenCalledTimes(1);
    expect(mockPluginRun).toHaveBeenCalledWith(searchable, JSON.stringify(parameters));
    expect(result).toEqual({ id: 'plugin-instance-1' });
  });

  it('plugins_searchableToIDs should call ChRISPlugin.pluginIDs_resolve', async () => {
    const mockResolve = jest.fn().mockResolvedValue({ hits: ['plugin-id-1', 'plugin-id-2'] } as QueryHits);
    (ChRISPlugin as jest.Mock).mockImplementation(() => ({
      pluginIDs_resolve: mockResolve,
      plugin_run: jest.fn(),
      pluginData_getFromSearch: jest.fn()
    }));

    const searchable = 'another-plugin';
    const result = await plugins_searchableToIDs(searchable);

    expect(ChRISPlugin).toHaveBeenCalledTimes(1);
    expect(mockResolve).toHaveBeenCalledWith(searchable);
    expect(result).toEqual(['plugin-id-1', 'plugin-id-2']);
  });

  it('pluginMeta_readmeContentFetch should fetch readme from master branch', async () => {
    const mockAxiosGet = jest.fn().mockResolvedValueOnce({ status: 200, data: 'README from master' });
    (axios.get as jest.Mock).mockImplementation(mockAxiosGet);

    const repoUrl = 'http://example.com/repo';
    const result = await pluginMeta_readmeContentFetch(repoUrl);

    expect(mockAxiosGet).toHaveBeenCalledWith('http://example.com/repo/raw/master/README.md');
    expect(result).toBe('README from master');
  });

  it('pluginMeta_readmeContentFetch should try main branch if master fails', async () => {
    const mockAxiosGet = jest.fn()
      .mockRejectedValueOnce(new Error('404')) // master/README.md
      .mockRejectedValueOnce(new Error('404')) // master/README.rst
      .mockResolvedValueOnce({ status: 200, data: 'README from main' }); // main/README.md
    (axios.get as jest.Mock).mockImplementation(mockAxiosGet);

    const repoUrl = 'http://example.com/repo';
    const result = await pluginMeta_readmeContentFetch(repoUrl);

    expect(mockAxiosGet).toHaveBeenCalledWith('http://example.com/repo/raw/master/README.md'); // First try
    expect(mockAxiosGet).toHaveBeenCalledWith('http://example.com/repo/raw/main/README.md'); // Third try
    expect(result).toBe('README from main');
  });

  it('pluginMeta_documentationUrlGet should call ChRISPlugin.pluginData_getFromSearch', async () => {
    const mockGetData = jest.fn().mockResolvedValue({ hits: ['http://example.com/docs'] } as QueryHits);
    (ChRISPlugin as jest.Mock).mockImplementation(() => ({
      pluginData_getFromSearch: mockGetData,
      plugin_run: jest.fn(),
      pluginIDs_resolve: jest.fn()
    }));

    const pluginId = 'some-plugin-id';
    const result = await pluginMeta_documentationUrlGet(pluginId);

    expect(ChRISPlugin).toHaveBeenCalledTimes(1);
    expect(mockGetData).toHaveBeenCalledWith({ search: 'id: some-plugin-id' }, 'documentation');
    expect(result).toBe('http://example.com/docs');
  });

  it('pluginMeta_pluginIDFromSearch should return ID for single match', async () => {
    const mockGetData = jest.fn().mockResolvedValue({ hits: ['single-id'] } as QueryHits);
    (ChRISPlugin as jest.Mock).mockImplementation(() => ({
      pluginData_getFromSearch: mockGetData,
      plugin_run: jest.fn(),
      pluginIDs_resolve: jest.fn()
    }));

    const options: PluginSearchOptions = { name: 'unique-plugin' };
    const result = await pluginMeta_pluginIDFromSearch(options);

    expect(mockGetData).toHaveBeenCalledWith(options, 'id');
    expect(result).toBe('single-id');
  });

  it('pluginMeta_pluginIDFromSearch should return null for multiple matches', async () => {
    const mockGetData = jest.fn().mockResolvedValue({ hits: ['id-1', 'id-2'] } as QueryHits);
    (ChRISPlugin as jest.Mock).mockImplementation(() => ({
      pluginData_getFromSearch: mockGetData,
      plugin_run: jest.fn(),
      pluginIDs_resolve: jest.fn()
    }));

    const options: PluginSearchOptions = { name: 'ambiguous-plugin' };
    const result = await pluginMeta_pluginIDFromSearch(options);

    expect(mockGetData).toHaveBeenCalledWith(options, 'id');
    expect(result).toBeNull();
  });

  it('pluginMeta_pluginIDFromSearch should return null for no matches', async () => {
    const mockGetData = jest.fn().mockResolvedValue({ hits: [] } as QueryHits);
    (ChRISPlugin as jest.Mock).mockImplementation(() => ({
      pluginData_getFromSearch: mockGetData,
      plugin_run: jest.fn(),
      pluginIDs_resolve: jest.fn()
    }));

    const options: PluginSearchOptions = { name: 'nonexistent-plugin' };
    const result = await pluginMeta_pluginIDFromSearch(options);

    expect(mockGetData).toHaveBeenCalledWith(options, 'id');
    expect(result).toBeNull();
  });
});
