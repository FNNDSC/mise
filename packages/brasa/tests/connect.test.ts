/**
 * @file Tests for the two headless ways into a session: the saved-session
 * restore, and the token hand-over from a door that already logged in.
 */
import { jest, describe, it, expect, beforeEach } from '@jest/globals';

const mockContextSet = jest.fn(async () => true);
jest.unstable_mockModule('@fnndsc/cumin', () => ({
  chrisContext: { current_set: mockContextSet },
  Context: { ChRISuser: 'user', ChRISURL: 'url', ChRISfeed: 'feed', ChRISplugin: 'plugin' },
}));
const mockGetSingle = jest.fn(async () => ({ user: 'chris', URL: 'https://cube/api/v1/', folder: '/home/chris' }));
jest.unstable_mockModule('@fnndsc/salsa', () => ({ context_getSingle: mockGetSingle }));

const mockConnectWithToken = jest.fn();
const mockAuthTokenGet = jest.fn();
const mockClientGet = jest.fn();
const sessionState: { offline: boolean } = { offline: true };
jest.unstable_mockModule('../src/session/index.js', () => ({
  session: {
    connection: {
      connection_connectWithToken: mockConnectWithToken,
      authToken_get: mockAuthTokenGet,
      client_get: mockClientGet,
    },
    get offline(): boolean { return sessionState.offline; },
    set offline(value: boolean) { sessionState.offline = value; },
  },
}));

const { sessionConnect_fromSaved, sessionConnect_withToken } = await import('../src/core/connect.js');

beforeEach(() => {
  jest.clearAllMocks();
  sessionState.offline = false;
  mockGetSingle.mockResolvedValue({ user: 'chris', URL: 'https://cube/api/v1/', folder: '/home/chris' });
});

describe('sessionConnect_fromSaved', () => {
  it('restores when the saved token is accepted by the server', async () => {
    mockAuthTokenGet.mockResolvedValue('SAVED');
    mockClientGet.mockResolvedValue({ getUser: jest.fn(async () => ({ username: 'chris' })) });
    const result = await sessionConnect_fromSaved();
    expect(result.status).toBe('restored');
    expect(sessionState.offline).toBe(false);
    expect(mockAuthTokenGet).toHaveBeenCalledWith(true);
  });

  it('reports no context when nothing was saved', async () => {
    mockGetSingle.mockResolvedValue({ user: '', URL: '', folder: '' });
    await expect(sessionConnect_fromSaved()).resolves.toMatchObject({ status: 'no-context' });
    expect(mockAuthTokenGet).not.toHaveBeenCalled();
  });

  it('goes offline when the context has no token', async () => {
    mockAuthTokenGet.mockResolvedValue(null);
    await expect(sessionConnect_fromSaved()).resolves.toMatchObject({ status: 'no-token' });
    expect(sessionState.offline).toBe(true);
  });

  it('goes offline when no client can be made', async () => {
    mockAuthTokenGet.mockResolvedValue('SAVED');
    mockClientGet.mockResolvedValue(null);
    await expect(sessionConnect_fromSaved()).resolves.toMatchObject({ status: 'no-client' });
    expect(sessionState.offline).toBe(true);
  });

  it('goes offline with the server\'s reason when the token is rejected', async () => {
    mockAuthTokenGet.mockResolvedValue('STALE');
    mockClientGet.mockResolvedValue({ getUser: jest.fn(async () => { throw new Error('401'); }) });
    const result = await sessionConnect_fromSaved();
    expect(result.status).toBe('invalid-token');
    expect(result.error).toBe('401');
    expect(sessionState.offline).toBe(true);
  });
});

describe('sessionConnect_withToken', () => {
  it('connects, comes online, and sets the identity without touching the working directory', async () => {
    mockConnectWithToken.mockResolvedValue({ connected: true });
    const result = await sessionConnect_withToken('chris', 'https://cube/api/v1/', 'MINTED');
    expect(result.status).toBe('connected');
    expect(result.context.user).toBe('chris');
    expect(sessionState.offline).toBe(false);
    expect(mockConnectWithToken).toHaveBeenCalledWith({ user: 'chris', url: 'https://cube/api/v1/', token: 'MINTED' });
    const set: string[] = mockContextSet.mock.calls.map((call: unknown[]): string => String(call[0]));
    expect(set).toEqual(['user', 'url', 'feed', 'plugin']);
  });

  it('stays offline on a refusal and carries the reason', async () => {
    mockConnectWithToken.mockResolvedValue({ connected: false, reason: 'the server said no' });
    const result = await sessionConnect_withToken('chris', 'https://cube/api/v1/', 'STALE');
    expect(result.status).toBe('refused');
    expect(result.error).toBe('the server said no');
    expect(sessionState.offline).toBe(true);
    expect(mockContextSet).not.toHaveBeenCalled();
  });
});
