/**
 * @file Tests for plugin registration flows, mocked at the cumin boundary.
 */

let mockClientGet: jest.Mock;
let mockRegisterWithAdmin: jest.Mock;
let mockExistsInCube: jest.Mock;
let mockGetComputeResources: jest.Mock;
let mockGetAuthToken: jest.Mock;
let mockRegisterDirect: jest.Mock;
let mockStackPush: jest.Mock;

jest.mock('@fnndsc/cumin', () => ({
  ChRISPlugin: class {
    client_get(): Promise<unknown> { return mockClientGet(); }
    plugin_registerWithAdmin(...args: unknown[]): Promise<unknown> { return mockRegisterWithAdmin(...args); }
    plugin_existsInCube(...args: unknown[]): Promise<unknown> { return mockExistsInCube(...args); }
    plugin_getComputeResources(...args: unknown[]): Promise<unknown> { return mockGetComputeResources(...args); }
  },
  Client: class {
    static getAuthToken(...args: unknown[]): Promise<unknown> { return mockGetAuthToken(...args); }
  },
  errorStack: { stack_push: (...args: unknown[]): unknown => mockStackPush(...args) },
  plugin_registerDirect: (...args: unknown[]): Promise<unknown> => mockRegisterDirect(...args),
}));

import {
  plugin_register,
  plugin_registerWithAdmin,
  plugin_checkExists,
  plugin_assignToComputeResources,
  PluginRegistrationData,
} from '../src/plugins/plugin_register';

const descriptor: PluginRegistrationData = { name: 'pl-new', dock_image: 'org/pl-new' };

let logSpy: jest.SpyInstance;
beforeEach(() => {
  jest.clearAllMocks();
  mockClientGet = jest.fn();
  mockRegisterWithAdmin = jest.fn();
  mockExistsInCube = jest.fn();
  mockGetComputeResources = jest.fn();
  mockGetAuthToken = jest.fn();
  mockRegisterDirect = jest.fn();
  mockStackPush = jest.fn();
  logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
});
afterEach(() => {
  logSpy.mockRestore();
});

describe('plugin_registerWithAdmin', () => {
  it('acquires an admin token from credentials and registers', async () => {
    mockClientGet.mockResolvedValue({ url: 'https://cube/api/v1/' });
    mockGetAuthToken.mockResolvedValue('ADMIN_TOKEN');
    mockRegisterWithAdmin.mockResolvedValue({ name: 'pl-new', id: 9 });

    const created = await plugin_registerWithAdmin(descriptor, ['host'], { username: 'a', password: 'p' });
    expect(created).toMatchObject({ id: 9 });
    expect(mockGetAuthToken).toHaveBeenCalledWith('https://cube/api/v1/auth-token/', 'a', 'p');
    expect(mockRegisterWithAdmin).toHaveBeenCalledWith(descriptor, ['host'], 'ADMIN_TOKEN');
  });

  it('warns and continues without a token when auth fails', async () => {
    mockClientGet.mockResolvedValue({ url: 'https://cube/api/v1/' });
    mockGetAuthToken.mockRejectedValue(new Error('401'));
    mockRegisterWithAdmin.mockResolvedValue({ name: 'pl-new' });

    expect(await plugin_registerWithAdmin(descriptor, ['host'], { username: 'a', password: 'bad' })).not.toBeNull();
    expect(mockStackPush).toHaveBeenCalledWith('warning', expect.stringContaining('Failed to get admin token'));
    expect(mockRegisterWithAdmin).toHaveBeenCalledWith(descriptor, ['host'], undefined);
  });

  it('skips token acquisition without credentials', async () => {
    mockRegisterWithAdmin.mockResolvedValue({ name: 'pl-new' });
    expect(await plugin_registerWithAdmin(descriptor)).not.toBeNull();
    expect(mockGetAuthToken).not.toHaveBeenCalled();
  });

  it('returns null when the registration fails', async () => {
    mockRegisterWithAdmin.mockResolvedValue(null);
    expect(await plugin_registerWithAdmin(descriptor)).toBeNull();
  });
});

describe('plugin_register (legacy direct)', () => {
  it('returns the registered plugin data', async () => {
    mockRegisterDirect.mockResolvedValue({ ok: true, value: { name: 'pl-new', id: 3 } });
    expect(await plugin_register(descriptor, ['host'])).toMatchObject({ id: 3 });
  });

  it('returns null on failure', async () => {
    mockRegisterDirect.mockResolvedValue({ ok: false });
    expect(await plugin_register(descriptor)).toBeNull();
  });
});

describe('plugin_checkExists', () => {
  it('returns the existing plugin', async () => {
    mockExistsInCube.mockResolvedValue({ name: 'pl-new', id: 1 });
    expect(await plugin_checkExists('pl-new')).toMatchObject({ id: 1 });
  });

  it('returns null when absent', async () => {
    mockExistsInCube.mockResolvedValue(null);
    expect(await plugin_checkExists('ghost')).toBeNull();
  });
});

describe('plugin_assignToComputeResources', () => {
  it('reports success when the plugin already has the resources', async () => {
    mockGetComputeResources.mockResolvedValue(['host', 'gpu']);
    expect(await plugin_assignToComputeResources(1, ['host'])).toBe(true);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('already assigned'));
  });

  it('logs the additional resources and warns about the manual step', async () => {
    mockGetComputeResources.mockResolvedValue(['host']);
    expect(await plugin_assignToComputeResources(1, ['gpu'])).toBe(true);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Adding plugin to compute resources: gpu'));
    expect(mockStackPush).toHaveBeenCalledWith('warning', expect.stringContaining('not fully implemented'));
  });

  it('returns false when the lookup throws', async () => {
    mockGetComputeResources.mockRejectedValue(new Error('down'));
    expect(await plugin_assignToComputeResources(1, ['gpu'])).toBe(false);
    expect(mockStackPush).toHaveBeenCalledWith('error', expect.stringContaining('down'));
  });
});
