/**
 * @file The dormant set of link groups: LRU-capped, persisted, forgettable.
 *
 * A group that leaves the stage is snapshotted here so the PANES view can
 * bring it back. The set keeps the most recent, evicts the oldest past its
 * cap, survives a reload through an injected store, and forgets only on an
 * explicit dismiss.
 *
 * @module
 */
import { describe, it, expect } from '@jest/globals';
import { DormantRegistry, type GroupSnapshot, type KeyStore } from '../../src/app/dormant';

/** A snapshot with a given id and recency. */
function snap(id: string, lastTouched: number, extra: Partial<GroupSnapshot> = {}): GroupSnapshot {
  return { id, label: id, regard: { address: id, modelKind: 'dicom.series' }, members: ['viewer'], lastTouched, ...extra };
}

/** An in-memory KeyStore, standing in for localStorage. */
function memoryStore(): KeyStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k): string | null => data.get(k) ?? null, setItem: (k, v): void => { data.set(k, v); } };
}

describe('DormantRegistry', () => {
  it('keeps groups newest-first and reads one back by id', () => {
    const reg = new DormantRegistry(24);
    reg.add(snap('a', 100));
    reg.add(snap('b', 200));
    expect(reg.list().map((s): string => s.id)).toEqual(['b', 'a']);
    expect(reg.get('a')?.label).toBe('a');
    expect(reg.has('b')).toBe(true);
    expect(reg.get('z')).toBeUndefined();
  });

  it('refreshes a group in place rather than duplicating it', () => {
    const reg = new DormantRegistry(24);
    reg.add(snap('a', 100, { members: ['viewer'] }));
    reg.add(snap('a', 300, { members: ['viewer', 'tags'] }));
    expect(reg.list()).toHaveLength(1);
    expect(reg.get('a')?.members).toEqual(['viewer', 'tags']);
    expect(reg.get('a')?.lastTouched).toBe(300);
  });

  it('evicts the least-recently-dormant past the cap', () => {
    const reg = new DormantRegistry(2);
    reg.add(snap('a', 100));
    reg.add(snap('b', 200));
    reg.add(snap('c', 300));
    expect(reg.list().map((s): string => s.id)).toEqual(['c', 'b']);
    expect(reg.has('a')).toBe(false);
  });

  it('forgets only on dismiss', () => {
    const reg = new DormantRegistry(24);
    reg.add(snap('a', 100));
    expect(reg.dismiss('a')).toBe(true);
    expect(reg.dismiss('a')).toBe(false);
    expect(reg.list()).toHaveLength(0);
  });

  it('persists to the store and rehydrates dormant on construction', () => {
    const store = memoryStore();
    const first = new DormantRegistry(24, store);
    first.add(snap('a', 100, { view: { layout: 'mpr', slice: 7, colormap: 'hot' } }));
    first.add(snap('b', 200));
    // A fresh registry over the same store comes back with the same groups.
    const second = new DormantRegistry(24, store);
    expect(second.list().map((s): string => s.id)).toEqual(['b', 'a']);
    expect(second.get('a')?.view).toEqual({ layout: 'mpr', slice: 7, colormap: 'hot' });
    // A dismiss persists too.
    second.dismiss('b');
    const third = new DormantRegistry(24, store);
    expect(third.has('b')).toBe(false);
  });

  it('survives a store that throws, keeping the set in memory', () => {
    const throwing: KeyStore = { getItem: (): string | null => { throw new Error('blocked'); }, setItem: (): void => { throw new Error('blocked'); } };
    const reg = new DormantRegistry(24, throwing);
    expect(() => reg.add(snap('a', 100))).not.toThrow();
    expect(reg.has('a')).toBe(true);
  });

  it('ignores unreadable stored data rather than throwing on boot', () => {
    const store = memoryStore();
    store.data.set('argus.dormant', '{not json');
    expect(() => new DormantRegistry(24, store)).not.toThrow();
    expect(new DormantRegistry(24, store).list()).toHaveLength(0);
  });
});
