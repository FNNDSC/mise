/**
 * Boundary-only tests for the connect, store and context salsa intents.
 * Partial mock of cumin: real Context enum / Result / errorStack; stubbed
 * chrisConnection, chrisContext and ChRISPlugin.
 */
const mockConn = {
  connection_connect: jest.fn(),
  connection_logout: jest.fn(),
};
const mockCtx = {
  fullContext_get: jest.fn(),
  currentContext_update: jest.fn(),
  singleContext: { user: 'chris' },
  current_set: jest.fn(),
};
const mockListPeerStore = jest.fn();

jest.mock('@fnndsc/cumin', () => {
  const actual = jest.requireActual('@fnndsc/cumin');
  return {
    ...actual,
    chrisConnection: mockConn,
    chrisContext: mockCtx,
    ChRISPlugin: jest.fn().mockImplementation(() => ({
      plugin_listPeerStore: mockListPeerStore,
    })),
  };
});

import { connect_do, logout_do } from '../src/connect/index';
import { store_list, store_search } from '../src/store/index';
import { context_getFull, context_getSingle, context_set } from '../src/context/index';
import { errorStack } from '@fnndsc/cumin';

beforeEach(() => {
  jest.clearAllMocks();
  errorStack.stack_clear();
});

describe('connect intents', () => {
  const opts = { user: 'chris', password: 'p', debug: false, url: 'http://c/api/' };

  it('connect_do returns true when a token is issued', async () => {
    mockConn.connection_connect.mockResolvedValue('token123');
    expect(await connect_do(opts)).toBe(true);
    expect(mockConn.connection_connect).toHaveBeenCalledWith(opts);
  });

  it('connect_do returns false when no token is issued', async () => {
    mockConn.connection_connect.mockResolvedValue(null);
    expect(await connect_do(opts)).toBe(false);
  });

  it('logout_do delegates to connection_logout', async () => {
    mockConn.connection_logout.mockResolvedValue(undefined);
    await logout_do();
    expect(mockConn.connection_logout).toHaveBeenCalled();
  });
});

describe('store intents', () => {
  it('store_list returns the peer-store plugins', async () => {
    mockListPeerStore.mockResolvedValue([{ name: 'pl-a' }]);
    expect(await store_list('http://store/')).toEqual([{ name: 'pl-a' }]);
    expect(mockListPeerStore).toHaveBeenCalledWith('http://store/');
  });

  it('store_list returns [] when the store yields null', async () => {
    mockListPeerStore.mockResolvedValue(null);
    expect(await store_list()).toEqual([]);
  });

  it('store_search passes the name filter', async () => {
    mockListPeerStore.mockResolvedValue([{ name: 'pl-dircopy' }]);
    expect(await store_search('dircopy', 'http://store/')).toEqual([{ name: 'pl-dircopy' }]);
    expect(mockListPeerStore).toHaveBeenCalledWith('http://store/', { name: 'dircopy' });
  });

  it('store_search returns [] when the store yields null', async () => {
    mockListPeerStore.mockResolvedValue(null);
    expect(await store_search('x')).toEqual([]);
  });
});

describe('context intents', () => {
  it('context_getFull delegates to fullContext_get', () => {
    mockCtx.fullContext_get.mockReturnValue({ users: {}, currentUser: null, currentURL: null });
    expect(context_getFull()).toEqual({ users: {}, currentUser: null, currentURL: null });
  });

  it('context_getSingle updates then returns the single context', async () => {
    mockCtx.currentContext_update.mockResolvedValue(undefined);
    const snap = await context_getSingle();
    expect(mockCtx.currentContext_update).toHaveBeenCalled();
    expect(snap).toBe(mockCtx.singleContext);
  });

  it('context_set applies string options and skips undefined/boolean ones', async () => {
    mockCtx.current_set.mockResolvedValue(true);
    const r = await context_set({ ChRISuser: 'chris', ChRISfolder: '/home', full: true });
    expect(r.ok).toBe(true);
    expect(r.ok && r.value).toHaveLength(2); // user + folder; full skipped
    expect(mockCtx.current_set).toHaveBeenCalledTimes(2);
  });

  it('context_set returns Err when a setter fails', async () => {
    mockCtx.current_set.mockResolvedValue(false);
    const r = await context_set({ ChRISuser: 'chris' });
    expect(r.ok).toBe(false);
  });
});
