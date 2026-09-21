/**
 * @file The idle sweep and the registry's notion of idle: no wire open,
 * nothing through the door for the span.
 */
import { describe, it, expect } from '@jest/globals';
import { SessionRegistry } from '../../src/registry.js';
import { idleSweep_run } from '../../src/sweep.js';

const HOUR: number = 3_600_000;
const berth = { identity: 'chris@https://cube/api/v1/', url: 'ws://127.0.0.1:4444', token: 'T' };

function clock_make(start: number): { now: () => number; advance: (ms: number) => void } {
  let at: number = start;
  return { now: (): number => at, advance: (ms: number): void => { at += ms; } };
}

describe('idle', () => {
  it('is a day with no wire and nothing through the door', async () => {
    const clock = clock_make(1_000_000);
    const registry: SessionRegistry = new SessionRegistry(clock.now);
    const entry = registry.note(berth.identity, 'chris', berth);
    expect(registry.idle_list(24 * HOUR)).toEqual([]);
    clock.advance(25 * HOUR);
    expect(registry.idle_list(24 * HOUR).map((e) => e.key)).toEqual([entry.key]);
  });

  it('is never a session with a wire open, however quiet', () => {
    const clock = clock_make(1_000_000);
    const registry: SessionRegistry = new SessionRegistry(clock.now);
    const entry = registry.note(berth.identity, 'chris', berth);
    registry.wire_count(entry.key, 1);
    clock.advance(48 * HOUR);
    expect(registry.idle_list(24 * HOUR)).toEqual([]);
    registry.wire_count(entry.key, -1);
    expect(registry.idle_list(24 * HOUR)).toEqual([]);
    clock.advance(25 * HOUR);
    expect(registry.idle_list(24 * HOUR).length).toBe(1);
  });

  it('starts the clock again at every request through the door', () => {
    const clock = clock_make(1_000_000);
    const registry: SessionRegistry = new SessionRegistry(clock.now);
    const entry = registry.note(berth.identity, 'chris', berth);
    clock.advance(20 * HOUR);
    registry.activity_note(entry.key);
    clock.advance(20 * HOUR);
    expect(registry.idle_list(24 * HOUR)).toEqual([]);
  });

  it('keeps a session\'s wires when its berth is noted again', () => {
    const registry: SessionRegistry = new SessionRegistry();
    const entry = registry.note(berth.identity, 'chris', berth);
    registry.wire_count(entry.key, 1);
    registry.note(berth.identity, 'chris', { ...berth, token: 'T2' });
    expect(registry.get(entry.key)?.wires).toBe(1);
    expect(registry.get(entry.key)?.berth.token).toBe('T2');
  });
});

describe('idleSweep_run', () => {
  it('ends the idle sessions, forgets them, and says so', async () => {
    const clock = clock_make(1_000_000);
    const registry: SessionRegistry = new SessionRegistry(clock.now);
    const idle = registry.note(berth.identity, 'chris', berth);
    const busy = registry.note('jane@https://cube/api/v1/', 'jane', { ...berth, identity: 'jane@https://cube/api/v1/' });
    registry.wire_count(busy.key, 1);
    clock.advance(25 * HOUR);
    const evicted: string[] = [];
    const said: string[] = [];
    const ended: string[] = await idleSweep_run(registry, { evict: async (identity: string): Promise<boolean> => { evicted.push(identity); return true; } }, 24 * HOUR, (line: string): void => { said.push(line); });
    expect(ended).toEqual([idle.key]);
    expect(evicted).toEqual([berth.identity]);
    expect(registry.get(idle.key)).toBeNull();
    expect(registry.get(busy.key)).not.toBeNull();
    expect(said[0]).toContain("ended chris's session");
    expect(said[0]).toContain('the state directory stays');
  });
});
