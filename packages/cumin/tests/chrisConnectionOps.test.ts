/**
 * @file Tests for ChRISConnection: connect/token lifecycle, context
 * switching, client creation and logout. The adapter lifecycle, config and
 * context modules are mocked at their seams; a fake storage provider holds
 * the token.
 */

jest.mock('../src/chrisapi/adapter', () => ({
  ...jest.requireActual('../src/chrisapi/adapter'),
  authToken_get: jest.fn(),
  client_create: jest.fn(),
}));
jest.mock('../src/config/config', () => ({
  config_init: jest.fn(),
  // connection_connect re-reads the global config after init; give it the
  // same shape as the per-instance fake so the token lands in /cfg/token.
  connectionConfig: {
    tokenFilepath: '/cfg/token',
    context_set: jest.fn(async () => undefined),
    chrisURL_load: jest.fn(async () => 'https://cube/api/v1/'),
  },
}));
jest.mock('../src/context/chrisContext', () => ({
  chrisContextURL_parse: jest.fn(),
  chrisContext: { current_set: jest.fn() },
  Context: {
    ChRISuser: 'user', ChRISURL: 'url', ChRISfolder: 'folder',
    ChRISfeed: 'feed', ChRISplugin: 'plugin',
  },
}));
jest.mock('../src/io/chrisIO', () => ({
  chrisIO: { storageProvider_set: jest.fn() },
}));

import { authToken_get, client_create } from '../src/chrisapi/adapter';
import { chrisContextURL_parse, chrisContext } from '../src/context/chrisContext';
import { ChRISConnection, chrisConnection_init } from '../src/connect/chrisConnection';
import { errorStack } from '../src/error/errorStack';
import { ConnectionConfig } from '../src/config/config';
import { IStorageProvider } from '../src/io/io';

const mockAuthToken: jest.Mock = authToken_get as unknown as jest.Mock;
const mockClientCreate: jest.Mock = client_create as unknown as jest.Mock;
const mockParse: jest.Mock = chrisContextURL_parse as unknown as jest.Mock;
const mockContextSet: jest.Mock = chrisContext.current_set as unknown as jest.Mock;

interface FakeStore { files: Record<string, string> }

const storage_make = (store: FakeStore): IStorageProvider => ({
  read: jest.fn(async (path: string) => {
    if (!(path in store.files)) throw new Error('ENOENT');
    return store.files[path];
  }),
  write: jest.fn(async (path: string, data: string) => { store.files[path] = data; }),
  remove: jest.fn(async (path: string) => { delete store.files[path]; }),
} as unknown as IStorageProvider);

const config_make = (): ConnectionConfig => ({
  tokenFilepath: '/cfg/token',
  context_set: jest.fn(async () => undefined),
  chrisURL_load: jest.fn(async () => 'https://cube/api/v1/'),
} as unknown as ConnectionConfig);

const connection_make = (store: FakeStore): ChRISConnection =>
  new ChRISConnection(config_make(), storage_make(store));

let logSpy: jest.SpyInstance;
let errSpy: jest.SpyInstance;
beforeEach(() => {
  jest.clearAllMocks();
  errorStack.type_clear('error');
  logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
  errSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  logSpy.mockRestore();
  errSpy.mockRestore();
});

describe('connection_connect', () => {
  it('authenticates, saves the token, and returns it', async () => {
    const store: FakeStore = { files: {} };
    const conn: ChRISConnection = connection_make(store);
    mockAuthToken.mockResolvedValue('TOKEN');
    const token: string | null = await conn.connection_connect({
      user: 'chris', password: 'pw', debug: false, url: 'https://cube/api/v1/',
    });
    expect(token).toBe('TOKEN');
    expect(mockAuthToken).toHaveBeenCalledWith('https://cube/api/v1/auth-token/', 'chris', 'pw');
    expect(store.files['/cfg/token']).toBe('TOKEN');
    expect(conn.connection_isConnected()).toBe(true);
  });

  it('returns null when no token is issued', async () => {
    const conn: ChRISConnection = connection_make({ files: {} });
    mockAuthToken.mockResolvedValue(null);
    expect(await conn.connection_connect({
      user: 'chris', password: 'pw', debug: false, url: 'https://cube/api/v1/',
    })).toBeNull();
  });

  it('rethrows auth errors in debug mode', async () => {
    const conn: ChRISConnection = connection_make({ files: {} });
    mockAuthToken.mockRejectedValue(new Error('bad credentials'));
    await expect(conn.connection_connect({
      user: 'chris', password: 'wrong', debug: true, url: 'https://cube/api/v1/',
    })).rejects.toThrow('bad credentials');
  });

  it('exits the process on auth errors outside debug mode', async () => {
    const conn: ChRISConnection = connection_make({ files: {} });
    mockAuthToken.mockRejectedValue(new Error('bad credentials'));
    const exitSpy: jest.SpyInstance = jest.spyOn(process, 'exit')
      .mockImplementation((() => { throw new Error('EXIT'); }) as never);
    await expect(conn.connection_connect({
      user: 'chris', password: 'wrong', debug: false, url: 'https://cube/api/v1/',
    })).rejects.toThrow('EXIT');
    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
  });
});

describe('token and URL access', () => {
  it('loads the token from storage on demand', async () => {
    const conn: ChRISConnection = connection_make({ files: { '/cfg/token': 'STORED' } });
    expect(await conn.authToken_get()).toBe('STORED');
  });

  it('yields null when no token is stored', async () => {
    const conn: ChRISConnection = connection_make({ files: {} });
    expect(await conn.authToken_get()).toBeNull();
    expect(conn.connection_isConnected()).toBe(false);
  });

  it('loads the ChRIS URL from config when unset', async () => {
    const conn: ChRISConnection = connection_make({ files: {} });
    expect(await conn.chrisURL_get()).toBe('https://cube/api/v1/');
  });

  it('yields null for the URL when config is uninitialized', async () => {
    const conn: ChRISConnection = new ChRISConnection();
    expect(await conn.chrisURL_get()).toBeNull();
  });
});

describe('client creation', () => {
  it('creates a client once token and URL resolve', async () => {
    const conn: ChRISConnection = connection_make({ files: { '/cfg/token': 'TOK' } });
    const fake: object = { fake: true };
    mockClientCreate.mockReturnValue(fake);
    expect(await conn.client_get()).toBe(fake);
    expect(mockClientCreate).toHaveBeenCalledWith('https://cube/api/v1/', 'TOK');
    // Second call reuses the cached client.
    expect(await conn.client_get()).toBe(fake);
    expect(mockClientCreate).toHaveBeenCalledTimes(1);
  });

  it('returns null without a stored token', async () => {
    const conn: ChRISConnection = connection_make({ files: {} });
    expect(await conn.client_get()).toBeNull();
  });

  it('refreshes the client from current context', async () => {
    const conn: ChRISConnection = connection_make({ files: { '/cfg/token': 'TOK2' } });
    const fake: object = { refreshed: true };
    mockClientCreate.mockReturnValue(fake);
    expect(await conn.client_refresh()).toBe(fake);
  });
});

describe('context_set', () => {
  it('applies user, URL and folder from a parsed context and refreshes', async () => {
    const conn: ChRISConnection = connection_make({ files: { '/cfg/token': 'T' } });
    mockParse.mockResolvedValue({
      user: 'chris', URL: 'https://cube/api/v1/', folder: '/home/chris',
      feed: null, plugin: null,
    });
    mockContextSet.mockResolvedValue(true);
    mockClientCreate.mockReturnValue({});
    expect(await conn.context_set('chris@https://cube/api/v1/?folder=/home/chris')).toBe(true);
    expect(mockContextSet).toHaveBeenCalledWith('user', 'chris');
    expect(mockContextSet).toHaveBeenCalledWith('url', 'https://cube/api/v1/');
    expect(mockContextSet).toHaveBeenCalledWith('folder', '/home/chris');
  });

  it('applies feed and plugin context values', async () => {
    const conn: ChRISConnection = connection_make({ files: {} });
    mockParse.mockResolvedValue({ user: null, URL: null, folder: null, feed: '9', plugin: '4' });
    mockContextSet.mockResolvedValue(true);
    expect(await conn.context_set('?feed=9&plugin=4')).toBe(true);
    expect(mockContextSet).toHaveBeenCalledWith('feed', '9');
    expect(mockContextSet).toHaveBeenCalledWith('plugin', '4');
  });

  it('fails fast when parsing pushed an error', async () => {
    const conn: ChRISConnection = connection_make({ files: {} });
    mockParse.mockImplementation(async () => {
      errorStack.stack_push('error', 'bad context string');
      return { user: null, URL: null, folder: null, feed: null, plugin: null };
    });
    expect(await conn.context_set('nonsense')).toBe(false);
    expect(errSpy).toHaveBeenCalled();
  });
});

describe('connection_logout', () => {
  it('clears the token from storage', async () => {
    const store: FakeStore = { files: { '/cfg/token': 'T' } };
    const conn: ChRISConnection = connection_make(store);
    await conn.authToken_get();
    await conn.connection_logout();
    expect(store.files['/cfg/token']).toBeUndefined();
    expect(conn.connection_isConnected()).toBe(false);
  });

  it('reports but survives a storage failure', async () => {
    const conn: ChRISConnection = new ChRISConnection(config_make(), {
      read: jest.fn(), write: jest.fn(),
      remove: jest.fn(async () => { throw new Error('EIO'); }),
    } as unknown as IStorageProvider);
    await conn.connection_logout();
    expect(errSpy).toHaveBeenCalledWith('Error during logout:', expect.any(Error));
  });
});

describe('chrisConnection_init', () => {
  it('initializes the global connection with the storage provider', async () => {
    const conn: ChRISConnection = await chrisConnection_init(storage_make({ files: {} }));
    expect(conn).toBeInstanceOf(ChRISConnection);
  });
});
