/**
 * @file The OCI driver: Oracle Cloud Infrastructure as stratus's cloud.
 *
 * Containers are compartments, the root the tenancy; zones are availability
 * domains; limits come from the Limits service and shapes from Compute,
 * each asked in the region given; prices from Oracle's public list. The SDK
 * is reached through `OciApi` (`api.ts`), so this file maps records and
 * tests run it over recorded answers.
 *
 * @module
 */
import type { CloudAvailability, CloudContainer, CloudDriver, CloudIdentity, CloudLimit, CloudPrice, CloudShape, CloudZone } from '../driver.js';
import type { OciApi, OciCompartmentRecord, OciLimitValueRecord, OciShapeRecord, OciTenancyRecord } from './api.js';
import { ociPrices_read, shapeTerms_get, type JsonFetch } from './prices.js';

/** How the driver is made. */
export interface OciDriverOptions {
  /** The API; the real one when absent. */
  readonly api: OciApi;
  /** How the price list is fetched; Node's fetch when absent. */
  readonly fetchJson?: JsonFetch;
}

/** Tags flattened: freeform as `key`, defined as `namespace.key`. */
export function ociTags_flatten(freeform: Readonly<Record<string, string>>, defined: Readonly<Record<string, Readonly<Record<string, unknown>>>>): Record<string, string> {
  const tags: Record<string, string> = {};
  for (const [key, value] of Object.entries(freeform)) tags[key] = value;
  for (const [namespace, keys] of Object.entries(defined)) {
    for (const [key, value] of Object.entries(keys)) tags[`${namespace}.${key}`] = String(value);
  }
  return tags;
}

/** A compartment record as a container. */
function container_ofCompartment(record: OciCompartmentRecord): CloudContainer {
  return {
    name: record.name,
    id: record.id,
    parentId: record.compartmentId,
    state: record.lifecycleState.toLowerCase(),
    created: record.timeCreated,
    description: record.description,
    tags: ociTags_flatten(record.freeformTags, record.definedTags),
    noun: 'compartment',
    raw: record,
  };
}

/** The tenancy as the root container. */
function container_ofTenancy(record: OciTenancyRecord): CloudContainer {
  return {
    name: record.name,
    id: record.id,
    parentId: null,
    state: 'active',
    created: '',
    description: record.description,
    tags: ociTags_flatten(record.freeformTags, record.definedTags),
    noun: 'tenancy',
    raw: record,
  };
}

/** A limit value as a limit at its scope. */
function limit_ofValue(service: string, record: OciLimitValueRecord): CloudLimit {
  const scope: string = record.scopeType.toUpperCase();
  if (scope === 'AD' && record.availabilityDomain !== null) {
    return { service, name: record.name, scope: 'zone', zone: record.availabilityDomain, value: record.value };
  }
  return { service, name: record.name, scope: scope === 'GLOBAL' ? 'global' : 'region', value: record.value };
}

/** A shape record as a shape. */
export function shape_ofRecord(record: OciShapeRecord): CloudShape {
  const terms = shapeTerms_get(record.shape);
  const cores: { min: number; max: number } = record.isFlexible && record.ocpuOptions !== null
    ? { min: record.ocpuOptions.min * terms.vcpuPerOcpu, max: record.ocpuOptions.max * terms.vcpuPerOcpu }
    : { min: (record.ocpus ?? 0) * terms.vcpuPerOcpu, max: (record.ocpus ?? 0) * terms.vcpuPerOcpu };
  const memoryGib: { min: number; max: number } = record.isFlexible && record.memoryOptions !== null
    ? { min: record.memoryOptions.minInGBs, max: record.memoryOptions.maxInGBs }
    : { min: record.memoryInGBs ?? 0, max: record.memoryInGBs ?? 0 };
  return {
    name: record.shape,
    family: terms.family,
    flexible: record.isFlexible,
    vcpuPerCore: terms.vcpuPerOcpu,
    cores,
    memoryGib,
    processor: record.processorDescription,
    gpus: record.gpus,
    quotaNames: record.quotaNames,
    raw: record.raw,
  };
}

/** Oracle Cloud Infrastructure as a cloud driver. */
export class OciDriver implements CloudDriver {
  readonly cloud: string = 'oci';
  private readonly api: OciApi;
  private readonly fetchJson: JsonFetch | undefined;

  constructor(options: OciDriverOptions) {
    this.api = options.api;
    this.fetchJson = options.fetchJson;
  }

  async identity_get(): Promise<CloudIdentity> {
    const credential: { tenancyId: string; userId: string; region: string } = this.api.credential_get();
    const [tenancy, user]: [OciTenancyRecord, string] = await Promise.all([
      this.api.tenancy_get(credential.tenancyId),
      this.api.userName_get(credential.userId),
    ]);
    return { user, tenancy: tenancy.name, tenancyId: tenancy.id, homeRegion: credential.region };
  }

  async root_get(): Promise<CloudContainer> {
    return container_ofTenancy(await this.api.tenancy_get(this.api.credential_get().tenancyId));
  }

  async containers_list(parentId: string): Promise<CloudContainer[]> {
    const records: OciCompartmentRecord[] = await this.api.compartments_list(parentId);
    return records
      .filter((record: OciCompartmentRecord): boolean => record.lifecycleState.toUpperCase() !== 'DELETED')
      .map(container_ofCompartment)
      .sort((a: CloudContainer, b: CloudContainer): number => a.name.localeCompare(b.name));
  }

  async regions_list(): Promise<string[]> {
    return this.api.regionSubscriptions_list(this.api.credential_get().tenancyId);
  }

  async zones_list(region: string): Promise<CloudZone[]> {
    const names: string[] = await this.api.availabilityDomains_list(region, this.api.credential_get().tenancyId);
    return names.map((name: string): CloudZone => ({ name }));
  }

  async limitServices_list(region: string): Promise<string[]> {
    return this.api.limitServices_list(region, this.api.credential_get().tenancyId);
  }

  async limits_list(region: string, service: string): Promise<CloudLimit[]> {
    const records: OciLimitValueRecord[] = await this.api.limitValues_list(region, this.api.credential_get().tenancyId, service);
    return records.map((record: OciLimitValueRecord): CloudLimit => limit_ofValue(service, record));
  }

  async limitAvailability_get(region: string, service: string, name: string, zone?: string): Promise<CloudAvailability | null> {
    return this.api.resourceAvailability_get(region, this.api.credential_get().tenancyId, service, name, zone);
  }

  async shapes_list(region: string): Promise<CloudShape[]> {
    const records: OciShapeRecord[] = await this.api.shapes_list(region, this.api.credential_get().tenancyId);
    const seen: Set<string> = new Set();
    const shapes: CloudShape[] = [];
    for (const record of records) {
      if (seen.has(record.shape)) continue;
      seen.add(record.shape);
      shapes.push(shape_ofRecord(record));
    }
    return shapes.sort((a: CloudShape, b: CloudShape): number => a.name.localeCompare(b.name));
  }

  async prices_list(): Promise<CloudPrice[]> {
    return ociPrices_read(this.fetchJson);
  }
}
