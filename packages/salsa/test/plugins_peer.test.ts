import { plugins_searchPeers, plugin_searchPeersByImage } from '../src/plugins/peer_search.js';
import { plugin_importFromStore, PluginImportResult } from '../src/plugins/store_import.js';
import { ChRISPlugin } from '@fnndsc/cumin';

// Create specific mock functions we can control and spy on
const mockPlugin_searchPeerStore = jest.fn();
const mockPlugin_registerWithAdmin = jest.fn();
const mockClient_get = jest.fn().mockResolvedValue({ url: 'http://mock-cube/' });

// Mock ChRISPlugin constructor to return our mock methods
jest.mock('@fnndsc/cumin', () => {
  return {
    ChRISPlugin: jest.fn().mockImplementation(() => ({
      plugin_searchPeerStore: mockPlugin_searchPeerStore,
      plugin_registerWithAdmin: mockPlugin_registerWithAdmin,
      client_get: mockClient_get,
    })),
    errorStack: {
      allOfType_get: jest.fn().mockReturnValue([]),
      stack_push: jest.fn(),
    },
    Client: {
      getAuthToken: jest.fn().mockResolvedValue('mock-admin-token'),
    },
  };
});

// Mock global fetch
global.fetch = jest.fn();

describe('Peer Search', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('plugins_searchPeers finds plugin', async () => {
    const mockPlugin = { name: 'pl-dircopy', id: 1 };
    mockPlugin_searchPeerStore.mockResolvedValue({
      plugin: mockPlugin,
      storeUrl: 'http://store/api/v1/plugins/1/',
    });

    const result = await plugins_searchPeers('pl-dircopy');
    
    expect(result).not.toBeNull();
    expect(result?.plugin).toEqual(mockPlugin);
    expect(result?.storeUrl).toBe('http://store/api/v1/plugins/1/');
  });

  test('plugins_searchPeers returns null if not found', async () => {
    mockPlugin_searchPeerStore.mockResolvedValue(null);

    const result = await plugins_searchPeers('pl-nonexistent');
    
    expect(result).toBeNull();
  });

  test('plugin_searchPeersByImage extracts name and searches', async () => {
    const mockPlugin = { name: 'pl-dircopy', id: 1 };
    mockPlugin_searchPeerStore.mockResolvedValue({
      plugin: mockPlugin,
      storeUrl: 'http://store/api/v1/plugins/1/',
    });

    const result = await plugin_searchPeersByImage('fnndsc/pl-dircopy:2.1.1');
    
    expect(result).not.toBeNull();
    expect(mockPlugin_searchPeerStore).toHaveBeenCalledWith(
      'pl-dircopy',
      undefined,
      expect.any(String)
    );
  });
});

describe('Store Import', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('plugin_importFromStore success', async () => {
    const pluginData = { name: 'pl-dircopy' };
    const computeResources = ['host'];
    
    mockPlugin_registerWithAdmin.mockResolvedValue({
      name: 'pl-dircopy',
      id: 1
    });

    const result: PluginImportResult = await plugin_importFromStore(
      'http://store/1',
      pluginData,
      computeResources
    );

    expect(result.success).toBe(true);
    expect(result.plugin).toBeDefined();
  });

  test('plugin_importFromStore with admin creds', async () => {
    const pluginData = { name: 'pl-dircopy' };
    const adminCreds = { username: 'admin', password: 'pw' };
    
    mockPlugin_registerWithAdmin.mockResolvedValue({
      name: 'pl-dircopy',
      id: 1
    });

    await plugin_importFromStore(
      'http://store/1',
      pluginData,
      ['host'],
      adminCreds
    );

    // Should have attempted to register with admin token
    expect(mockPlugin_registerWithAdmin).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'pl-dircopy' }),
      ['host'],
      'mock-admin-token'
    );
  });
});
