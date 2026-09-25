/**
 * @file Chance that comes out the same every time: the hash and the
 * generator are pinned, since changing either would turn every molecule in
 * every operator's universe at once.
 */
import { describe, it, expect } from '@jest/globals';
import { hash_of, random_seeded, randomFor_key } from '../src/layout/seeded.js';

describe('seeded chance', () => {
  it('hashes as FNV-1a, stably', () => {
    expect(hash_of('')).toBe(0x811c9dc5);
    expect(hash_of('feed:1603')).toBe(hash_of('feed:1603'));
    expect(hash_of('feed:1603')).not.toBe(hash_of('feed:1604'));
    expect(hash_of('a')).toBe(0xe40c292c);
  });

  it('draws the same run from the same seed, within [0, 1)', () => {
    const a = random_seeded(42);
    const b = random_seeded(42);
    const run: number[] = Array.from({ length: 5 }, () => a());
    expect(run).toEqual(Array.from({ length: 5 }, () => b()));
    for (const value of run) { expect(value).toBeGreaterThanOrEqual(0); expect(value).toBeLessThan(1); }
    expect(random_seeded(1)()).toBe(1015568748 / 4294967296);
  });

  it('gives each key its own run, the same every time', () => {
    expect(randomFor_key('feed:7')()).toBe(randomFor_key('feed:7')());
    expect(randomFor_key('feed:7')()).not.toBe(randomFor_key('feed:8')());
  });
});
