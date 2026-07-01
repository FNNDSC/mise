/**
 * Boundary-only tests for EtcVfsProvider. Real Ok/Err/errorStack; the cumin
 * resource getters and chrisContext are stubbed.
 */
const mockCompute = jest.fn();
const mockGroups = jest.fn();
const mockUser = jest.fn();
const mockCtx = { ChRISURL_get: jest.fn(), ChRISuser_get: jest.fn() };

jest.mock('@fnndsc/cumin', () => {
  const actual = jest.requireActual('@fnndsc/cumin');
  return {
    ...actual,
    computeResources_getAll: mockCompute,
    groups_getAll: mockGroups,
    currentUser_get: mockUser,
    chrisContext: mockCtx,
  };
});

import { Ok, Err, errorStack } from '@fnndsc/cumin';
import { EtcVfsProvider } from '../src/vfs/providers/etc';

const etc = new EtcVfsProvider();

beforeEach(() => {
  jest.clearAllMocks();
  errorStack.stack_clear();
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
  it('renders /etc/group lines', async () => {
    mockGroups.mockResolvedValue(Ok([{ name: 'all_users', id: 1 }]));
    const r = await etc.read('/etc/group');
    expect(r.ok && r.value).toBe('all_users:x:1:\n');
  });

  it('errors when the fetch fails', async () => {
    mockGroups.mockResolvedValue(Err());
    expect((await etc.read('/etc/group')).ok).toBe(false);
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
