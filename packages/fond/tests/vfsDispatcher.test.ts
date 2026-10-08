/**
 * @file fond's dispatcher routes by the longest mount prefix at a segment boundary, and knows no backend.
 */
import { VFSDispatcher } from '../src/vfs/dispatcher';
import type { VFSProvider, VFSItem } from '../src/vfs/provider';
import { vfsItems_sort } from '../src/vfs/sort';
import { errorStack } from '../src/errorStack';
import { Ok, type Result } from '../src/result';

const item = (name: string, size: number = 1): VFSItem => ({ name, type: 'file', size, owner: 'o', date: '2026-10-08' });

/** A mount that lists one item named for itself, and records what it was asked. */
const mount = (prefix: string, seen: string[], extra: Partial<VFSProvider> = {}): VFSProvider => ({
  prefix,
  async list(path: string): Promise<Result<VFSItem[]>> { seen.push(`${prefix || 'fallback'}:list:${path}`); return Ok([item(prefix || 'fallback')]); },
  async cp(src: string, dest: string): Promise<boolean> { seen.push(`${prefix || 'fallback'}:cp:${src}>${dest}`); return true; },
  ...extra,
});

beforeEach(() => errorStack.stack_clear());

describe('VFSDispatcher', () => {
  it('routes to the longest prefix that matches at a segment boundary, else the fallback', () => {
    const seen: string[] = [];
    const fallback = mount('', seen);
    const d = new VFSDispatcher(fallback);
    const proc = mount('/proc', seen);
    const jobs = mount('/proc/jobs', seen);
    d.provider_register(proc);
    d.provider_register(jobs);
    expect(d.provider_get('/proc/jobs/feed_1')).toBe(jobs);
    expect(d.provider_get('/proc/tags')).toBe(proc);
    expect(d.provider_get('/proc')).toBe(proc);
    expect(d.provider_get('/procs')).toBe(fallback);
    expect(d.provider_get('home/u')).toBe(fallback);
    expect(d.providers_get()).toEqual([jobs, proc]);
  });

  it('lists a parent of mounts as the mounts beneath it, beside what the fallback holds there', async () => {
    const seen: string[] = [];
    const d = new VFSDispatcher(mount('', seen));
    d.provider_register(mount('/net/pacs', seen));
    const top: Result<VFSItem[]> = await d.list('/net');
    expect(top.ok && top.value.map((i: VFSItem) => `${i.name}:${i.type}`)).toEqual(['pacs:vfs', 'fallback:file']);
    expect(d.path_isVirtual('/net')).toBe(true);
    expect(d.path_isVirtual('/net/pacs/q')).toBe(true);
    expect(d.path_isVirtual('/')).toBe(false);
    expect(d.path_isVirtual('/home')).toBe(false);
  });

  it('with no fallback given, a path no mount claims is refused by name, not answered as an empty folder', async () => {
    const d = new VFSDispatcher();
    expect((await d.list('/anywhere')).ok).toBe(false);
    expect(errorStack.stack_pop()?.message).toContain('No mount serves /anywhere');
    expect(await d.cp('/a', '/b', {})).toBe(false);
  });

  it('a fallback path goes through the path resolver; a copy whose path cannot resolve fails rather than guessing', async () => {
    const seen: string[] = [];
    const d = new VFSDispatcher(mount('', seen));
    d.pathResolver_register(async (p: string): Promise<string> => { if (p === '/bad') throw new Error('unknown'); return `/real${p}`; });
    await d.list('/home');
    expect(seen).toContain('fallback:list:/real/home');
    expect(await d.cp('/a', '/b', {})).toBe(true);
    expect(seen).toContain('fallback:cp:/real/a>/real/b');
    expect(await d.cp('/bad', '/b', {})).toBe(false);
    expect(errorStack.stack_pop()?.message).toContain('cannot resolve source path /bad');
  });

  it('read, write, mkdir, rmdir and rename go to a mount that offers them, and are refused by name elsewhere', async () => {
    const seen: string[] = [];
    const notes = mount('/notes', seen, {
      async read(): Promise<Result<string>> { return Ok('text'); },
      async write(): Promise<boolean> { return true; },
      async mkdir(): Promise<boolean> { return true; },
      async rmdir(): Promise<boolean> { return true; },
      async rename(): Promise<boolean> { return true; },
      async readBinary(): Promise<Result<Buffer>> { return Ok(Buffer.from('b')); },
      async linkTarget_resolve(): Promise<Result<string>> { return Ok('/there'); },
    });
    const d = new VFSDispatcher(mount('', seen));
    d.provider_register(notes);
    expect(await d.read('/notes/a')).toEqual(Ok('text'));
    expect(await d.write('/notes/a', 'x')).toBe(true);
    expect(await d.mkdir('/notes/d')).toBe(true);
    expect(await d.rmdir('/notes/d')).toBe(true);
    expect(await d.rename('/notes/a', '/notes/b')).toBe(true);
    expect((await d.readBinary('/notes/a')).ok).toBe(true);
    expect(await d.linkTarget_resolve('/notes/l')).toEqual(Ok('/there'));
    expect(await d.rename('/notes/a', '/home/b')).toBe(false);
    expect(errorStack.stack_pop()?.message).toContain('Invalid cross-device link');
    expect((await d.read('/home/a')).ok).toBe(false);
    expect(await d.write('/home/a', 'x')).toBe(false);
    expect(await d.mkdir('/home/d')).toBe(false);
    expect(await d.rmdir('/home/d')).toBe(false);
    expect((await d.readBinary('/home/a')).ok).toBe(false);
    expect((await d.linkTarget_resolve('/home/l')).ok).toBe(false);
  });
});

describe('vfsItems_sort', () => {
  it('sorts by a field without changing the array given, and reverses on request', () => {
    const items: VFSItem[] = [item('b', 2), item('a', 3), item('c', 1)];
    expect(vfsItems_sort(items).map((i: VFSItem) => i.name)).toEqual(['a', 'b', 'c']);
    expect(vfsItems_sort(items, 'size', true).map((i: VFSItem) => i.name)).toEqual(['a', 'b', 'c']);
    expect(items.map((i: VFSItem) => i.name)).toEqual(['b', 'a', 'c']);
  });
});
