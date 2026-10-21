/**
 * @file The driver contract: what every cloud driver must answer, run by the
 * fake and by the OCI driver over recorded answers (docs/stratus.adoc, D1).
 *
 * The suite asks only what the interface promises, in the words the
 * interface uses, so a new driver is proven by running it and nothing else.
 */
import { describe, it, expect } from '@jest/globals';
import type { CloudContainer, CloudDriver, CloudIdentity, CloudLimit, CloudPrice, CloudShape, CloudZone } from '../../src/cloud/driver.js';

/**
 * Describes the contract for one driver.
 *
 * @param name - The driver's name, for the suite's title.
 * @param driver_make - Makes a fresh driver.
 */
export function driverContract_describe(name: string, driver_make: () => Promise<CloudDriver> | CloudDriver): void {
  describe(`${name} keeps the driver contract`, () => {
    it('names its cloud with one lower-case word, the mount under /net', async () => {
      const driver: CloudDriver = await driver_make();
      expect(driver.cloud).toMatch(/^[a-z][a-z0-9]*$/);
    });

    it('knows who the credential is and where its home is', async () => {
      const driver: CloudDriver = await driver_make();
      const identity: CloudIdentity = await driver.identity_get();
      expect(identity.user).not.toBe('');
      expect(identity.tenancy).not.toBe('');
      expect(identity.tenancyId).not.toBe('');
      expect(identity.homeRegion).not.toBe('');
    });

    it('has a root container with no parent, whose id is the tenancy id', async () => {
      const driver: CloudDriver = await driver_make();
      const root: CloudContainer = await driver.root_get();
      const identity: CloudIdentity = await driver.identity_get();
      expect(root.parentId).toBeNull();
      expect(root.id).toBe(identity.tenancyId);
      expect(root.name).toBe(identity.tenancy);
      expect(root.noun).not.toBe('');
    });

    it('lists the containers inside one, each naming it as parent, sorted by name, none deleted', async () => {
      const driver: CloudDriver = await driver_make();
      const root: CloudContainer = await driver.root_get();
      const children: CloudContainer[] = await driver.containers_list(root.id);
      for (const child of children) {
        expect(child.parentId).toBe(root.id);
        expect(child.state).toBe(child.state.toLowerCase());
        expect(child.state).not.toBe('deleted');
        expect(typeof child.tags).toBe('object');
      }
      expect(children.map((child: CloudContainer): string => child.name)).toEqual([...children.map((child: CloudContainer): string => child.name)].sort((a: string, b: string): number => a.localeCompare(b)));
    });

    it('lists the regions, the home region among them, and the zones of each', async () => {
      const driver: CloudDriver = await driver_make();
      const identity: CloudIdentity = await driver.identity_get();
      const regions: string[] = await driver.regions_list();
      expect(regions).toContain(identity.homeRegion);
      const zones: CloudZone[] = await driver.zones_list(identity.homeRegion);
      expect(zones.length).toBeGreaterThan(0);
      for (const zone of zones) expect(zone.name).not.toBe('');
    });

    it('lists limit services sorted, and each service\'s limits at a valid scope', async () => {
      const driver: CloudDriver = await driver_make();
      const identity: CloudIdentity = await driver.identity_get();
      const services: string[] = await driver.limitServices_list(identity.homeRegion);
      expect(services).toEqual([...services].sort());
      expect(services.length).toBeGreaterThan(0);
      const limits: CloudLimit[] = await driver.limits_list(identity.homeRegion, services[0]);
      for (const limit of limits) {
        expect(limit.service).toBe(services[0]);
        expect(['global', 'region', 'zone']).toContain(limit.scope);
        expect(limit.zone !== undefined).toBe(limit.scope === 'zone');
        expect(typeof limit.value).toBe('number');
      }
    });

    it('says how much of a limit is used and left, or null', async () => {
      const driver: CloudDriver = await driver_make();
      const identity: CloudIdentity = await driver.identity_get();
      const services: string[] = await driver.limitServices_list(identity.homeRegion);
      const limits: CloudLimit[] = await driver.limits_list(identity.homeRegion, services[0]);
      if (limits.length === 0) return;
      const availability = await driver.limitAvailability_get(identity.homeRegion, limits[0].service, limits[0].name, limits[0].zone);
      if (availability !== null) {
        expect(typeof availability.used).toBe('number');
        expect(typeof availability.available).toBe('number');
      }
    });

    it('lists shapes with a family and ranges in vCPU and GiB, sorted by name', async () => {
      const driver: CloudDriver = await driver_make();
      const identity: CloudIdentity = await driver.identity_get();
      const shapes: CloudShape[] = await driver.shapes_list(identity.homeRegion);
      expect(shapes.length).toBeGreaterThan(0);
      for (const shape of shapes) {
        expect(shape.family).not.toBe('');
        expect(shape.cores.min).toBeLessThanOrEqual(shape.cores.max);
        expect(shape.memoryGib.min).toBeLessThanOrEqual(shape.memoryGib.max);
        expect(shape.vcpuPerCore).toBeGreaterThan(0);
      }
      expect(shapes.map((shape: CloudShape): string => shape.name)).toEqual([...shapes.map((shape: CloudShape): string => shape.name)].sort((a: string, b: string): number => a.localeCompare(b)));
    });

    it('prices shapes per hour in one currency', async () => {
      const driver: CloudDriver = await driver_make();
      const prices: CloudPrice[] = await driver.prices_list();
      for (const price of prices) {
        expect(price.vcpuHour).toBeGreaterThan(0);
        expect(price.gibHour).toBeGreaterThan(0);
        expect(price.currency).toMatch(/^[A-Z]{3}$/);
      }
    });
  });
}
