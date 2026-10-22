/**
 * @file `capacity`: the limits a shape family draws on, per zone, free and
 * permitted, with the model the CAPACITY tile draws.
 */
import { describe, it, expect } from '@jest/globals';
import { FakeDriver, fakeCloud_sample } from '../src/cloud/fake/driver.js';
import { capacity_run, capacityRows_read, specFamily_of, CAPACITY_HELP } from '../src/commands/capacity.js';
import { DomainTree } from '../src/vfs/domains.js';
import { harborCheckout_make } from './support/harborCheckout.js';

const plain = (text: string): string => text.replace(/\x1b\[[0-9;]*m/g, '');
const context_make = (roots: Record<string, string>, region: string | null = 'us-ashburn-1') => ({
  domains: new DomainTree({ sources: Object.entries(roots).map(([name, root]) => ({ name, root })), owner: (): string => 'rudolph', now: (): Date => new Date('2026-10-21T12:00:00Z') }),
  driver: new FakeDriver(fakeCloud_sample()),
  region: (): string | null => region,
});

describe('capacity', () => {
  it('reads the family a spec names', () => {
    expect(specFamily_of('# spec\nfamily: E5   # every node\n')).toBe('E5');
    expect(specFamily_of('controlPlane:\n  count: 3\n')).toBeNull();
    expect(specFamily_of(null)).toBeNull();
  });

  it('reads each limit a family\'s shapes draw on at every zone, free where the cloud says', async () => {
    const rows = await capacityRows_read(new FakeDriver(fakeCloud_sample()), 'us-ashburn-1', ['e5']);
    expect(rows).toHaveLength(6);
    expect(rows[0]).toEqual({ family: 'e5', limit: 'standard-e5-core-count', zone: 'Uocm:US-ASHBURN-AD-1', value: 9250, used: 12, available: 9238 });
    expect(rows[1]).toEqual({ family: 'e5', limit: 'standard-e5-core-count', zone: 'Uocm:US-ASHBURN-AD-2', value: 9250, used: null, available: null });
    expect(await capacityRows_read(new FakeDriver(fakeCloud_sample()), 'us-ashburn-1', ['Z9'])).toEqual([]);
  });

  it('takes the families the domains\' specs name, and answers lines with the model', async () => {
    const answer = await capacity_run(context_make({ harbor: harborCheckout_make() }), []);
    const lines = plain(answer.rendered).split('\n');
    expect(lines[0]).toBe('capacity in us-ashburn-1');
    expect(lines[1]).toBe('E5    standard-e5-core-count    Uocm:US-ASHBURN-AD-1  9238 of 9250 free');
    expect(lines[2]).toBe('E5    standard-e5-core-count    Uocm:US-ASHBURN-AD-2  9250 permitted, use not reported');
    expect(answer.model?.kind).toBe('stratus.capacity');
    expect((answer.model?.data as { region: string; rows: unknown[] }).rows).toHaveLength(6);
  });

  it('takes families named, says when none has limits, and refuses with no family or no connection', async () => {
    const named = await capacity_run(context_make({}), ['E5']);
    expect(plain(named.rendered).split('\n')).toHaveLength(8);
    const none = await capacity_run(context_make({}), ['Z9']);
    expect(none.rendered).toBe('capacity in us-ashburn-1: no limits for Z9\n');
    expect((await capacity_run(context_make({}), [])).renderedErr).toBe('capacity: name a shape family (capacity E5); no domain\'s spec names one\n');
    expect((await capacity_run(context_make({}, null), ['E5'])).renderedErr).toBe('capacity: not connected\n');
    expect(CAPACITY_HELP.category).toBe('Resources');
  });
});
