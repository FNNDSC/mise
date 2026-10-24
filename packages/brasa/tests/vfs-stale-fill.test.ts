/**
 * @file A listing read that a change overtakes is not kept.
 *
 * An `ls` (or a pane's refresh) that is out to CUBE when an `rm -r` lands
 * brings back the folder as it was. Kept, it served the removed folder for
 * the cache's lifetime: the smoke suite's place-verbs flake, and an `ls ~`
 * that still listed `smoke-place/` minutes after `cd` said it was gone.
 */
import { describe, it, expect, jest, beforeEach } from '@jest/globals';

jest.unstable_mockModule('../src/session/index.js', () => ({
  session: { getCWD: async (): Promise<string> => '/home/u' },
}));

/**
 * A listing cache with the stamp rule cumin's keeps (cumin's own tests pin
 * the real one): a listing fetched before its folder was invalidated is not
 * kept. What this file pins is that the VFS takes the stamp and hands it back.
 */
function cache_make() {
  const kept: Map<string, unknown> = new Map();
  const invalidatedAt: Map<string, number> = new Map();
  let invalidations: number = 0;
  return {
    cache_get: <T>(path: string): { data: T; fresh: boolean } | null => (kept.has(path) ? { data: kept.get(path) as T, fresh: true } : null),
    cache_set: (path: string, data: unknown, options?: { since?: number }): void => {
      if (options?.since !== undefined && (invalidatedAt.get(path) ?? 0) > options.since) return;
      kept.set(path, data);
    },
    cache_invalidate: (path?: string): void => { invalidations += 1; if (path === undefined) kept.clear(); else { kept.delete(path); invalidatedAt.set(path, invalidations); } },
    cache_invalidateTree: (path: string): void => { invalidations += 1; kept.delete(path); invalidatedAt.set(path, invalidations); },
    stamp_take: (): number => invalidations,
  };
}
const cache = cache_make();
const listCache_get = (): typeof cache => cache;

const { backend_install } = await import('../src/core/backend.js');
const { VFS } = await import('../src/lib/vfs/vfs.js');

/** The folder's contents CUBE holds now. */
let held: string[] = [];
/** Lets the listing in flight come back; set while one is out. */
let release: (() => void) | null = null;

backend_install({
  id: 'test',
  session: {} as never,
  vfs: {
    dispatcher: {
      list: async (): Promise<{ ok: true; value: Array<{ name: string; type: string; size: number; owner: string; date: string }> }> => {
        // The folder as it was when the read went out.
        const asked: string[] = [...held];
        await new Promise<void>((resolve: () => void): void => { release = resolve; });
        return { ok: true, value: asked.map((name: string) => ({ name, type: 'dir', size: 0, owner: 'u', date: '' })) };
      },
    } as never,
    cache: listCache_get(),
  },
} as never);

beforeEach((): void => {
  listCache_get().cache_invalidate();
  held = ['smoke-place', 'feeds'];
  release = null;
});

describe('a listing read overtaken by a change', () => {
  it('is answered, but not kept, when its folder changed while it was out', async () => {
    const reading = new VFS().data_get('/home/u');
    await new Promise((r) => setTimeout(r, 0));
    // rm -r ~/smoke-place lands while the read is out.
    held = ['feeds'];
    listCache_get().cache_invalidate('/home/u');
    listCache_get().cache_invalidateTree('/home/u/smoke-place');
    release?.();
    const first = await reading;
    expect(first.ok).toBe(true);
    expect(listCache_get().cache_get('/home/u')).toBeNull();
    // The next ls reads CUBE again, and sees the folder gone.
    const again = new VFS().data_get('/home/u');
    await new Promise((r) => setTimeout(r, 0));
    release?.();
    const second = await again;
    expect(second.ok && second.value.map((item) => item.name)).toEqual(['feeds']);
  });

  it('is kept when nothing changed while it was out', async () => {
    const reading = new VFS().data_get('/home/u');
    await new Promise((r) => setTimeout(r, 0));
    release?.();
    await reading;
    expect(listCache_get().cache_get<Array<{ name: string }>>('/home/u')?.data.map((item) => item.name)).toEqual(['smoke-place', 'feeds']);
  });
});
