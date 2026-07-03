/**
 * @file Tests for peer-store plugin import: field sanitization, parameter
 * fetching/transformation, admin auth detection. Cumin mocked at its
 * boundary, the peer store at global fetch.
 */

let mockClientGet: jest.Mock;
let mockRegisterWithAdmin: jest.Mock;
let mockGetAuthToken: jest.Mock;
let mockStackPush: jest.Mock;
let mockErrorsGet: jest.Mock;

jest.mock('@fnndsc/cumin', () => ({
  ChRISPlugin: class {
    client_get(): Promise<unknown> { return mockClientGet(); }
    plugin_registerWithAdmin(...args: unknown[]): Promise<unknown> { return mockRegisterWithAdmin(...args); }
  },
  Client: class {
    static getAuthToken(...args: unknown[]): Promise<unknown> { return mockGetAuthToken(...args); }
  },
  errorStack: {
    stack_push: (...args: unknown[]): unknown => mockStackPush(...args),
    allOfType_get: (...args: unknown[]): unknown => mockErrorsGet(...args),
  },
  Ok: <T>(value: T): { ok: true; value: T } => ({ ok: true, value }),
  Err: (): { ok: false } => ({ ok: false }),
}));

import { plugin_importFromStore, storeImport_isSupported } from '../src/plugins/store_import';

const mockFetch: jest.Mock = jest.fn();

const paramsCollection = {
  collection: {
    version: '1.0',
    href: 'h',
    items: [{
      href: 'https://store/params/1/',
      data: [
        { name: 'id', value: 77 },
        { name: 'plugin', value: 'x' },
        { name: 'name', value: 'dir' },
        { name: 'type', value: 'string' },
      ],
    }],
  },
};

let logSpy: jest.SpyInstance;
beforeEach(() => {
  jest.clearAllMocks();
  mockClientGet = jest.fn();
  mockRegisterWithAdmin = jest.fn();
  mockGetAuthToken = jest.fn();
  mockStackPush = jest.fn();
  mockErrorsGet = jest.fn(() => []);
  global.fetch = mockFetch as unknown as typeof fetch;
  logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
});
afterEach(() => {
  logSpy.mockRestore();
});

describe('plugin_importFromStore', () => {
  it('sanitizes fields, fetches parameters from links, and registers', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => paramsCollection });
    mockRegisterWithAdmin.mockResolvedValue({ name: 'pl-x', id: 4 });

    const result = await plugin_importFromStore('https://store/plugins/1/', {
      name: 'pl-x',
      dock_image: 'org/pl-x',
      id: 99,
      stars: 12,
      links: [{ rel: 'parameters', href: 'https://store/plugins/1/parameters/' }],
    }, ['host']);

    expect(result.success).toBe(true);
    const [sanitized] = mockRegisterWithAdmin.mock.calls[0] as [Record<string, unknown>];
    expect(sanitized.name).toBe('pl-x');
    expect(sanitized.id).toBeUndefined();
    expect(sanitized.stars).toBeUndefined();
    const params = sanitized.parameters as Array<Record<string, unknown>>;
    expect(params[0]).toEqual({ name: 'dir', type: 'str' });
  });

  it('proceeds without parameters when the fetch fails', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500 });
    mockRegisterWithAdmin.mockResolvedValue({ name: 'pl-x' });
    const result = await plugin_importFromStore('u', {
      name: 'pl-x',
      links: [{ rel: 'parameters', href: 'https://store/p/' }],
    });
    expect(result.success).toBe(true);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Failed to fetch parameters'));
  });

  it('acquires an admin token from credentials', async () => {
    mockClientGet.mockResolvedValue({ url: 'https://cube/api/v1/' });
    mockGetAuthToken.mockResolvedValue('TOK');
    mockRegisterWithAdmin.mockResolvedValue({ name: 'pl-x' });
    await plugin_importFromStore('u', { name: 'pl-x' }, ['host'], { username: 'a', password: 'p' });
    expect(mockRegisterWithAdmin).toHaveBeenCalledWith(expect.anything(), ['host'], 'TOK');
  });

  it('warns when the admin token request fails', async () => {
    mockClientGet.mockResolvedValue({ url: 'https://cube/api/v1/' });
    mockGetAuthToken.mockRejectedValue(new Error('401'));
    mockRegisterWithAdmin.mockResolvedValue({ name: 'pl-x' });
    await plugin_importFromStore('u', { name: 'pl-x' }, ['host'], { username: 'a', password: 'bad' });
    expect(mockStackPush).toHaveBeenCalledWith('warning', expect.stringContaining('Failed to get admin token'));
  });

  it('flags an auth failure as requiresAuth', async () => {
    mockRegisterWithAdmin.mockResolvedValue(null);
    mockErrorsGet.mockReturnValue(['Admin credentials required to register plugins.']);
    const result = await plugin_importFromStore('u', { name: 'pl-x' });
    expect(result).toMatchObject({ success: false, requiresAuth: true });
  });

  it('reports a generic failure otherwise', async () => {
    mockRegisterWithAdmin.mockResolvedValue(null);
    mockErrorsGet.mockReturnValue(['server exploded']);
    const result = await plugin_importFromStore('u', { name: 'pl-x' });
    expect(result).toMatchObject({ success: false });
    expect(result.requiresAuth).toBeUndefined();
  });
});

describe('storeImport_isSupported', () => {
  it('is currently unsupported', async () => {
    expect(await storeImport_isSupported()).toBe(false);
  });
});
