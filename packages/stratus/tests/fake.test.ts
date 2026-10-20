/**
 * @file The fake cloud keeps the driver contract, and counts what it is asked.
 */
import { describe, it, expect } from '@jest/globals';
import { FakeDriver, fakeCloud_sample, availabilityKey_make } from '../src/cloud/fake/driver.js';
import { driverContract_describe } from './support/driverContract.js';

driverContract_describe('the fake cloud', () => new FakeDriver(fakeCloud_sample()));

describe('the fake cloud', () => {
  it('nests containers and answers availability by key', async () => {
    const driver = new FakeDriver(fakeCloud_sample('acme'));
    const root = await driver.root_get();
    expect(root.name).toBe('acme');
    const sandbox = (await driver.containers_list(root.id)).find((c) => c.name === 'sandbox');
    expect(sandbox).toBeDefined();
    expect((await driver.containers_list(sandbox!.id)).map((c) => c.name)).toEqual(['scratch-a']);
    expect(await driver.limitAvailability_get('us-ashburn-1', 'vcn', 'vcn-count')).toEqual({ used: 1, available: 49 });
    expect(await driver.limitAvailability_get('us-ashburn-1', 'vcn', 'nothing')).toBeNull();
    expect(availabilityKey_make('r', 's', 'n')).toBe('r/s/n');
    expect(availabilityKey_make('r', 's', 'n', 'z')).toBe('r/s/n/z');
    expect(driver.calls['containers_list']).toBe(2);
  });

  it('refuses a fixture with no root', async () => {
    const cloud = fakeCloud_sample();
    const driver = new FakeDriver({ ...cloud, containers: cloud.containers.filter((c) => c.parentId !== null) });
    await expect(driver.root_get()).rejects.toThrow('no root container');
  });

  it('answers an unknown region with nothing', async () => {
    const driver = new FakeDriver(fakeCloud_sample());
    expect(await driver.zones_list('eu-nowhere-1')).toEqual([]);
    expect(await driver.limitServices_list('eu-nowhere-1')).toEqual([]);
    expect(await driver.limits_list('eu-nowhere-1', 'compute')).toEqual([]);
    expect(await driver.shapes_list('eu-nowhere-1')).toEqual([]);
  });
});
