/**
 * Boundary-only tests for salsa plugins/index. Real errorStack; stubbed cumin
 * plugin group/instance/ChRISPlugin classes and axios.
 */
const asset = {
  resources_listAndFilterByOptions: jest.fn(),
  resources_getAll: jest.fn(),
  resourceFields_get: jest.fn(),
  resourceItem_delete: jest.fn(),
};
const mockPlugin = {
  plugin_run: jest.fn(),
  pluginIDs_resolve: jest.fn(),
  pluginData_getFromSearch: jest.fn(),
};

jest.mock('@fnndsc/cumin', () => ({
  ...jest.requireActual('@fnndsc/cumin'),
  ChRISPluginGroup: jest.fn().mockImplementation(() => ({ asset })),
  ChRISPluginInstanceGroup: jest.fn().mockImplementation(() => ({ asset })),
  ChRISPluginMetaPluginGroup: jest.fn(),
  ChRISPlugin: jest.fn().mockImplementation(() => mockPlugin),
}));
jest.mock('axios');

import axios from 'axios';
import { errorStack } from '@fnndsc/cumin';
import {
  plugins_list,
  plugins_listAll,
  pluginFields_get,
  pluginInstances_list,
  plugin_run,
  plugins_searchableToIDs,
  pluginMeta_readmeContentFetch,
  pluginReadmeDocument_fetch,
  pluginMeta_documentationUrlGet,
  pluginMeta_pluginIDFromSearch,
  plugin_delete,
  plugins_overview,
  plugin_readme,
} from '../src/plugins/index';

const mockGet = axios.get as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  errorStack.stack_clear();
});

describe('group-backed listing', () => {
  it('plugins_list / listAll / fields / delete delegate to the group asset', async () => {
    asset.resources_listAndFilterByOptions.mockResolvedValue('L');
    expect(await plugins_list({} as never)).toBe('L');

    asset.resources_getAll.mockResolvedValue('A');
    expect(await plugins_listAll()).toBe('A');

    asset.resourceFields_get.mockResolvedValue({ fields: ['id'] });
    expect(await pluginFields_get()).toEqual(['id']);
    asset.resourceFields_get.mockResolvedValue(null);
    expect(await pluginFields_get()).toBeNull();

    asset.resourceItem_delete.mockResolvedValue(true);
    expect(await plugin_delete(3)).toBe(true);
  });

  it('pluginInstances_list delegates', async () => {
    asset.resources_listAndFilterByOptions.mockResolvedValue('PI');
    expect(await pluginInstances_list({} as never)).toBe('PI');
  });
});

describe('plugin_run', () => {
  it('passes typed params directly so spaced values remain one value', async () => {
    mockPlugin.plugin_run.mockResolvedValue({ id: 1 });
    expect(await plugin_run('pl-x', { a: 1, b: 'NIfTI files' })).toEqual({ id: 1 });
    expect(mockPlugin.plugin_run).toHaveBeenCalledWith('pl-x', { a: 1, b: 'NIfTI files' });
  });
});

describe('plugins_searchableToIDs', () => {
  it('returns the hit ids', async () => {
    mockPlugin.pluginIDs_resolve.mockResolvedValue({ hits: ['1', '2'] });
    expect(await plugins_searchableToIDs('pl-x')).toEqual(['1', '2']);
  });
  it('returns null when nothing resolves', async () => {
    mockPlugin.pluginIDs_resolve.mockResolvedValue(null);
    expect(await plugins_searchableToIDs('pl-x')).toBeNull();
  });
});

describe('pluginMeta_readmeContentFetch', () => {
  it('returns the first README that responds 200', async () => {
    mockGet
      .mockRejectedValueOnce(new Error('404'))
      .mockResolvedValueOnce({ status: 200, data: '# Readme' });
    expect(await pluginMeta_readmeContentFetch('http://repo')).toBe('# Readme');
  });
  it('returns null when no README is reachable', async () => {
    mockGet.mockRejectedValue(new Error('404'));
    expect(await pluginMeta_readmeContentFetch('http://repo')).toBeNull();
  });
});

describe('pluginMeta_documentationUrlGet', () => {
  it('returns the first documentation hit', async () => {
    mockPlugin.pluginData_getFromSearch.mockResolvedValue({ hits: ['http://docs'] });
    expect(await pluginMeta_documentationUrlGet('5')).toBe('http://docs');
  });
  it('returns null when there are no hits', async () => {
    mockPlugin.pluginData_getFromSearch.mockResolvedValue({ hits: [] });
    expect(await pluginMeta_documentationUrlGet('5')).toBeNull();
  });
});

describe('pluginMeta_pluginIDFromSearch', () => {
  it('returns the id for a single unambiguous match', async () => {
    mockPlugin.pluginData_getFromSearch.mockResolvedValue({ hits: [{ id: '7', name: 'pl', version: '1' }] });
    expect(await pluginMeta_pluginIDFromSearch({ name: 'pl' })).toBe('7');
  });
  it('warns and returns null for multiple matches', async () => {
    mockPlugin.pluginData_getFromSearch.mockResolvedValue({
      hits: [{ id: '7', name: 'pl', version: '1' }, { id: '8', name: 'pl', version: '2' }],
    });
    expect(await pluginMeta_pluginIDFromSearch({ search: 'pl' })).toBeNull();
    expect(errorStack.stack_search('Multiple plugins found').length).toBeGreaterThan(0);
  });
  it('returns null for no matches', async () => {
    mockPlugin.pluginData_getFromSearch.mockResolvedValue({ hits: [] });
    expect(await pluginMeta_pluginIDFromSearch({ name: 'pl' })).toBeNull();
  });
});

describe('misc', () => {
  it('plugins_overview resolves', async () => {
    await expect(plugins_overview()).resolves.toBeUndefined();
  });

  it('plugin_readme retains its string compatibility wrapper', async () => {
    mockPlugin.pluginData_getFromSearch.mockResolvedValue({ hits: [{ public_repo: 'http://repo' }] });
    mockGet.mockResolvedValue({ status: 200, data: 'README' });
    expect(await plugin_readme('5')).toBe('README');
  });

  it('pluginReadmeDocument_fetch prefers public_repo and preserves RST format', async () => {
    mockPlugin.pluginData_getFromSearch.mockResolvedValue({
      hits: [{
        public_repo: 'https://github.com/FNNDSC/pl-pfdo_med2img',
        documentation: 'http://wiki',
      }],
    });
    mockGet
      .mockRejectedValueOnce(new Error('404'))
      .mockResolvedValueOnce({ status: 200, data: 'pfdo_med2img\n============' });

    expect(await pluginReadmeDocument_fetch('270')).toEqual({
      content: 'pfdo_med2img\n============',
      format: 'rst',
      sourceUrl: 'https://github.com/FNNDSC/pl-pfdo_med2img/raw/master/README.rst',
    });
    expect(mockPlugin.pluginData_getFromSearch).toHaveBeenCalledWith(
      { search: 'id: 270' },
      ['public_repo', 'documentation'],
    );
    expect(mockGet).not.toHaveBeenCalledWith(expect.stringContaining('http://wiki'));
  });

  it('plugin_readme returns null when no doc url', async () => {
    mockPlugin.pluginData_getFromSearch.mockResolvedValue({ hits: [] });
    expect(await plugin_readme('5')).toBeNull();
  });
});
