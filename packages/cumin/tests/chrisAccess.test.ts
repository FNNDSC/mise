/**
 * @file Tests for a feed's access and name: reading users, groups and the
 * public flag; granting a group; withdrawing a user's or a group's grant;
 * renaming. Connection mocked at the client boundary.
 */
jest.mock('../src/connect/chrisConnection', () => ({
  chrisConnection: { client_get: jest.fn() },
}));

import { chrisConnection } from '../src/connect/chrisConnection';
import { feedAccess_read, feedShare_group, feedShare_revoke, feed_rename } from '../src/feeds/chrisAccess';
import { errorStack } from '../src/error/errorStack';

const mockClientGet: jest.Mock = chrisConnection.client_get as unknown as jest.Mock;

interface Fake {
  users: string[];
  groups: string[];
  public: boolean;
  deleted: string[];
  granted: string[];
  put: Array<Record<string, unknown>>;
}

function client_make(fake: Fake): unknown {
  const permission = (name: string) => ({ delete: async () => { fake.deleted.push(name); } });
  const feed = {
    data: { id: 12, public: fake.public },
    getUserPermissions: async () => ({ data: fake.users.map((username) => ({ username })) }),
    getGroupPermissions: async () => ({ data: fake.groups.map((grp_name) => ({ grp_name })) }),
    getUserPermission: async (name: string) => (fake.users.includes(name) ? permission(`u:${name}`) : null),
    getGroupPermission: async (name: string) => (fake.groups.includes(name) ? permission(`g:${name}`) : null),
    addGroupPermission: async (name: string) => { fake.granted.push(name); return {}; },
    put: async (data: Record<string, unknown>) => { fake.put.push(data); return feed; },
  };
  return { getFeed: async (id: number) => (id === 12 ? feed : null) };
}

const fake_make = (partial: Partial<Fake> = {}): Fake => ({ users: [], groups: [], public: false, deleted: [], granted: [], put: [], ...partial });

beforeEach(() => {
  mockClientGet.mockReset();
  while (errorStack.stack_pop() !== undefined) { /* drain */ }
});

describe('feedAccess_read', () => {
  it('reads the users, the groups and the public flag', async () => {
    mockClientGet.mockResolvedValue(client_make(fake_make({ users: ['ann'], groups: ['grantlab'], public: true })));
    const result = await feedAccess_read(12);
    expect(result.ok && result.value).toEqual({ users: ['ann'], groups: ['grantlab'], public: true });
  });

  it('says so when not connected or the feed is not found', async () => {
    mockClientGet.mockResolvedValue(null);
    expect((await feedAccess_read(12)).ok).toBe(false);
    mockClientGet.mockResolvedValue(client_make(fake_make()));
    expect((await feedAccess_read(5)).ok).toBe(false);
    expect(errorStack.stack_pop()?.message).toMatch(/feed 5 not found/);
  });
});

describe('grants', () => {
  it('grants a group, and withdraws a user or a group grant (false when none was held)', async () => {
    const fake = fake_make({ users: ['ann'], groups: ['grantlab'] });
    mockClientGet.mockResolvedValue(client_make(fake));
    expect((await feedShare_group(12, 'sysadmin')).ok).toBe(true);
    expect(fake.granted).toEqual(['sysadmin']);
    const user = await feedShare_revoke(12, 'user', 'ann');
    const group = await feedShare_revoke(12, 'group', 'grantlab');
    const none = await feedShare_revoke(12, 'user', 'bob');
    expect([user.ok && user.value, group.ok && group.value, none.ok && none.value]).toEqual([true, true, false]);
    expect(fake.deleted).toEqual(['u:ann', 'g:grantlab']);
  });

  it('stacks the error when CUBE refuses', async () => {
    mockClientGet.mockResolvedValue({ getFeed: async () => { throw new Error('boom'); } });
    expect((await feedShare_revoke(12, 'group', 'x')).ok).toBe(false);
    expect(errorStack.stack_pop()?.message).toMatch(/Failed to stop sharing feed 12 with group x: boom/);
  });
});

describe('feed_rename', () => {
  it('puts the new name, and refuses an empty one', async () => {
    const fake = fake_make();
    mockClientGet.mockResolvedValue(client_make(fake));
    expect((await feed_rename(12, 'Brain run')).ok).toBe(true);
    expect(fake.put).toEqual([{ name: 'Brain run' }]);
    expect((await feed_rename(12, '  ')).ok).toBe(false);
    expect(errorStack.stack_pop()?.message).toMatch(/cannot be empty/);
  });
});
