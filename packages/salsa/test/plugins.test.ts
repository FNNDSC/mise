import {
  plugin_run,
  plugins_searchableToIDs,
  pluginMeta_readmeContentFetch,
  pluginMeta_documentationUrlGet,
  pluginMeta_pluginIDFromSearch,
  plugin_register,
  pluginInstances_list,
  PluginSearchOptions
} from '../src/plugins/index';
import { ChRISPlugin, QueryHits, chrisConnection, ChRISPluginInstanceGroup } from '@fnndsc/cumin';
import * as cumin from '@fnndsc/cumin';
import axios from 'axios';

jest.mock('@fnndsc/cumin', () => {
  const Ok = (val: any) => ({ ok: true, value: val });
  const Err = (err?: any) => ({ ok: false, error: err });
  return {
    chrisConnection: {
      client_get: jest.fn()
    },
    ChRISPlugin: jest.fn(),
    ChRISPluginInstanceGroup: jest.fn(),
    QueryHits: jest.fn(),
    plugin_registerDirect: jest.fn(),
    errorStack: {
      stack_push: jest.fn(),
    },
    Ok,
    Err
  };
});
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
    expect(mockPluginRun).toHaveBeenCalledWith(searchable, '--someKey someValue');
    expect(result).toEqual({ id: 'plugin-instance-1' });
  });

  it('plugin_register should register a plugin', async () => {
    const pluginData = { name: 'test-plugin', dock_image: 'test/image' };
    const computeResources = ['host1'];

    // Mock plugin_registerDirect to return success
    (cumin.plugin_registerDirect as jest.Mock).mockResolvedValue({
      ok: true,
      value: { name: 'test-plugin', id: 1 }
    });

    const result = await plugin_register(pluginData, computeResources);

    expect(cumin.plugin_registerDirect).toHaveBeenCalledWith(pluginData, computeResources);
    expect(result).toEqual({ name: 'test-plugin', id: 1 });
  });

  it('plugin_register should return null on error', async () => {
    const pluginData = { name: 'test-plugin', dock_image: 'test/image' };

    // Mock plugin_registerDirect to return error
    (cumin.plugin_registerDirect as jest.Mock).mockResolvedValue({
      ok: false,
      error: 'Registration failed'
    });

    const result = await plugin_register(pluginData);

    expect(cumin.plugin_registerDirect).toHaveBeenCalledWith(pluginData, undefined);
    expect(result).toBeNull();
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
    const mockGetData = jest.fn().mockResolvedValue({ hits: [{id: 'single-id', name: 'unique-plugin', version: '1.0.0'}] } as QueryHits);
    (ChRISPlugin as jest.Mock).mockImplementation(() => ({
      pluginData_getFromSearch: mockGetData,
      plugin_run: jest.fn(),
      pluginIDs_resolve: jest.fn()
    }));

    const options: PluginSearchOptions = { name: 'unique-plugin' };
    const result = await pluginMeta_pluginIDFromSearch(options);

    expect(mockGetData).toHaveBeenCalledWith(options, ['id', 'name', 'version']);
    expect(result).toBe('single-id');
  });

  it('pluginMeta_pluginIDFromSearch should return null for multiple matches', async () => {
    const mockGetData = jest.fn().mockResolvedValue({ hits: [
      { id: 'id-1', name: 'ambiguous-plugin', version: '1.0.0' },
      { id: 'id-2', name: 'ambiguous-plugin', version: '1.0.1' }
    ] } as QueryHits);
    (ChRISPlugin as jest.Mock).mockImplementation(() => ({
      pluginData_getFromSearch: mockGetData,
      plugin_run: jest.fn(),
      pluginIDs_resolve: jest.fn()
    }));

    const options: PluginSearchOptions = { name: 'ambiguous-plugin' };
    const result = await pluginMeta_pluginIDFromSearch(options);

    expect(mockGetData).toHaveBeenCalledWith(options, ['id', 'name', 'version']);
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

    expect(mockGetData).toHaveBeenCalledWith(options, ['id', 'name', 'version']);
    expect(result).toBeNull();
  });

  it('pluginInstances_list should call ChRISPluginInstanceGroup.resources_listAndFilterByOptions', async () => {
    const mockFilteredData = {
      tableData: [
        { id: 123, plugin_name: 'pl-dircopy', plugin_version: '2.1.2', status: 'finishedSuccessfully' }
      ],
      count: 1,
      limit: 1,
      offset: 0
    };
    const mockListAndFilter = jest.fn().mockResolvedValue(mockFilteredData);

    (ChRISPluginInstanceGroup as jest.Mock).mockImplementation(() => ({
      asset: {
        resources_listAndFilterByOptions: mockListAndFilter
      }
    }));

    const options = { id: 123, limit: 1 };
    const result = await pluginInstances_list(options);

    expect(ChRISPluginInstanceGroup).toHaveBeenCalledTimes(1);
    expect(mockListAndFilter).toHaveBeenCalledWith(options);
    expect(result).toEqual(mockFilteredData);
  });

  it('pluginInstances_list should return null when no instances found', async () => {
    const mockListAndFilter = jest.fn().mockResolvedValue(null);

    (ChRISPluginInstanceGroup as jest.Mock).mockImplementation(() => ({
      asset: {
        resources_listAndFilterByOptions: mockListAndFilter
      }
    }));

    const result = await pluginInstances_list({ id: 999 });

    expect(mockListAndFilter).toHaveBeenCalledWith({ id: 999 });
    expect(result).toBeNull();
  });

  it('pluginInstances_list should handle multiple instances', async () => {
    const mockFilteredData = {
      tableData: [
        { id: 123, plugin_name: 'pl-dircopy', plugin_version: '2.1.2' },
        { id: 124, plugin_name: 'pl-dircopy', plugin_version: '2.1.2' }
      ],
      count: 2,
      limit: 10,
      offset: 0
    };
    const mockListAndFilter = jest.fn().mockResolvedValue(mockFilteredData);

    (ChRISPluginInstanceGroup as jest.Mock).mockImplementation(() => ({
      asset: {
        resources_listAndFilterByOptions: mockListAndFilter
      }
    }));

    const options = { plugin_name: 'pl-dircopy', limit: 10 };
    const result = await pluginInstances_list(options);

    expect(mockListAndFilter).toHaveBeenCalledWith(options);
    expect(result?.tableData).toHaveLength(2);
  });
});
