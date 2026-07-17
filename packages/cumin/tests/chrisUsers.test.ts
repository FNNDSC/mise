/**
 * @file Tests for user and group access, with the connection mocked at the
 * client boundary. The adapter extractors run for real against fixtures.
 */

jest.mock('../src/connect/chrisConnection', () => ({
  chrisConnection: { client_get: jest.fn() },
}));

import { chrisConnection } from '../src/connect/chrisConnection';
import {
  groups_getAll,
  currentIdentity_get,
  currentUser_get,
  ChrisGroup,
  ChrisIdentity,
  ChrisUser,
} from '../src/users/chrisUsers';
import { errorStack } from '../src/error/errorStack';
import { Result } from '../src/utils/result';

const mockClientGet: jest.Mock = chrisConnection.client_get as unknown as jest.Mock;

interface MembershipPageOptions {
  limit: number;
  offset: number;
}

interface MembershipPageFixture {
  data: ChrisGroup[];
  hasNextPage?: boolean;
}

interface UserResourceFixture {
  data: ChrisUser;
  getGroups: (options: MembershipPageOptions) => Promise<MembershipPageFixture>;
}

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

describe('currentIdentity_get', () => {
  it('returns the current user and every CUBE group membership', async () => {
    const user: ChrisUser = { id: 42, username: 'rudolphpienaar', email: 'rudolph@example.org', is_staff: false };
    const groups: ChrisGroup[] = [{ id: 7, name: 'pacs' }, { id: 9, name: 'research' }];
    const getGroups: jest.Mock<Promise<MembershipPageFixture>, [MembershipPageOptions]> =
      jest.fn<Promise<MembershipPageFixture>, [MembershipPageOptions]>();
    getGroups.mockResolvedValue({ data: groups });
    const userResource: UserResourceFixture = { data: user, getGroups };
    const getUser: jest.Mock<Promise<UserResourceFixture>, []> =
      jest.fn<Promise<UserResourceFixture>, []>();
    getUser.mockResolvedValue(userResource);
    mockClientGet.mockResolvedValue({ getUser });

    const result: Result<ChrisIdentity> = await currentIdentity_get();

    expect(result).toEqual({ ok: true, value: { user, groups } });
  });

  it('fetches every page of the current user memberships', async () => {
    const user: ChrisUser = { id: 42, username: 'rudolphpienaar', email: 'rudolph@example.org', is_staff: false };
    const getGroups: jest.Mock<Promise<MembershipPageFixture>, [MembershipPageOptions]> =
      jest.fn<Promise<MembershipPageFixture>, [MembershipPageOptions]>(
        async (options: MembershipPageOptions): Promise<MembershipPageFixture> =>
          options.offset === 0
            ? { data: [{ id: 7, name: 'pacs' }], hasNextPage: true }
            : { data: [{ id: 9, name: 'research' }], hasNextPage: false },
      );
    const userResource: UserResourceFixture = { data: user, getGroups };
    const getUser: jest.Mock<Promise<UserResourceFixture>, []> =
      jest.fn<Promise<UserResourceFixture>, []>();
    getUser.mockResolvedValue(userResource);
    mockClientGet.mockResolvedValue({ getUser });

    const result: Result<ChrisIdentity> = await currentIdentity_get();

    expect(result).toEqual({
      ok: true,
      value: {
        user,
        groups: [{ id: 7, name: 'pacs' }, { id: 9, name: 'research' }],
      },
    });
  });
});
