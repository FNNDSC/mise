/**
 * @file Tests for the VFS dispatcher: provider matching, virtual parent
 * synthesis, path-resolver hooks and read dispatch. Providers are mocked
 * with prefix-carrying fakes.
 */

const providerFns = {
  nativeList: jest.fn(),
  nativeCp: jest.fn(),
  pacsList: jest.fn(),
  pacsCp: jest.fn(),
  pacsRead: jest.fn(),
  pacsReadBinary: jest.fn(),
  etcList: jest.fn(),
};

jest.mock('../src/vfs/providers/native', () => ({
  NativeVfsProvider: class {
    prefix: string = '/';
    list(...args: unknown[]): Promise<unknown> { return providerFns.nativeList(...args); }
    cp(...args: unknown[]): Promise<unknown> { return providerFns.nativeCp(...args); }
  },
}));
jest.mock('../src/vfs/providers/pacs', () => ({
  PacsVfsProvider: class {
    prefix: string = '/net/pacs';
    list(...args: unknown[]): Promise<unknown> { return providerFns.pacsList(...args); }
    cp(...args: unknown[]): Promise<unknown> { return providerFns.pacsCp(...args); }
    read(...args: unknown[]): Promise<unknown> { return providerFns.pacsRead(...args); }
    readBinary(...args: unknown[]): Promise<unknown> { return providerFns.pacsReadBinary(...args); }
  },
}));
jest.mock('../src/vfs/providers/etc', () => ({
  EtcVfsProvider: class {
    prefix: string = '/etc';
    list(...args: unknown[]): Promise<unknown> { return providerFns.etcList(...args); }
  },
}));
jest.mock('../src/vfs/providers/proc', () => ({
  ProcVfsProvider: class {
    prefix: string = '/proc';
    list(): Promise<unknown> { return Promise.resolve({ ok: true, value: [] }); }
  },
}));

let mockStackPush: jest.Mock;
jest.mock('@fnndsc/cumin', () => ({
  Ok: <T>(value: T): { ok: true; value: T } => ({ ok: true, value }),
  Err: (): { ok: false } => ({ ok: false }),
  errorStack: { stack_push: (...args: unknown[]): unknown => mockStackPush(...args) },
}));

import { VFSDispatcher } from '../src/vfs/dispatcher';
import { VFSItem } from '../src/vfs/provider';

const item = (name: string): VFSItem => ({
  name, type: 'file', size: 1, owner: 'chris', date: '2026-07-03',
} as unknown as VFSItem);

beforeEach(() => {
  jest.clearAllMocks();
  mockStackPush = jest.fn();
  Object.values(providerFns).forEach((fn: jest.Mock) => fn.mockReset());
});

describe('provider matching', () => {
  it('routes prefixed paths to their provider and everything else to native', () => {
    const d: VFSDispatcher = new VFSDispatcher();
    expect(d.provider_get('/net/pacs/queries').prefix).toBe('/net/pacs');
    expect(d.provider_get('/etc').prefix).toBe('/etc');
    expect(d.provider_get('/home/chris').prefix).toBe('/');
    expect(d.provider_get('relative/path').prefix).toBe('/');
  });

  it('prefers the most specific prefix after registration', () => {
    const d: VFSDispatcher = new VFSDispatcher();
    d.provider_register({
      prefix: '/net/pacs/queries',
      list: jest.fn(),
      cp: jest.fn(),
    } as never);
    expect(d.provider_get('/net/pacs/queries/q1').prefix).toBe('/net/pacs/queries');
    expect(d.provider_get('/net/pacs/other').prefix).toBe('/net/pacs');
    expect(d.providers_get().length).toBe(4);
  });
});

describe('list', () => {
  it('synthesizes virtual subdirs at the root and merges native items', async () => {
    providerFns.nativeList.mockResolvedValue({ ok: true, value: [item('home'), item('etc')] });
    const d: VFSDispatcher = new VFSDispatcher();
    const result = await d.list('/');
    expect(result.ok).toBe(true);
    if (result.ok) {
      const names: string[] = result.value.map((i: VFSItem) => i.name).sort();
      // 'etc' from native is deduplicated against the virtual 'etc'
      expect(names).toEqual(['etc', 'home', 'net', 'proc']);
    }
  });

  it('synthesizes the next segment for an intermediate virtual parent', async () => {
    providerFns.nativeList.mockResolvedValue({ ok: false });
    const d: VFSDispatcher = new VFSDispatcher();
    const result = await d.list('/net');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.map((i: VFSItem) => i.name)).toEqual(['pacs']);
  });

  it('applies the path resolver for native paths and falls back on throw', async () => {
    providerFns.nativeList.mockResolvedValue({ ok: true, value: [] });
    const d: VFSDispatcher = new VFSDispatcher();
    d.pathResolver_register(async (p: string) => `/resolved${p}`);
    await d.list('/home/chris');
    expect(providerFns.nativeList).toHaveBeenCalledWith('/resolved/home/chris', undefined);

    d.pathResolver_register(async () => { throw new Error('no map'); });
    await d.list('/home/chris');
    expect(providerFns.nativeList).toHaveBeenLastCalledWith('/home/chris', undefined);
  });

  it('dispatches provider-prefixed paths straight to the provider', async () => {
    providerFns.pacsList.mockResolvedValue({ ok: true, value: [item('q1')] });
    const d: VFSDispatcher = new VFSDispatcher();
    const result = await d.list('/net/pacs/queries');
    expect(result.ok).toBe(true);
    expect(providerFns.pacsList).toHaveBeenCalledWith('/net/pacs/queries', undefined);
  });
});

describe('cp', () => {
  it('resolves both endpoints for native copies', async () => {
    providerFns.nativeCp.mockResolvedValue(true);
    const d: VFSDispatcher = new VFSDispatcher();
    d.pathResolver_register(async (p: string) => `/r${p}`);
    expect(await d.cp('/a', '/b', {} as never)).toBe(true);
    expect(providerFns.nativeCp).toHaveBeenCalledWith('/r/a', '/r/b', {});
  });

  it('dispatches provider-prefixed sources to the provider', async () => {
    providerFns.pacsCp.mockResolvedValue(true);
    const d: VFSDispatcher = new VFSDispatcher();
    expect(await d.cp('/net/pacs/queries/q1', '/home/chris', {} as never)).toBe(true);
    expect(providerFns.pacsCp).toHaveBeenCalledWith('/net/pacs/queries/q1', '/home/chris', {});
  });
});

describe('read and readBinary', () => {
  it('dispatches reads to providers that support them', async () => {
    providerFns.pacsRead.mockResolvedValue({ ok: true, value: 'text' });
    providerFns.pacsReadBinary.mockResolvedValue({ ok: true, value: Buffer.from('b') });
    const d: VFSDispatcher = new VFSDispatcher();
    expect((await d.read('/net/pacs/queries/f.txt')).ok).toBe(true);
    expect((await d.readBinary('/net/pacs/queries/f.dcm')).ok).toBe(true);
  });

  it('errors for native paths and providers without read support', async () => {
    const d: VFSDispatcher = new VFSDispatcher();
    expect((await d.read('/home/chris/f.txt')).ok).toBe(false);
    expect(mockStackPush).toHaveBeenCalledWith('error', expect.stringContaining('File read not supported'));

    expect((await d.readBinary('/etc/motd')).ok).toBe(false);
    expect(mockStackPush).toHaveBeenCalledWith('error', expect.stringContaining('Binary file read not supported'));
  });
});
