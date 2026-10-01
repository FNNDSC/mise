/**
 * @file Group membership reads off the membership rows: a row names its
 * user (user_id, user_username), so a group's members cost the page, not
 * one user request per row. The linked user is fetched only for a row
 * that does not name one.
 */
jest.mock('../src/connect/chrisConnection', () => ({
  chrisConnection: { client_get: jest.fn() },
}));

import { chrisConnection } from '../src/connect/chrisConnection';
import { ChRISGroupGroup, type ChrisGroup, type ChrisGroupMember } from '../src/groups/chrisGroups';
import { errorStack } from '../src/error/errorStack';
import type { Result } from '../src/utils/result';

const mockClientGet: jest.Mock = chrisConnection.client_get as unknown as jest.Mock;

/** A membership row resource: its data, and a counted link to the user. */
function membership_make(data: Record<string, unknown>, getUser: jest.Mock): { data: Record<string, unknown>; getUser: jest.Mock } {
  return { data, getUser };
}

/** A group whose one membership page serves the rows given. */
function group_make(rows: Array<{ data: Record<string, unknown>; getUser: jest.Mock }>): { getUsers: jest.Mock } {
  return {
    getUsers: jest.fn(async () => ({
      getItems: (): unknown[] => rows,
      totalCount: rows.length,
      hasNextPage: false,
    })),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(errorStack, 'stack_push').mockImplementation(() => undefined);
});

describe('members_getAll', () => {
  it('reads every member off the page and asks CUBE for no user', async () => {
    const getUser: jest.Mock = jest.fn();
    const group = group_make([
      membership_make({ id: 1, group_id: 1, user_id: 2, user_username: 'ada' }, getUser),
      membership_make({ id: 2, group_id: 1, user_id: 5, user_username: 'bob' }, getUser),
    ]);
    mockClientGet.mockResolvedValue({ getGroup: jest.fn(async () => group) });
    const result: Result<ChrisGroupMember[]> = await new ChRISGroupGroup().members_getAll(1);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual([{ id: 2, username: 'ada' }, { id: 5, username: 'bob' }]);
    expect(group.getUsers).toHaveBeenCalledTimes(1);
    expect(getUser).not.toHaveBeenCalled();
  });

  it('fetches the linked user only for a row that does not name one', async () => {
    const getUser: jest.Mock = jest.fn(async () => ({ data: { id: 9, username: 'cy' } }));
    const group = group_make([
      membership_make({ id: 1, group_id: 1, user_id: 2, user_username: 'ada' }, getUser),
      membership_make({ id: 3, group_id: 1 }, getUser),
    ]);
    mockClientGet.mockResolvedValue({ getGroup: jest.fn(async () => group) });
    const result: Result<ChrisGroupMember[]> = await new ChRISGroupGroup().members_getAll(1);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual([{ id: 2, username: 'ada' }, { id: 9, username: 'cy' }]);
    expect(getUser).toHaveBeenCalledTimes(1);
  });

  it('is Err when the group is not there', async () => {
    mockClientGet.mockResolvedValue({ getGroup: jest.fn(async () => null) });
    expect((await new ChRISGroupGroup().members_getAll(404)).ok).toBe(false);
  });
});

describe('groups_getAll keeps the items it lists', () => {
  it('lets members_getAll read a group off the listing instead of listing it by id', async () => {
    const getUser: jest.Mock = jest.fn();
    const rows = [{ id: 1, name: 'all_users' }, { id: 2, name: 'pacs_users' }];
    const items = rows.map((row: { id: number; name: string }) => ({
      data: row,
      ...group_make([membership_make({ id: row.id, group_id: row.id, user_id: 7, user_username: 'eve' }, getUser)]),
    }));
    const getGroups: jest.Mock = jest.fn(async () => ({ data: rows, getItems: (): unknown[] => items, totalCount: rows.length, hasNextPage: false }));
    const getGroup: jest.Mock = jest.fn();
    mockClientGet.mockResolvedValue({ getGroups, getGroup });
    const listed: Result<ChrisGroup[]> = await new ChRISGroupGroup().groups_getAll();
    expect(listed.ok).toBe(true);
    if (listed.ok) expect(listed.value).toEqual(rows);
    const members: Result<ChrisGroupMember[]> = await new ChRISGroupGroup().members_getAll(2);
    expect(members.ok).toBe(true);
    if (members.ok) expect(members.value).toEqual([{ id: 7, username: 'eve' }]);
    expect(getGroup).not.toHaveBeenCalled();
    expect(items[1].getUsers).toHaveBeenCalledTimes(1);
  });
});

describe('user_add', () => {
  it('reads the new member off the membership CUBE answers with', async () => {
    const getUser: jest.Mock = jest.fn();
    const group = { adminAddUser: jest.fn(async () => membership_make({ id: 7, group_id: 1, user_id: 3, user_username: 'dee' }, getUser)) };
    mockClientGet.mockResolvedValue({ getGroup: jest.fn(async () => group) });
    const result: Result<ChrisGroupMember> = await new ChRISGroupGroup().user_add(1, 'dee');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({ id: 3, username: 'dee' });
    expect(getUser).not.toHaveBeenCalled();
  });
});
