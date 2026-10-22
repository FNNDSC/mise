/**
 * @file `chell --remote <target>` finds a berth by the identity as written.
 *
 * A CUBE daemon writes `user@https://host/api/v1/`; a stratus daemon writes
 * `user@tenancy`, with two `@` when the user is an e-mail address. The target
 * is tried exactly, then as a normalised CUBE identity.
 *
 * @module
 */
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { berth_write, LocalBerthResolver, type Berth } from '@fnndsc/calypso';
import { berthIdentities_of } from '../src/remote/berthTarget.js';

describe('berthIdentities_of', () => {
  it('tries a CUBE target as typed, then normalised', () => {
    expect(berthIdentities_of('chris@cube.example.org')).toEqual(['chris@cube.example.org', 'chris@http://cube.example.org']);
    expect(berthIdentities_of('chris@https://CUBE.example.org/api/v1/')).toEqual([
      'chris@https://CUBE.example.org/api/v1/',
      'chris@https://cube.example.org/api/v1/',
    ]);
  });

  it('keeps a tenancy identity exactly as typed, first', () => {
    expect(berthIdentities_of('rudolph@fnndsc')[0]).toBe('rudolph@fnndsc');
  });

  it('splits a two-@ identity on the last @', () => {
    const candidates: string[] = berthIdentities_of('rudolph.pienaar@childrens.harvard.edu@fnndsc-bch');
    expect(candidates[0]).toBe('rudolph.pienaar@childrens.harvard.edu@fnndsc-bch');
    expect(candidates[1]).toBe('rudolph.pienaar@childrens.harvard.edu@http://fnndsc-bch');
  });

  it('names nothing for a target with no user or no place', () => {
    expect(berthIdentities_of('fnndsc')).toEqual([]);
    expect(berthIdentities_of('@fnndsc')).toEqual([]);
    expect(berthIdentities_of('rudolph@')).toEqual([]);
  });
});

describe('resolving written berths by target', () => {
  const previous: string | undefined = process.env.XDG_RUNTIME_DIR;
  let runtime: string;

  beforeEach(() => {
    runtime = mkdtempSync(join(tmpdir(), 'berth-target-'));
    process.env.XDG_RUNTIME_DIR = runtime;
  });

  afterEach(() => {
    if (previous === undefined) delete process.env.XDG_RUNTIME_DIR;
    else process.env.XDG_RUNTIME_DIR = previous;
    rmSync(runtime, { recursive: true, force: true });
  });

  /** Resolves the first candidate with a berth, the way the client does. */
  async function target_resolve(target: string): Promise<Berth | null> {
    const resolver: LocalBerthResolver = new LocalBerthResolver();
    for (const identity of berthIdentities_of(target)) {
      const berth: Berth | null = await resolver.resolve(identity);
      if (berth) return berth;
    }
    return null;
  }

  it.each([
    ['chris@cube.example.org', 'chris@http://cube.example.org'],
    ['chris@https://cube.example.org/api/v1/', 'chris@https://cube.example.org/api/v1/'],
    ['rudolph@fnndsc', 'rudolph@fnndsc'],
    ['rudolph.pienaar@childrens.harvard.edu@fnndsc-bch', 'rudolph.pienaar@childrens.harvard.edu@fnndsc-bch'],
  ])('finds %s at the berth written for %s', async (target: string, written: string) => {
    berth_write({ identity: written, url: 'ws://127.0.0.1:1', token: 't' });
    const found: Berth | null = await target_resolve(target);
    expect(found?.identity).toBe(written);
  });

  it('finds nothing when no berth matches', async () => {
    berth_write({ identity: 'rudolph@fnndsc', url: 'ws://127.0.0.1:1', token: 't' });
    expect(await target_resolve('rudolph@other')).toBeNull();
  });
});
