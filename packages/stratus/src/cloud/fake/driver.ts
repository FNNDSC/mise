/**
 * @file The fake cloud: a driver over a fixture in memory.
 *
 * It runs the same contract suite the OCI driver runs, so the driver
 * interface stays honest with one real cloud (docs/stratus.adoc, D1), and it
 * is what the boot proof and the unit tests host a session over.
 *
 * @module
 */
import type { CloudAvailability, CloudContainer, CloudDriver, CloudIdentity, CloudLimit, CloudPrice, CloudShape, CloudZone } from '../driver.js';

/** What a fake cloud holds. */
export interface FakeCloud {
  readonly identity: CloudIdentity;
  /** Every container, the root among them (its `parentId` null). */
  readonly containers: ReadonlyArray<CloudContainer>;
  readonly regions: ReadonlyArray<string>;
  /** Zones by region. */
  readonly zones: Readonly<Record<string, ReadonlyArray<CloudZone>>>;
  /** Limits by region. */
  readonly limits: Readonly<Record<string, ReadonlyArray<CloudLimit>>>;
  /** Availability by `region/service/name[/zone]`. */
  readonly availability: Readonly<Record<string, CloudAvailability>>;
  /** Shapes by region. */
  readonly shapes: Readonly<Record<string, ReadonlyArray<CloudShape>>>;
  readonly prices: ReadonlyArray<CloudPrice>;
}

/** The key an availability is kept under. */
export function availabilityKey_make(region: string, service: string, name: string, zone?: string): string {
  return zone === undefined ? `${region}/${service}/${name}` : `${region}/${service}/${name}/${zone}`;
}

/** A driver over a fixture. */
export class FakeDriver implements CloudDriver {
  readonly cloud: string;
  private readonly cloudData: FakeCloud;
  /** How often each method was asked; the tests read it to prove caching. */
  readonly calls: Record<string, number> = {};

  constructor(cloudData: FakeCloud, cloud: string = 'oci') {
    this.cloudData = cloudData;
    this.cloud = cloud;
  }

  private call_count(method: string): void {
    this.calls[method] = (this.calls[method] ?? 0) + 1;
  }

  async identity_get(): Promise<CloudIdentity> {
    this.call_count('identity_get');
    return this.cloudData.identity;
  }

  async root_get(): Promise<CloudContainer> {
    this.call_count('root_get');
    const root: CloudContainer | undefined = this.cloudData.containers.find((container: CloudContainer): boolean => container.parentId === null);
    if (root === undefined) throw new Error('fake cloud: no root container');
    return root;
  }

  async containers_list(parentId: string): Promise<CloudContainer[]> {
    this.call_count('containers_list');
    return this.cloudData.containers
      .filter((container: CloudContainer): boolean => container.parentId === parentId)
      .sort((a: CloudContainer, b: CloudContainer): number => a.name.localeCompare(b.name));
  }

  async regions_list(): Promise<string[]> {
    this.call_count('regions_list');
    return [...this.cloudData.regions];
  }

  async zones_list(region: string): Promise<CloudZone[]> {
    this.call_count('zones_list');
    return [...(this.cloudData.zones[region] ?? [])];
  }

  async limitServices_list(region: string): Promise<string[]> {
    this.call_count('limitServices_list');
    const services: Set<string> = new Set((this.cloudData.limits[region] ?? []).map((limit: CloudLimit): string => limit.service));
    return [...services].sort();
  }

  async limits_list(region: string, service: string): Promise<CloudLimit[]> {
    this.call_count('limits_list');
    return (this.cloudData.limits[region] ?? []).filter((limit: CloudLimit): boolean => limit.service === service);
  }

  async limitAvailability_get(region: string, service: string, name: string, zone?: string): Promise<CloudAvailability | null> {
    this.call_count('limitAvailability_get');
    return this.cloudData.availability[availabilityKey_make(region, service, name, zone)] ?? null;
  }

  async shapes_list(region: string): Promise<CloudShape[]> {
    this.call_count('shapes_list');
    return [...(this.cloudData.shapes[region] ?? [])].sort((a: CloudShape, b: CloudShape): number => a.name.localeCompare(b.name));
  }

  async prices_list(): Promise<CloudPrice[]> {
    this.call_count('prices_list');
    return [...this.cloudData.prices];
  }
}

/**
 * A small cloud with the shape of the real one: a tenancy, two compartments
 * (one nested), one region with three zones, a few limits and shapes.
 *
 * @param tenancy - The tenancy's name.
 * @returns The fixture.
 */
export function fakeCloud_sample(tenancy: string = 'fnndsc'): FakeCloud {
  const region: string = 'us-ashburn-1';
  const zones: CloudZone[] = [1, 2, 3].map((n: number): CloudZone => ({ name: `Uocm:US-ASHBURN-AD-${n}` }));
  const container = (name: string, id: string, parentId: string | null, description: string, tags: Record<string, string> = {}): CloudContainer => ({
    name, id, parentId, state: 'active', created: '2026-08-27T12:00:00.000Z', description, tags, noun: 'compartment',
    raw: { id, name, description, compartmentId: parentId, lifecycleState: 'ACTIVE', timeCreated: '2026-08-27T12:00:00.000Z' },
  });
  const limit = (service: string, name: string, value: number, zone?: string): CloudLimit =>
    zone === undefined ? { service, name, scope: 'region', value } : { service, name, scope: 'zone', zone, value };
  const shape = (name: string, family: string, processor: string): CloudShape => ({
    name, family, flexible: true, vcpuPerCore: 2, cores: { min: 1, max: 94 }, memoryGib: { min: 1, max: 1049 }, processor, gpus: 0,
    quotaNames: [`standard-${family.toLowerCase()}-core-count`, `standard-${family.toLowerCase()}-memory-count`],
    raw: { shape: name, processorDescription: processor, isFlexible: true },
  });
  return {
    identity: { user: 'rudolph', tenancy, tenancyId: 'ocid1.tenancy.oc1..root', homeRegion: region },
    containers: [
      container(tenancy, 'ocid1.tenancy.oc1..root', null, 'the root compartment'),
      container('harbor-oci', 'ocid1.compartment.oc1..harbor', 'ocid1.tenancy.oc1..root', 'Trusted Domain builds', { 'openshift-tags.openshift-resource': 'harbor' }),
      container('sandbox', 'ocid1.compartment.oc1..sandbox', 'ocid1.tenancy.oc1..root', 'scratch'),
      container('scratch-a', 'ocid1.compartment.oc1..scratcha', 'ocid1.compartment.oc1..sandbox', 'a nested scratch compartment'),
    ],
    regions: [region],
    zones: { [region]: zones },
    limits: {
      [region]: [
        ...zones.map((zone: CloudZone): CloudLimit => limit('compute', 'standard-e5-core-count', 9250, zone.name)),
        ...zones.map((zone: CloudZone): CloudLimit => limit('compute', 'standard-e5-memory-count', 9250 * 8, zone.name)),
        limit('load-balancer', 'lb-flexible-count', 50),
        { service: 'vcn', name: 'vcn-count', scope: 'global', value: 50 },
      ],
    },
    availability: {
      [availabilityKey_make(region, 'compute', 'standard-e5-core-count', zones[0].name)]: { used: 12, available: 9238 },
      [availabilityKey_make(region, 'load-balancer', 'lb-flexible-count')]: { used: 3, available: 47 },
      [availabilityKey_make(region, 'vcn', 'vcn-count')]: { used: 1, available: 49 },
    },
    shapes: { [region]: [shape('VM.Standard.E5.Flex', 'E5', 'AMD EPYC 9J14'), shape('VM.Standard.A2.Flex', 'A2', 'Ampere AmpereOne')] },
    prices: [
      { shape: 'VM.Standard.E5.Flex', vcpuHour: 0.015, gibHour: 0.002, currency: 'USD' },
      { shape: 'VM.Standard.A2.Flex', vcpuHour: 0.007, gibHour: 0.002, currency: 'USD' },
    ],
  };
}
