/**
 * Boundary-only tests for peer_search, resultDecode and plugin_executeInPlace.
 */
const mockPluginSearch = jest.fn();
const mockDecode = jest.fn();
const mockNewFeed = jest.fn();
const mockContinueFeed = jest.fn();

jest.mock('@fnndsc/cumin', () => ({
  ...jest.requireActual('@fnndsc/cumin'),
  ChRISPlugin: jest.fn().mockImplementation(() => ({ plugin_searchPeerStore: mockPluginSearch })),
  pacsQuery_resultDecode: mockDecode,
}));
jest.mock('../src/plugins/internal/plugin_executeNewFeed', () => ({ plugin_executeNewFeed: mockNewFeed }));
jest.mock('../src/plugins/internal/plugin_executeContinueFeed', () => ({ plugin_executeContinueFeed: mockContinueFeed }));

import { Ok } from '@fnndsc/cumin';
import {
  plugins_searchPeers,
  storeName_extractFromUrl,
  plugin_searchPeersByImage,
} from '../src/plugins/peer_search';
import { pacsQuery_resultDecode } from '../src/pacs/resultDecode';
import { plugin_executeInPlace } from '../src/plugins/plugin_executeInPlace';

beforeEach(() => jest.clearAllMocks());

describe('peer_search', () => {
  it('returns the first matching peer store plugin', async () => {
    mockPluginSearch.mockResolvedValue({ plugin: { name: 'pl-x' }, storeUrl: 'https://cube.chrisproject.org/api/v1/' });
    const r = await plugins_searchPeers('pl-x');
    expect(r).toEqual({
      plugin: { name: 'pl-x' },
      storeUrl: 'https://cube.chrisproject.org/api/v1/',
      storeName: 'cube.chrisproject.org',
    });
  });

  it('returns null when no store matches', async () => {
    mockPluginSearch.mockResolvedValue(null);
    expect(await plugins_searchPeers('pl-x', '1.0', ['https://a/', 'https://b/'])).toBeNull();
    expect(mockPluginSearch).toHaveBeenCalledTimes(2);
  });

  it('storeName_extractFromUrl returns the hostname, or the raw string if invalid', () => {
    expect(storeName_extractFromUrl('https://store.example.org/api/')).toBe('store.example.org');
    expect(storeName_extractFromUrl('not a url')).toBe('not a url');
  });

  it.each([
    ['fnndsc/pl-dircopy:2.1.1', 'pl-dircopy'],
    ['pl-dircopy:latest', 'pl-dircopy'],
    ['localhost:5000/pl-custom', 'pl-custom'],
  ])('plugin_searchPeersByImage extracts the plugin name from %s', async (image, expectedName) => {
    mockPluginSearch.mockResolvedValue({ plugin: {}, storeUrl: 'https://cube.chrisproject.org/api/v1/' });
    await plugin_searchPeersByImage(image);
    expect(mockPluginSearch).toHaveBeenCalledWith(expectedName, undefined, 'https://cube.chrisproject.org/api/v1/');
  });
});

describe('pacsQuery_resultDecode wrapper', () => {
  it('delegates to cumin', async () => {
    mockDecode.mockResolvedValue(Ok({ json: {} }));
    expect((await pacsQuery_resultDecode(7)).ok).toBe(true);
    expect(mockDecode).toHaveBeenCalledWith(7);
  });
});

describe('plugin_executeInPlace', () => {
  it('starts a new feed when the cwd is not in a feed', async () => {
    mockNewFeed.mockResolvedValue({ feedID: 1, pluginInstanceID: 2, pluginName: 'pl', outputPath: '/o', parentID: null });
    const r = await plugin_executeInPlace('pl', {}, {}, '/home/chris/uploads/data', ['pl-dircopy-v1.0.0']);
    expect(r?.feedID).toBe(1);
    expect(mockNewFeed).toHaveBeenCalled();
    expect(mockContinueFeed).not.toHaveBeenCalled();
  });

  it('continues the feed when the cwd is inside one', async () => {
    mockContinueFeed.mockResolvedValue({ pluginInstanceID: 9, pluginName: 'pl', outputPath: '/o', parentID: 5 });
    const r = await plugin_executeInPlace('pl', {}, {}, '/home/chris/feeds/feed_123/pl-dircopy_456/data/', []);
    expect(r?.pluginInstanceID).toBe(9);
    expect(mockContinueFeed).toHaveBeenCalled();
    expect(mockNewFeed).not.toHaveBeenCalled();
  });
});
