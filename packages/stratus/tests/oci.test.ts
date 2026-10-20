/**
 * @file The OCI driver over recorded answers: the contract, and how OCI's
 * records become containers, limits, shapes and prices.
 *
 * The answers are shaped like the live tenancy's on 2026-10-20 with every
 * identifier scrubbed; no network is touched.
 */
import { describe, it, expect } from '@jest/globals';
import { OciDriver, ociTags_flatten, shape_ofRecord } from '../src/cloud/oci/driver.js';
import type { OciApi, OciCompartmentRecord, OciLimitValueRecord, OciShapeRecord, OciTenancyRecord } from '../src/cloud/oci/api.js';
import { driverContract_describe } from './support/driverContract.js';

const TENANCY: OciTenancyRecord = { id: 'ocid1.tenancy.oc1..aaaaaa', name: 'fnndsc-bch', description: 'fnndsc-bch', homeRegionKey: 'IAD', freeformTags: {}, definedTags: {} };
const COMPARTMENTS: OciCompartmentRecord[] = [
  { id: 'ocid1.compartment.oc1..harbor', compartmentId: TENANCY.id, name: 'harbor-oci', description: 'Trusted Domain builds', lifecycleState: 'ACTIVE', timeCreated: '2026-10-06T14:00:00.000Z', freeformTags: { owner: 'rudolph' }, definedTags: { 'Oracle-Tags': { CreatedBy: 'rudolph', CreatedOn: '2026-10-06T14:00:00.000Z' } } },
  { id: 'ocid1.compartment.oc1..gone00', compartmentId: TENANCY.id, name: 'old', description: 'removed', lifecycleState: 'DELETED', timeCreated: '2026-09-01T00:00:00.000Z', freeformTags: {}, definedTags: {} },
  { id: 'ocid1.compartment.oc1..alpha0', compartmentId: TENANCY.id, name: 'alpha', description: '', lifecycleState: 'ACTIVE', timeCreated: '2026-09-02T00:00:00.000Z', freeformTags: {}, definedTags: {} },
];
const ZONES: string[] = ['disG:US-ASHBURN-AD-1', 'disG:US-ASHBURN-AD-2', 'disG:US-ASHBURN-AD-3'];
const LIMITS: Record<string, OciLimitValueRecord[]> = {
  compute: [
    ...ZONES.map((zone: string): OciLimitValueRecord => ({ name: 'standard-e5-core-count', scopeType: 'AD', availabilityDomain: zone, value: 4629 })),
    { name: 'custom-image-count', scopeType: 'REGION', availabilityDomain: null, value: 25 },
  ],
  vcn: [{ name: 'vcn-count', scopeType: 'GLOBAL', availabilityDomain: null, value: 50 }],
};
const SHAPES: OciShapeRecord[] = [
  { shape: 'VM.Standard.E5.Flex', processorDescription: '4th Gen AMD EPYC', ocpus: null, memoryInGBs: null, gpus: 0, isFlexible: true, ocpuOptions: { min: 1, max: 94 }, memoryOptions: { minInGBs: 1, maxInGBs: 1049 }, quotaNames: ['standard-e5-core-count', 'standard-e5-memory-count'], raw: { shape: 'VM.Standard.E5.Flex' } },
  { shape: 'VM.Standard.E5.Flex', processorDescription: '4th Gen AMD EPYC', ocpus: null, memoryInGBs: null, gpus: 0, isFlexible: true, ocpuOptions: { min: 1, max: 94 }, memoryOptions: { minInGBs: 1, maxInGBs: 1049 }, quotaNames: [], raw: {} },
  { shape: 'VM.Standard.A1.Flex', processorDescription: 'Ampere Altra', ocpus: null, memoryInGBs: null, gpus: 0, isFlexible: true, ocpuOptions: { min: 1, max: 80 }, memoryOptions: { minInGBs: 1, maxInGBs: 512 }, quotaNames: ['standard-a1-core-count'], raw: {} },
  { shape: 'BM.GPU.A10.4', processorDescription: 'Intel Xeon', ocpus: 64, memoryInGBs: 1024, gpus: 4, isFlexible: false, ocpuOptions: null, memoryOptions: null, quotaNames: ['gpu-a10-count'], raw: {} },
];
const PRICE_LIST = {
  items: [
    { partNumber: 'B97384', currencyCodeLocalizations: [{ currencyCode: 'USD', prices: [{ model: 'PAY_AS_YOU_GO', value: 0.03 }] }] },
    { partNumber: 'B97385', currencyCodeLocalizations: [{ currencyCode: 'USD', prices: [{ model: 'PAY_AS_YOU_GO', value: 0.002 }] }] },
    { partNumber: 'B93297', currencyCodeLocalizations: [{ currencyCode: 'USD', prices: [{ model: 'PAY_AS_YOU_GO', value: 0.01 }, { model: 'MONTHLY_COMMIT', value: 0.009 }] }] },
    { partNumber: 'B93298', currencyCodeLocalizations: [{ currencyCode: 'USD', prices: [{ model: 'PAY_AS_YOU_GO', value: 0.0015 }] }, { currencyCode: 'EUR', prices: [{ model: 'PAY_AS_YOU_GO', value: 9 }] }] },
    { partNumber: 'B99999', currencyCodeLocalizations: [{ currencyCode: 'USD', prices: [] }] },
  ],
};

/** A recorded API: every call answers from the fixtures and counts itself. */
export function recordedApi_make(seen: string[] = []): OciApi {
  return {
    credential_get: () => ({ tenancyId: TENANCY.id, userId: 'ocid1.user.oc1..user00', region: 'us-ashburn-1' }),
    async tenancy_get(tenancyId: string) { seen.push(`tenancy_get ${tenancyId}`); return TENANCY; },
    async userName_get(userId: string) { seen.push(`userName_get ${userId}`); return 'rudolph.pienaar@childrens.harvard.edu'; },
    async compartments_list(parentId: string) { seen.push(`compartments_list ${parentId}`); return parentId === TENANCY.id ? COMPARTMENTS : []; },
    async regionSubscriptions_list() { return ['us-ashburn-1']; },
    async availabilityDomains_list(region: string) { return region === 'us-ashburn-1' ? ZONES : []; },
    async limitServices_list() { return Object.keys(LIMITS).sort(); },
    async limitValues_list(_region: string, _tenancyId: string, service: string) { return LIMITS[service] ?? []; },
    async resourceAvailability_get(_r: string, _t: string, service: string, limitName: string, availabilityDomain?: string) {
      if (service === 'compute' && limitName === 'standard-e5-core-count' && availabilityDomain === ZONES[0]) return { used: 4, available: 4625 };
      if (service === 'vcn') return null;
      return { used: 0, available: 25 };
    },
    async shapes_list() { return SHAPES; },
  };
}

const fetchJson = async (): Promise<unknown> => PRICE_LIST;

driverContract_describe('the OCI driver over recorded answers', () => new OciDriver({ api: recordedApi_make(), fetchJson }));

describe('the OCI driver', () => {
  it('is the IAM user at the tenancy, with the profile\'s region as home', async () => {
    const driver = new OciDriver({ api: recordedApi_make(), fetchJson });
    expect(await driver.identity_get()).toEqual({ user: 'rudolph.pienaar@childrens.harvard.edu', tenancy: 'fnndsc-bch', tenancyId: TENANCY.id, homeRegion: 'us-ashburn-1' });
    expect((await driver.root_get()).noun).toBe('tenancy');
  });

  it('lists compartments as containers, deleted ones left out, sorted, tags flattened', async () => {
    const driver = new OciDriver({ api: recordedApi_make(), fetchJson });
    const children = await driver.containers_list(TENANCY.id);
    expect(children.map((c) => c.name)).toEqual(['alpha', 'harbor-oci']);
    const harbor = children[1];
    expect(harbor.noun).toBe('compartment');
    expect(harbor.state).toBe('active');
    expect(harbor.tags).toEqual({ owner: 'rudolph', 'Oracle-Tags.CreatedBy': 'rudolph', 'Oracle-Tags.CreatedOn': '2026-10-06T14:00:00.000Z' });
    expect(ociTags_flatten({}, {})).toEqual({});
  });

  it('reads an AD-scoped limit as a zone limit, a REGION one as region, GLOBAL as global', async () => {
    const driver = new OciDriver({ api: recordedApi_make(), fetchJson });
    const compute = await driver.limits_list('us-ashburn-1', 'compute');
    expect(compute.filter((l) => l.scope === 'zone').map((l) => l.zone)).toEqual(ZONES);
    expect(compute.find((l) => l.name === 'custom-image-count')).toEqual({ service: 'compute', name: 'custom-image-count', scope: 'region', value: 25 });
    expect(await driver.limits_list('us-ashburn-1', 'vcn')).toEqual([{ service: 'vcn', name: 'vcn-count', scope: 'global', value: 50 }]);
    expect(await driver.limitAvailability_get('us-ashburn-1', 'compute', 'standard-e5-core-count', ZONES[0])).toEqual({ used: 4, available: 4625 });
    expect(await driver.limitAvailability_get('us-ashburn-1', 'vcn', 'vcn-count')).toBeNull();
  });

  it('turns OCPU ranges into vCPU by the family\'s ratio, keeps fixed shapes fixed, lists each shape once', async () => {
    const driver = new OciDriver({ api: recordedApi_make(), fetchJson });
    const shapes = await driver.shapes_list('us-ashburn-1');
    expect(shapes.map((s) => s.name)).toEqual(['BM.GPU.A10.4', 'VM.Standard.A1.Flex', 'VM.Standard.E5.Flex']);
    const e5 = shapes[2];
    expect(e5).toMatchObject({ family: 'E5', flexible: true, vcpuPerCore: 2, cores: { min: 2, max: 188 }, memoryGib: { min: 1, max: 1049 }, gpus: 0 });
    const a1 = shapes[1];
    expect(a1).toMatchObject({ family: 'A1', vcpuPerCore: 1, cores: { min: 1, max: 80 } });
    const gpu = shapes[0];
    expect(gpu).toMatchObject({ family: 'BM.GPU.A10.4', flexible: false, cores: { min: 128, max: 128 }, memoryGib: { min: 1024, max: 1024 }, gpus: 4 });
    expect(shape_ofRecord({ ...SHAPES[3], ocpus: null, memoryInGBs: null }).cores).toEqual({ min: 0, max: 0 });
  });

  it('prices the shapes whose parts the list holds, per vCPU-hour, from the fetched list', async () => {
    const driver = new OciDriver({ api: recordedApi_make(), fetchJson });
    const prices = await driver.prices_list();
    expect(prices).toEqual([
      { shape: 'VM.Standard.A1.Flex', vcpuHour: 0.01, gibHour: 0.0015, currency: 'USD' },
      { shape: 'VM.Standard.E5.Flex', vcpuHour: 0.015, gibHour: 0.002, currency: 'USD' },
    ]);
  });
});
