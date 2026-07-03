/**
 * @file Tests for user and group access, with the connection mocked at the
 * client boundary. The adapter extractors run for real against fixtures.
 */

jest.mock('../src/connect/chrisConnection', () => ({
  chrisConnection: { client_get: jest.fn() },
}));

import { chrisConnection } from '../src/connect/chrisConnection';
import { groups_getAll, currentUser_get, ChrisGroup, ChrisUser } from '../src/users/chrisUsers';
import { errorStack } from '../src/error/errorStack';
import { Result } from '../src/utils/result';

const mockClientGet: jest.Mock = chrisConnection.client_get as unknown as jest.Mock;

let pushSpy: jest.SpyInstance;
beforeEach(() => {
  jest.clearAllMocks();
  pushSpy = jest.spyOn(errorStack, 'stack_push').mockImplementation(() => undefined);
});
afterEach(() => {
  pushSpy.mockRestore();
});

describe('groups_getAll', () => {
  it('returns the group list from the client payload', async () => {
    mockClientGet.mockResolvedValue({
      getGroups: jest.fn(async () => ({ data: [{ id: 1, name: 'admins' }, { id: 2, name: 'pacs' }] })),
    });
    const result: Result<ChrisGroup[]> = await groups_getAll();
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual([{ id: 1, name: 'admins' }, { id: 2, name: 'pacs' }]);
  });

  it('returns an empty list when the payload has no data', async () => {
    mockClientGet.mockResolvedValue({ getGroups: jest.fn(async () => ({})) });
    const result: Result<ChrisGroup[]> = await groups_getAll();
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual([]);
  });

  it('errors when not connected', async () => {
    mockClientGet.mockResolvedValue(null);
    expect((await groups_getAll()).ok).toBe(false);
    expect(pushSpy).toHaveBeenCalledWith('error', expect.stringContaining('Not connected'));
  });

  it('errors when the client call throws', async () => {
    mockClientGet.mockResolvedValue({ getGroups: jest.fn(async () => { throw new Error('boom'); }) });
    expect((await groups_getAll()).ok).toBe(false);
    expect(pushSpy).toHaveBeenCalledWith('error', expect.stringContaining('boom'));
  });
});

describe('currentUser_get', () => {
  it('returns the current user payload', async () => {
    const user: ChrisUser = { id: 7, username: 'chris', email: 'c@x.org', is_staff: true };
    mockClientGet.mockResolvedValue({ getUser: jest.fn(async () => ({ data: user })) });
    const result: Result<ChrisUser> = await currentUser_get();
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual(user);
  });

  it('errors when the response carries no data', async () => {
    mockClientGet.mockResolvedValue({ getUser: jest.fn(async () => ({})) });
    expect((await currentUser_get()).ok).toBe(false);
    expect(pushSpy).toHaveBeenCalledWith('error', expect.stringContaining('no data'));
  });

  it('errors when not connected', async () => {
    mockClientGet.mockResolvedValue(null);
    expect((await currentUser_get()).ok).toBe(false);
  });

  it('errors when the client call throws', async () => {
    mockClientGet.mockResolvedValue({ getUser: jest.fn(async () => { throw new Error('401'); }) });
    expect((await currentUser_get()).ok).toBe(false);
    expect(pushSpy).toHaveBeenCalledWith('error', expect.stringContaining('401'));
  });
});
