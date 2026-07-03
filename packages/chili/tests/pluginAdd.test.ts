/**
 * @file Tests for the three-phase plugin add orchestration: current-CUBE
 * check, peer-store import, Docker extraction. Docker, salsa, cumin and the
 * admin prompt are mocked at their seams; input format detection runs real.
 */

let mockDockerAvailable: jest.Mock;
let mockDockerPull: jest.Mock;
let mockShellDetails: jest.Mock;
let mockImageCmd: jest.Mock;
jest.mock('../src/utils/docker', () => ({
  docker_checkAvailability: (...a: unknown[]): unknown => mockDockerAvailable(...a),
  docker_pullImage: (...a: unknown[]): unknown => mockDockerPull(...a),
  shellCommand_runWithDetails: (...a: unknown[]): unknown => mockShellDetails(...a),
  shellCommand_run: jest.fn(),
  docker_getImageCmd: (...a: unknown[]): unknown => mockImageCmd(...a),
}));

let mockRegisterWithAdmin: jest.Mock;
let mockCheckExists: jest.Mock;
let mockSearchPeers: jest.Mock;
let mockImportFromStore: jest.Mock;
jest.mock('@fnndsc/salsa', () => ({
  plugin_registerWithAdmin: (...a: unknown[]): unknown => mockRegisterWithAdmin(...a),
  plugin_checkExists: (...a: unknown[]): unknown => mockCheckExists(...a),
  plugin_assignToComputeResources: jest.fn(),
  plugins_searchPeers: (...a: unknown[]): unknown => mockSearchPeers(...a),
  plugin_importFromStore: (...a: unknown[]): unknown => mockImportFromStore(...a),
}));

let mockValidate: jest.Mock;
let mockGetAll: jest.Mock;
let mockErrorsGet: jest.Mock;
jest.mock('@fnndsc/cumin', () => ({
  computeResources_validate: (...a: unknown[]): unknown => mockValidate(...a),
  computeResourceNames_parse: (s: string): string[] => s.split(',').map((x: string) => x.trim()),
  computeResources_getAll: (...a: unknown[]): unknown => mockGetAll(...a),
  errorStack: {
    allOfType_get: (...a: unknown[]): unknown => mockErrorsGet(...a),
    stack_push: jest.fn(),
  },
}));

let mockPrompt: jest.Mock;
jest.mock('../src/utils/admin_prompt', () => ({
  adminCredentials_prompt: (...a: unknown[]): unknown => mockPrompt(...a),
}));

import { plugin_add } from '../src/commands/plugins/add';

const ok = <T>(value: T): { ok: true; value: T } => ({ ok: true, value });

let logSpy: jest.SpyInstance;
let errSpy: jest.SpyInstance;
beforeEach(() => {
  jest.clearAllMocks();
  mockDockerAvailable = jest.fn(async () => true);
  mockDockerPull = jest.fn(async () => true);
  mockShellDetails = jest.fn(async () => ({ stdout: '', stderr: '', success: false }));
  mockImageCmd = jest.fn(async () => []);
  mockRegisterWithAdmin = jest.fn();
  mockCheckExists = jest.fn(async () => null);
  mockSearchPeers = jest.fn(async () => null);
  mockImportFromStore = jest.fn();
  mockValidate = jest.fn(async () => ok(['host']));
  mockGetAll = jest.fn(async () => ok([]));
  mockErrorsGet = jest.fn(() => []);
  mockPrompt = jest.fn();
  logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
  errSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  logSpy.mockRestore();
  errSpy.mockRestore();
});

describe('compute resource resolution', () => {
  it('validates explicit --compute names and fails on rejection', async () => {
    mockValidate.mockResolvedValue({ ok: false });
    mockErrorsGet.mockReturnValue(['Invalid compute resource(s): moon']);
    expect(await plugin_add('pl-x', { compute: 'moon' })).toBe('failed');
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('moon'));
  });

  it('uses all registered resources when none are specified', async () => {
    mockGetAll.mockResolvedValue(ok([{ name: 'host' }, { name: 'gpu' }]));
    mockCheckExists.mockResolvedValue({ name: 'pl-x' });
    expect(await plugin_add('pl-x', {})).toBe('already_exists');
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Using compute resources: host, gpu'));
  });
});

describe('phase 1: current CUBE', () => {
  it('reports an existing plugin', async () => {
    mockCheckExists.mockResolvedValue({ name: 'pl-x', id: 1 });
    expect(await plugin_add('org/pl-x:1.0', { compute: 'host' })).toBe('already_exists');
    expect(mockCheckExists).toHaveBeenCalledWith('pl-x');
  });
});

describe('phase 2: peer stores', () => {
  it('imports from a peer store hit', async () => {
    mockSearchPeers.mockResolvedValue({ storeName: 'chrisproject', plugin: { name: 'pl-x' } });
    mockImportFromStore.mockResolvedValue({ success: true, plugin: { name: 'pl-x' } });
    expect(await plugin_add('pl-x', { compute: 'host' })).toBe('installed');
    expect(mockSearchPeers).toHaveBeenCalledWith('pl-x', undefined, ['https://cube.chrisproject.org/api/v1/']);
  });

  it('honours a custom --store URL and docker-image name/version', async () => {
    mockSearchPeers.mockResolvedValue({ storeName: 's', plugin: {} });
    mockImportFromStore.mockResolvedValue({ success: true, plugin: {} });
    await plugin_add('org/pl-x:2.1', { compute: 'host', store: 'https://other/api/v1/' });
    expect(mockSearchPeers).toHaveBeenCalledWith('pl-x', '2.1', ['https://other/api/v1/']);
  });

  it('fails outright on a non-auth import failure', async () => {
    mockSearchPeers.mockResolvedValue({ storeName: 's', plugin: {} });
    mockImportFromStore.mockResolvedValue({ success: false, errorMessage: 'broken' });
    expect(await plugin_add('pl-x', { compute: 'host' })).toBe('failed');
    expect(errSpy).toHaveBeenCalledWith('broken');
  });

  it('retries an auth failure with flag credentials', async () => {
    mockSearchPeers.mockResolvedValue({ storeName: 's', plugin: {} });
    mockImportFromStore
      .mockResolvedValueOnce({ success: false, requiresAuth: true })
      .mockResolvedValueOnce({ success: true, plugin: {} });
    const outcome = await plugin_add('pl-x', { compute: 'host', adminUser: 'a', adminPassword: 'p' });
    expect(outcome).toBe('installed');
    expect(mockImportFromStore).toHaveBeenLastCalledWith('', {}, ['host'], { username: 'a', password: 'p' });
  });

  it('prompts interactively and gives up after three failed attempts', async () => {
    mockSearchPeers.mockResolvedValue({ storeName: 's', plugin: {} });
    mockImportFromStore.mockResolvedValue({ success: false, requiresAuth: true });
    mockPrompt.mockResolvedValue({ username: 'a', password: 'bad' });
    expect(await plugin_add('pl-x', { compute: 'host' })).toBe('failed');
    expect(mockPrompt).toHaveBeenCalledTimes(3);
  });

  it('stops when the interactive prompt is cancelled', async () => {
    mockSearchPeers.mockResolvedValue({ storeName: 's', plugin: {} });
    mockImportFromStore.mockResolvedValue({ success: false, requiresAuth: true });
    mockPrompt.mockResolvedValue(null);
    expect(await plugin_add('pl-x', { compute: 'host' })).toBe('failed');
    expect(logSpy).toHaveBeenCalledWith('Authentication cancelled.');
  });
});

describe('phase 3: docker extraction', () => {
  it('fails when docker is unavailable or the pull fails', async () => {
    mockDockerAvailable.mockResolvedValue(false);
    expect(await plugin_add('pl-x', { compute: 'host' })).toBe('failed');

    mockDockerAvailable.mockResolvedValue(true);
    mockDockerPull.mockResolvedValue(false);
    expect(await plugin_add('pl-x', { compute: 'host' })).toBe('failed');
  });

  it('extracts the descriptor, infers missing fields, and registers', async () => {
    mockShellDetails.mockResolvedValue({
      stdout: JSON.stringify({ title: 'X' }),
      stderr: '',
      success: true,
    });
    mockRegisterWithAdmin.mockResolvedValue({ name: 'pl-x' });
    expect(await plugin_add('org/pl-x:1.0', { compute: 'host' })).toBe('installed');
    const [payload] = mockRegisterWithAdmin.mock.calls[0] as [Record<string, unknown>];
    expect(payload.name).toBe('pl-x');
    expect(payload.dock_image).toBe('org/pl-x:1.0');
    expect(payload.public_repo).toBe('https://github.com/org/pl-x');
  });

  it('falls through extraction methods on bad JSON then succeeds', async () => {
    mockShellDetails
      .mockResolvedValueOnce({ stdout: 'not json', stderr: '', success: true })
      .mockResolvedValueOnce({ stdout: JSON.stringify({ name: 'pl-y', dock_image: 'i' }), stderr: '', success: true });
    mockRegisterWithAdmin.mockResolvedValue({ name: 'pl-y' });
    expect(await plugin_add('org/pl-y:1.0', { compute: 'host' })).toBe('installed');
    expect(mockShellDetails).toHaveBeenCalledTimes(2);
  });

  it('tries the old chrisapp CMD --json path last', async () => {
    mockShellDetails
      .mockResolvedValueOnce({ stdout: '', stderr: 'no such cmd', success: false })
      .mockResolvedValueOnce({ stdout: '', stderr: 'no such cmd', success: false })
      .mockResolvedValueOnce({ stdout: JSON.stringify({ name: 'pl-old', dock_image: 'i' }), stderr: '', success: true });
    mockImageCmd.mockResolvedValue(['oldapp.py']);
    mockRegisterWithAdmin.mockResolvedValue({ name: 'pl-old' });
    expect(await plugin_add('org/pl-old:1.0', { compute: 'host' })).toBe('installed');
  });

  it('fails when every extraction method comes up empty', async () => {
    mockShellDetails.mockResolvedValue({ stdout: '', stderr: 'nope', success: false });
    mockImageCmd.mockResolvedValue([]);
    expect(await plugin_add('org/pl-z:1.0', { compute: 'host' })).toBe('failed');
    expect(errSpy).toHaveBeenCalledWith('Failed to extract plugin descriptor from image.');
  });

  it('retries registration on an auth error and fails otherwise', async () => {
    mockShellDetails.mockResolvedValue({
      stdout: JSON.stringify({ name: 'pl-x', dock_image: 'i' }), stderr: '', success: true,
    });
    mockRegisterWithAdmin.mockResolvedValueOnce(null).mockResolvedValueOnce({ name: 'pl-x' });
    mockErrorsGet.mockReturnValue(['403 Forbidden']);
    const outcome = await plugin_add('org/pl-x:1.0', { compute: 'host', adminUser: 'a', adminPassword: 'p' });
    expect(outcome).toBe('installed');

    mockRegisterWithAdmin.mockReset().mockResolvedValue(null);
    mockErrorsGet.mockReturnValue(['just broken']);
    expect(await plugin_add('org/pl-x:1.0', { compute: 'host' })).toBe('failed');
  });
});

describe('store URLs', () => {
  it('rejects direct store-URL imports as unsupported', async () => {
    expect(await plugin_add('https://store/api/v1/plugins/9/', { compute: 'host' })).toBe('failed');
    expect(errSpy).toHaveBeenCalledWith('Store URL import not yet fully supported.');
  });
});
