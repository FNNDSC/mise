/**
 * @file Tests for plugin search, registration and peer-store access.
 * Connection mocked at the client boundary, admin client creation at the
 * adapter seam, and the peer store at global fetch.
 */

jest.mock('../src/connect/chrisConnection', () => ({
  chrisConnection: { client_get: jest.fn(), chrisURL_get: jest.fn() },
}));
jest.mock('../src/chrisapi/adapter', () => ({
  ...jest.requireActual('../src/chrisapi/adapter'),
  client_create: jest.fn(),
}));

import { chrisConnection } from '../src/connect/chrisConnection';
import { client_create } from '../src/chrisapi/adapter';
import { ChRISPlugin, plugin_registerDirect } from '../src/plugins/chrisPlugins';
import { errorStack } from '../src/error/errorStack';
import { listResource_make } from './fixtures';

const mockClientGet: jest.Mock = chrisConnection.client_get as unknown as jest.Mock;
const mockUrlGet: jest.Mock = chrisConnection.chrisURL_get as unknown as jest.Mock;
const mockClientCreate: jest.Mock = client_create as unknown as jest.Mock;
const mockFetch: jest.Mock = jest.fn();

interface CollectionItemFixture {
  data: Array<{ name: string; value: unknown }>;
  href: string;
  links: Array<{ rel: string; href: string }>;
}

const cjItem = (fields: Record<string, unknown>, href: string): CollectionItemFixture => ({
  data: Object.entries(fields).map(([name, value]: [string, unknown]) => ({ name, value })),
  href,
  links: [],
});
const cjBody = (
  items: CollectionItemFixture[],
  links: Array<{ rel: string; href: string }> = [],
): unknown => ({ collection: { version: '1.0', href: 'h', items, links } });
const fetchOk = (body: unknown): { ok: true; status: number; statusText: string; json: () => Promise<unknown> } =>
  ({ ok: true, status: 200, statusText: 'OK', json: async () => body });

let pushSpy: jest.SpyInstance;
beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = mockFetch as unknown as typeof fetch;
  pushSpy = jest.spyOn(errorStack, 'stack_push').mockImplementation(() => undefined);
});
afterEach(() => {
  pushSpy.mockRestore();
});

describe('ChRISPlugin.pluginIDs_get', () => {
  it('resolves plugin ids through the resource spine', async () => {
    mockClientGet.mockResolvedValue({
      getPlugins: jest.fn(async () => listResource_make([{ id: 17, name: 'pl-dircopy' }], 'plugins')),
    });
    const hits = await new ChRISPlugin().pluginIDs_get('pl-dircopy');
    expect(hits?.hits).toEqual([17]);
  });
});

describe('ChRISPlugin.plugin_runOnCUBE and pluginInstance_toDict', () => {
  it('creates a plugin instance with the previous id merged in', async () => {
    const createPluginInstance = jest.fn(async () => ({ ok: true }));
    mockClientGet.mockResolvedValue({ createPluginInstance });
    const instance = await new ChRISPlugin().plugin_runOnCUBE(17, 4, { title: 'run' });
    expect(instance).toEqual({ ok: true });
    expect(createPluginInstance).toHaveBeenCalledWith(17, { title: 'run', previous_id: 4 });
  });

  it('reports a failed instance creation', async () => {
    mockClientGet.mockResolvedValue({ createPluginInstance: jest.fn(async () => null) });
    expect(await new ChRISPlugin().plugin_runOnCUBE(17, 4, {})).toBeNull();
    expect(pushSpy).toHaveBeenCalledWith('error', 'Failed to create plugin instance');
  });

  it('converts a plugin instance collection to a dictionary', async () => {
    const instance = {
      collection: {
        items: [{
          data: [{ name: 'id', value: 33 }, { name: 'status', value: 'started' }],
          href: 'https://cube/api/v1/plugins/instances/33/',
          links: [],
        }],
      },
    };
    const dict = new ChRISPlugin().pluginInstance_toDict(instance as never);
    expect(dict).toEqual({ id: 33, status: 'started' });
  });

  it('returns null for a missing instance', () => {
    expect(new ChRISPlugin().pluginInstance_toDict(null)).toBeNull();
  });
});

describe('ChRISPlugin.plugin_existsInCube', () => {
  it('finds a plugin by exact name', async () => {
    mockClientGet.mockResolvedValue({
      getPlugins: jest.fn(async () => ({ data: [{ id: 1, name: 'pl-x' }] })),
    });
    expect(await new ChRISPlugin().plugin_existsInCube('pl-x')).toMatchObject({ id: 1 });
  });

  it('falls back to a dock_image search', async () => {
    const getPlugins = jest.fn(async (params: { name_exact?: string }) =>
      params.name_exact ? { data: [] } : { data: [{ id: 2, dock_image: 'org/pl-x' }] },
    );
    mockClientGet.mockResolvedValue({ getPlugins });
    expect(await new ChRISPlugin().plugin_existsInCube('org/pl-x')).toMatchObject({ id: 2 });
    expect(getPlugins).toHaveBeenCalledTimes(2);
  });

  it('returns null when nothing matches or the search throws', async () => {
    mockClientGet.mockResolvedValue({ getPlugins: jest.fn(async () => ({ data: [] })) });
    expect(await new ChRISPlugin().plugin_existsInCube('ghost')).toBeNull();

    mockClientGet.mockResolvedValue({ getPlugins: jest.fn(async () => { throw new Error('x'); }) });
    expect(await new ChRISPlugin().plugin_existsInCube('ghost')).toBeNull();
  });
});

describe('ChRISPlugin.plugin_getComputeResources', () => {
  it('lists the compute resource names for a plugin', async () => {
    mockClientGet.mockResolvedValue({
      getPlugin: jest.fn(async () => ({
        getPluginComputeResources: jest.fn(async () => ({ data: [{ name: 'host' }, { name: 'gpu' }] })),
      })),
    });
    expect(await new ChRISPlugin().plugin_getComputeResources(17)).toEqual(['host', 'gpu']);
  });

  it('returns [] for a missing plugin or error', async () => {
    mockClientGet.mockResolvedValue({ getPlugin: jest.fn(async () => null) });
    expect(await new ChRISPlugin().plugin_getComputeResources(17)).toEqual([]);
  });
});

describe('ChRISPlugin.plugin_registerWithAdmin', () => {
  const descriptor: Record<string, unknown> = { name: 'pl-new', dock_image: 'org/pl-new' };

  it('registers via an explicit admin token', async () => {
    mockUrlGet.mockResolvedValue('https://cube/api/v1/');
    const adminUploadPlugin = jest.fn(async () => ({ data: { id: 9, name: 'pl-new' } }));
    mockClientCreate.mockReturnValue({ adminUrl: 'https://cube/chris-admin/api/v1/', adminUploadPlugin });
    const created = await new ChRISPlugin().plugin_registerWithAdmin(descriptor, ['host', 'gpu'], 'ADMIN');
    expect(created).toMatchObject({ id: 9 });
    expect(mockClientCreate).toHaveBeenCalledWith('https://cube/api/v1/', 'ADMIN');
    expect(adminUploadPlugin).toHaveBeenCalledWith({ compute_names: 'host,gpu' }, expect.anything());
  });

  it('registers via the session client when no token is given', async () => {
    mockClientGet.mockResolvedValue({
      adminUrl: 'https://cube/chris-admin/api/v1/',
      adminUploadPlugin: jest.fn(async () => ({ data: { id: 10 } })),
    });
    expect(await new ChRISPlugin().plugin_registerWithAdmin(descriptor)).toMatchObject({ id: 10 });
  });

  it('fails when the user has no admin URL', async () => {
    mockClientGet.mockResolvedValue({ setUrls: jest.fn(async () => undefined) });
    expect(await new ChRISPlugin().plugin_registerWithAdmin(descriptor)).toBeNull();
    expect(pushSpy).toHaveBeenCalledWith('error', expect.stringContaining('Admin credentials required'));
  });

  it('maps a 403 into an admin-credentials error', async () => {
    mockClientGet.mockResolvedValue({
      adminUrl: 'x',
      adminUploadPlugin: jest.fn(async () => { throw new Error('403 Forbidden'); }),
    });
    expect(await new ChRISPlugin().plugin_registerWithAdmin(descriptor)).toBeNull();
    expect(pushSpy).toHaveBeenCalledWith('error', expect.stringContaining('Admin credentials required'));
  });

  it('fails when the admin token is given but no URL is known', async () => {
    mockUrlGet.mockResolvedValue(null);
    expect(await new ChRISPlugin().plugin_registerWithAdmin(descriptor, ['host'], 'ADMIN')).toBeNull();
  });
});

describe('ChRISPlugin peer store', () => {
  it('searches a peer store and selects the exact name+version match', async () => {
    mockFetch.mockResolvedValue(fetchOk(cjBody([
      cjItem({ name: 'pl-x', version: '1.0' }, 'https://store/api/v1/plugins/1/'),
      cjItem({ name: 'pl-x', version: '2.0' }, 'https://store/api/v1/plugins/2/'),
    ])));
    const found = await new ChRISPlugin().plugin_searchPeerStore('pl-x', '2.0');
    expect(found?.plugin).toMatchObject({ name: 'pl-x', version: '2.0' });
    expect(found?.storeUrl).toBe('https://store/api/v1/plugins/2/');
  });

  it('handles a plain results-array response', async () => {
    mockFetch.mockResolvedValue(fetchOk({ results: [{ id: 5, name: 'pl-y', url: 'https://store/p/5/' }] }));
    const found = await new ChRISPlugin().plugin_searchPeerStore('pl-y');
    expect(found?.storeUrl).toBe('https://store/p/5/');
  });

  it('returns null on empty results or a failed response', async () => {
    mockFetch.mockResolvedValue(fetchOk(cjBody([])));
    expect(await new ChRISPlugin().plugin_searchPeerStore('ghost')).toBeNull();

    mockFetch.mockResolvedValue({ ok: false, status: 500, statusText: 'ISE', json: async () => ({}) });
    expect(await new ChRISPlugin().plugin_searchPeerStore('ghost')).toBeNull();
  });

  it('lists a peer store across pagination links', async () => {
    mockFetch
      .mockResolvedValueOnce(fetchOk(cjBody(
        [cjItem({ name: 'pl-a' }, 'https://store/p/1/')],
        [{ rel: 'next', href: 'https://store/api/v1/plugins/?offset=100' }],
      )))
      .mockResolvedValueOnce(fetchOk(cjBody([cjItem({ name: 'pl-b' }, 'https://store/p/2/')])));
    const plugins = await new ChRISPlugin().plugin_listPeerStore();
    expect(plugins?.map(p => p.name)).toEqual(['pl-a', 'pl-b']);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('returns null when the peer store listing fails', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 502, statusText: 'Bad Gateway', json: async () => ({}) });
    expect(await new ChRISPlugin().plugin_listPeerStore()).toBeNull();
  });
});

describe('plugin_registerDirect', () => {
  it('registers through the legacy list _post', async () => {
    const _post = jest.fn(async () => ({ data: { id: 12, name: 'pl-new' } }));
    mockClientGet.mockResolvedValue({ getPlugins: jest.fn(async () => ({ _post })) });
    const result = await plugin_registerDirect({ name: 'pl-new' }, ['host']);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toMatchObject({ id: 12 });
    expect(_post).toHaveBeenCalledWith({ name: 'pl-new', compute_resources: ['host'] });
  });

  it('errors when the response has no data', async () => {
    mockClientGet.mockResolvedValue({
      getPlugins: jest.fn(async () => ({ _post: jest.fn(async () => ({})) })),
    });
    expect((await plugin_registerDirect({ name: 'pl-new' })).ok).toBe(false);
  });

  it('errors when not connected or the post throws', async () => {
    mockClientGet.mockResolvedValue(null);
    expect((await plugin_registerDirect({})).ok).toBe(false);

    mockClientGet.mockResolvedValue({
      getPlugins: jest.fn(async () => ({ _post: jest.fn(async () => { throw new Error('410'); }) })),
    });
    expect((await plugin_registerDirect({})).ok).toBe(false);
  });
});
