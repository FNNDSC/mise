/**
 * Boundary-only tests for EtcVfsProvider. Real Ok/Err/errorStack; the cumin
 * resource getters and chrisContext are stubbed.
 */
const mockCompute = jest.fn();
const mockGroups = jest.fn();
const mockGroupMembers = jest.fn();
const mockGroupUserAdd = jest.fn();
const mockUser = jest.fn();
const mockCtx = { ChRISURL_get: jest.fn(), ChRISuser_get: jest.fn() };

jest.mock('@fnndsc/cumin', () => {
  const actual = jest.requireActual('@fnndsc/cumin');
  return {
    ...actual,
    computeResources_getAll: mockCompute,
    groups_getAll: mockGroups,
    groupMembers_getAll: mockGroupMembers,
    groupUser_add: mockGroupUserAdd,
    currentUser_get: mockUser,
    chrisContext: mockCtx,
  };
});

import { Ok, Err, errorStack, listCache_get } from '@fnndsc/cumin';
import { EtcVfsProvider } from '../src/vfs/providers/etc';
import { groupUser_add } from '../src/groups/index';

let etc: EtcVfsProvider;

beforeEach(() => {
  jest.clearAllMocks();
  errorStack.stack_clear();
  listCache_get().cache_invalidate('/etc/group');
  mockCtx.ChRISURL_get.mockResolvedValue(null);
  mockCtx.ChRISuser_get.mockResolvedValue(null);
  etc = new EtcVfsProvider();
});

describe('list / cp', () => {
  it('lists the four virtual /etc files', async () => {
    const r = await etc.list('/etc');
    expect(r.ok && r.value.map((i) => i.name)).toEqual(['compute.yaml', 'group', 'passwd', 'cube']);
    expect(r.ok && r.value.every((i) => i.type === 'file' && i.owner === 'root')).toBe(true);
  });

  it('cp is refused (read-only)', async () => {
    expect(await etc.cp('/etc/passwd', '/x', { recursive: false } as never)).toBe(false);
    expect(errorStack.stack_search('read-only').length).toBeGreaterThan(0);
  });

  it('read errors on an unknown /etc file', async () => {
    expect((await etc.read('/etc/nope')).ok).toBe(false);
  });
});

describe('compute.yaml', () => {
  it('renders compute resources, including optional description', async () => {
    mockCompute.mockResolvedValue(
      Ok([
        { id: 1, name: 'host', compute_url: 'http://c/', description: 'main' },
        { id: 2, name: 'moc', compute_url: null }, // no description
      ])
    );
    const r = await etc.read('/etc/compute.yaml');
    expect(r.ok).toBe(true);
    const text = r.ok ? r.value : '';
    expect(text).toContain('- id: 1');
    expect(text).toContain('description: main');
    expect(text).toContain('- id: 2');
    expect(text).not.toContain('description: undefined');
  });

  it('renders a "(none)" marker for an empty list', async () => {
    mockCompute.mockResolvedValue(Ok([]));
    const r = await etc.read('/etc/compute.yaml');
    expect(r.ok && r.value).toContain('# (none)');
  });

  it('errors when the fetch fails', async () => {
    mockCompute.mockResolvedValue(Err());
    expect((await etc.read('/etc/compute.yaml')).ok).toBe(false);
  });
});

describe('group', () => {
  it('renders /etc/group lines with their usernames', async () => {
    mockGroups.mockResolvedValue(Ok([
      { name: 'all_users', id: 1 },
      { name: 'pacs_users', id: 7 },
    ]));
    mockGroupMembers
      .mockResolvedValueOnce(Ok([
        { id: 10, username: 'alice' },
        { id: 11, username: 'peter.hong' },
      ]))
      .mockResolvedValueOnce(Ok([{ id: 11, username: 'peter.hong' }]));

    const r = await etc.read('/etc/group');

    expect(r.ok && r.value).toBe(
      'all_users:x:1:alice,peter.hong\n'
      + 'pacs_users:x:7:peter.hong\n',
    );
    expect(mockGroupMembers).toHaveBeenNthCalledWith(1, 1);
    expect(mockGroupMembers).toHaveBeenNthCalledWith(2, 7);
  });

  it('errors when the fetch fails', async () => {
    mockGroups.mockResolvedValue(Err());
    expect((await etc.read('/etc/group')).ok).toBe(false);
  });

  it('reuses a hydrated group projection on consecutive reads', async (): Promise<void> => {
    mockGroups.mockResolvedValue(Ok([{ name: 'pacs_users', id: 2 }]));
    mockGroupMembers.mockResolvedValue(Ok([{ id: 12, username: 'peter.hong' }]));

    const first = await etc.read('/etc/group');
    const second = await etc.read('/etc/group');

    expect(first).toEqual(Ok('pacs_users:x:2:peter.hong\n'));
    expect(second).toEqual(first);
    expect(mockGroups).toHaveBeenCalledTimes(1);
    expect(mockGroupMembers).toHaveBeenCalledTimes(1);
  });

  it('refreshes the cached projection after a successful membership mutation', async (): Promise<void> => {
    mockGroups.mockResolvedValue(Ok([{ name: 'pacs_users', id: 2 }]));
    mockGroupMembers
      .mockResolvedValueOnce(Ok([]))
      .mockResolvedValueOnce(Ok([{ id: 12, username: 'peter.hong' }]));
    mockGroupUserAdd.mockResolvedValue(Ok({ id: 12, username: 'peter.hong' }));

    expect(await etc.read('/etc/group')).toEqual(Ok('pacs_users:x:2:\n'));
    expect(await groupUser_add(2, 'peter.hong')).toEqual({
      ok: true,
      value: { id: 12, username: 'peter.hong' },
    });
    expect(await etc.read('/etc/group')).toEqual(Ok('pacs_users:x:2:peter.hong\n'));
    expect(mockGroups).toHaveBeenCalledTimes(2);
    expect(mockGroupMembers).toHaveBeenCalledTimes(2);
  });

  it('past its freshness window the projection serves stale at once and re-renders behind itself', async (): Promise<void> => {
    const now = jest.spyOn(Date, 'now').mockReturnValue(1_000);
    mockGroups.mockResolvedValue(Ok([{ name: 'pacs_users', id: 2 }]));
    mockGroupMembers.mockResolvedValue(Ok([]));

    await etc.read('/etc/group');
    now.mockReturnValue(301_001);
    mockGroups.mockResolvedValue(Ok([{ name: 'pacs_users', id: 2 }, { name: 'newcomers', id: 3 }]));
    const stale = await etc.read('/etc/group');
    expect(stale.ok && stale.value).toBe('pacs_users:x:2:\n'); // served at once, old content
    for (let i = 0; i < 6; i++) await Promise.resolve();
    expect(mockGroups).toHaveBeenCalledTimes(2);
    const fresh = await etc.read('/etc/group');
    expect(fresh.ok && fresh.value).toContain('newcomers:x:3:');
    expect(mockGroups).toHaveBeenCalledTimes(2); // the re-render served this read; no third fetch
    now.mockRestore();
  });

  it('does not reuse a projection after the CUBE connection changes', async (): Promise<void> => {
    mockCtx.ChRISURL_get
      .mockResolvedValueOnce('https://cube-a.example/api/v1/')
      .mockResolvedValueOnce('https://cube-b.example/api/v1/');
    mockCtx.ChRISuser_get.mockResolvedValue('chris');
    mockGroups.mockResolvedValue(Ok([{ name: 'all_users', id: 1 }]));
    mockGroupMembers.mockResolvedValue(Ok([]));

    await etc.read('/etc/group');
    await etc.read('/etc/group');

    expect(mockGroups).toHaveBeenCalledTimes(2);
    expect(mockGroupMembers).toHaveBeenCalledTimes(2);
  });
});

describe('passwd', () => {
  it('renders a passwd line', async () => {
    mockUser.mockResolvedValue(Ok({ id: 5, username: 'chris', email: 'c@x' }));
    const r = await etc.read('/etc/passwd');
    expect(r.ok && r.value).toBe('chris:x:5:5:c@x:/home/chris:chell\n');
  });

  it('defaults uid to 0 and gecos to empty', async () => {
    mockUser.mockResolvedValue(Ok({ username: 'anon' }));
    const r = await etc.read('/etc/passwd');
    expect(r.ok && r.value).toBe('anon:x:0:0::/home/anon:chell\n');
  });

  it('errors when the fetch fails', async () => {
    mockUser.mockResolvedValue(Err());
    expect((await etc.read('/etc/passwd')).ok).toBe(false);
  });
});

describe('cube', () => {
  it('renders url + user when connected', async () => {
    mockCtx.ChRISURL_get.mockResolvedValue('http://c/api/');
    mockCtx.ChRISuser_get.mockResolvedValue('chris');
    const r = await etc.read('/etc/cube');
    expect(r.ok && r.value).toContain('url: http://c/api/');
    expect(r.ok && r.value).toContain('user: chris');
  });

  it('shows "(not connected)" when unset', async () => {
    mockCtx.ChRISURL_get.mockResolvedValue(null);
    mockCtx.ChRISuser_get.mockResolvedValue(null);
    const r = await etc.read('/etc/cube');
    expect(r.ok && r.value).toContain('url: (not connected)');
    expect(r.ok && r.value).toContain('user: (not connected)');
  });
});
