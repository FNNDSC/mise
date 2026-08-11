/**
 * @file Tests for user and group access, with the connection mocked at the
 * client boundary. The adapter extractors run for real against fixtures.
 */

jest.mock('../src/connect/chrisConnection', () => ({
  chrisConnection: { client_get: jest.fn() },
}));

import { chrisConnection } from '../src/connect/chrisConnection';
import {
  currentIdentity_get,
  currentUser_get,
  ChrisIdentity,
  ChrisUser,
} from '../src/users/chrisUsers';
import {
  groupMembers_getAll,
  groupUser_add,
  groupUser_remove,
  groups_getAll,
  ChrisGroup,
  ChrisGroupMember,
} from '../src/groups/chrisGroups';
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
  it('returns every page of groups from the client payload', async () => {
    const getGroups = jest.fn(async ({ offset }: { offset: number }) =>
      offset === 0
        ? { data: [{ id: 1, name: 'admins' }], hasNextPage: true }
        : { data: [{ id: 2, name: 'pacs' }], hasNextPage: false },
    );
    mockClientGet.mockResolvedValue({
      getGroups,
    });
    const result: Result<ChrisGroup[]> = await groups_getAll();
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual([{ id: 1, name: 'admins' }, { id: 2, name: 'pacs' }]);
    expect(getGroups).toHaveBeenNthCalledWith(1, { offset: 0 });
    expect(getGroups).toHaveBeenNthCalledWith(2, { offset: 1 });
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

describe('groupMembers_getAll', () => {
  it('resolves every page of group-user links to usernames', async () => {
    const membership = (id: number, username: string) => ({
      getUser: jest.fn(async () => ({ data: { id, username } })),
    });
    const alice = membership(11, 'alice');
    const peter = membership(12, 'peter.hong');
    const getUsers = jest.fn(async ({ offset }: MembershipPageOptions) => {
      const items = offset === 0 ? [alice] : [peter];
      return {
        data: items.map((_item, index) => ({ id: offset + index + 100 })),
        getItems: () => items,
        hasNextPage: offset === 0,
      };
    });
    mockClientGet.mockResolvedValue({
      getGroup: jest.fn(async () => ({ getUsers })),
    });

    const result: Result<ChrisGroupMember[]> = await groupMembers_getAll(7);

    expect(result).toEqual({
      ok: true,
      value: [
        { id: 11, username: 'alice' },
        { id: 12, username: 'peter.hong' },
      ],
    });
    expect(getUsers).toHaveBeenNthCalledWith(1, { offset: 0 });
    expect(getUsers).toHaveBeenNthCalledWith(2, { offset: 1 });
  });
});

describe('group membership changes', () => {
  it('adds a username through the selected group resource', async () => {
    const getUser = jest.fn(async () => ({ data: { id: 12, username: 'peter.hong' } }));
    const adminAddUser = jest.fn(async () => ({ data: { id: 99 }, getUser }));
    mockClientGet.mockResolvedValue({
      getGroup: jest.fn(async () => ({ adminAddUser })),
    });

    const result: Result<ChrisGroupMember> = await groupUser_add(7, 'peter.hong');

    expect(result).toEqual({ ok: true, value: { id: 12, username: 'peter.hong' } });
    expect(adminAddUser).toHaveBeenCalledWith('peter.hong');
    expect(getUser).toHaveBeenCalledTimes(1);
  });

  it('removes the selected username membership', async () => {
    const remove = jest.fn(async () => undefined);
    const getUser = jest.fn(async () => ({ delete: remove }));
    mockClientGet.mockResolvedValue({
      getGroup: jest.fn(async () => ({ getUser })),
    });

    const result: Result<boolean> = await groupUser_remove(7, 'peter.hong');

    expect(result).toEqual({ ok: true, value: true });
    expect(getUser).toHaveBeenCalledWith('peter.hong');
    expect(remove).toHaveBeenCalledTimes(1);
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
