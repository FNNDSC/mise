/**
 * @file A compartment's resources in the tree over the fake cloud: kind
 * folders with their counts, rows by kind and state, field files, networks,
 * buckets and zones, duplicates, the session's region, and refusals.
 */
import { describe, it, expect, beforeEach } from '@jest/globals';
import { errorStack, errorStack_getAllOfType, type VFSItem } from '@fnndsc/fond';
import { FakeDriver, fakeCloud_sample, type FakeCloud, type FakeResource } from '../src/cloud/fake/driver.js';
import { TenancyProvider } from '../src/vfs/tenancy.js';
import { OBJECT_READ_LIMIT, recordSets_build } from '../src/vfs/resources.js';
import type { CloudInstance, ResourceCounts } from '../src/cloud/driver.js';

const H = '/net/oci/fnndsc/harbor-oci';
const NOW = '2026-10-21T12:00:00.000Z';
const names = (items: VFSItem[]): string[] => items.map((item: VFSItem): string => item.name);

async function listed(tree: TenancyProvider, path: string): Promise<VFSItem[]> {
  const result = await tree.list(path);
  if (!result.ok) throw new Error(`could not list ${path}: ${errorStack_getAllOfType('error').join('; ')}`);
  return result.value;
}

async function text(tree: TenancyProvider, path: string): Promise<string> {
  const result = await tree.read(path);
  if (!result.ok) throw new Error(`could not read ${path}: ${result.errno} ${result.reason ?? ''}`);
  return result.value;
}

/** The sample with a second `node-1`, a large object, and an instance in another region. */
function cloud_withExtras(): FakeCloud {
  const cloud: FakeCloud = fakeCloud_sample('fnndsc');
  const node1 = cloud.resources.find((entry) => entry.kind === 'instances' && entry.record.name === 'node-1') as FakeResource;
  const twin: FakeResource = { kind: 'instances', containerId: node1.containerId, record: { ...(node1.record as CloudInstance), id: 'ocid1.instance.oc1.iad.twin01', ips: [] } };
  const far: FakeResource = { kind: 'instances', containerId: node1.containerId, record: { ...(node1.record as CloudInstance), name: 'far-away', id: 'ocid1.instance.oc1.phx.far000', region: 'us-phoenix-1' } };
  return {
    ...cloud,
    resources: [...cloud.resources, twin, far],
    objects: { iso: [...(cloud.objects['iso'] ?? []), { name: 'images/v1/small.txt', size: 5, modified: '' }, { name: 'huge.bin', size: OBJECT_READ_LIMIT + 1, modified: '' }] },
    objectBytes: { ...cloud.objectBytes, 'iso/images/v1/small.txt': 'small' },
  };
}

describe('a compartment\'s resources', () => {
  let driver: FakeDriver;
  let tree: TenancyProvider;
  let region: string | null;
  beforeEach(() => {
    errorStack.stack_clear();
    driver = new FakeDriver(cloud_withExtras());
    region = null;
    tree = new TenancyProvider({ driver, now: (): string => NOW, region: (): string | null => region });
  });

  it('lists a kind folder per kind beside the child compartments, each counting its live resources by one search', async () => {
    const items = await listed(tree, H);
    expect(names(items)).toEqual(['instances', 'networks', 'loadbalancers', 'volumes', 'buckets', 'dns', 'info.json']);
    expect(items[0]).toEqual({ name: 'instances', type: 'kind', size: 4, owner: 'cloud', date: NOW });
    expect(items.slice(1, 6).map((item) => item.size)).toEqual([1, 2, 5, 1, 1]);
    expect(driver.calls['resources_search']).toBe(1);
  });

  it('lists the kind folders without counts when the search fails', async () => {
    const failing = new (class extends FakeDriver {
      override async resources_search(): Promise<ResourceCounts> { throw new Error('throttled'); }
    })(cloud_withExtras());
    const quiet = new TenancyProvider({ driver: failing, now: (): string => NOW });
    const items = await listed(quiet, H);
    expect(items[0]).toEqual({ name: 'instances', type: 'kind', size: 0, owner: 'cloud', date: NOW, status: 'uncounted' });
  });

  it('lists instances by name with type, state, shape and tags; a duplicate wears its id suffix; another region is not here', async () => {
    const items = await listed(tree, `${H}/instances`);
    expect(names(items)).toEqual(['bootstrap', 'node-0', 'node-1~node01', 'node-1~twin01', 'node-2']);
    expect(items[1]).toEqual({
      name: 'node-0', type: 'instance', size: 0, owner: 'rudolph', date: '2026-10-06T14:00:00.000Z', status: 'running', title: 'VM.Standard.E5.Flex',
      tags: ['openshift-tags.openshift-resource=harbor'],
    });
    expect(items[0]).toMatchObject({ status: 'terminated' });
    expect((await tree.list(`${H}/instances/node-1`)).ok).toBe(false);
    expect(errorStack_getAllOfType('error').join('\n')).toContain('node-1: ambiguous: node-1~node01, node-1~twin01');
  });

  it('follows the session\'s region when it changes', async () => {
    region = 'us-phoenix-1';
    expect(names(await listed(tree, `${H}/instances`))).toEqual(['far-away']);
  });

  it('gives an instance its field files: the common ones, then shape, zone and ips', async () => {
    expect(names(await listed(tree, `${H}/instances/node-0`))).toEqual(['name', 'id', 'state', 'region', 'created', 'tags', 'shape', 'zone', 'ips', 'info.json']);
    expect(await text(tree, `${H}/instances/node-0/state`)).toBe('running\n');
    expect(await text(tree, `${H}/instances/node-0/zone`)).toBe('Uocm:US-ASHBURN-AD-1\n');
    expect(await text(tree, `${H}/instances/node-0/ips`)).toBe('10.0.16.10\n');
    expect(await text(tree, `${H}/instances/node-0/tags`)).toBe('openshift-tags.openshift-resource=harbor\n');
    expect(await text(tree, `${H}/instances/node-1~twin01/ips`)).toBe('');
    expect(JSON.parse(await text(tree, `${H}/instances/node-2/info.json`))).toEqual({ id: 'ocid1.instance.oc1.iad.node02', displayName: 'node-2', lifecycleState: 'RUNNING' });
    const sizes = (await listed(tree, `${H}/instances/node-0`)).map((item) => item.size);
    expect(sizes[0]).toBe(Buffer.byteLength('node-0\n'));
  });

  it('gives a volume its size and what it is attached to, by name in the same compartment', async () => {
    const items = await listed(tree, `${H}/volumes`);
    expect(names(items)).toEqual(['etcd-0', 'node-0 (Boot Volume)', 'node-1 (Boot Volume)', 'node-2 (Boot Volume)', 'spare']);
    expect(items[0]).toMatchObject({ type: 'volume', status: 'available', title: '50 GiB' });
    expect(await text(tree, `${H}/volumes/etcd-0/size`)).toBe('50 GiB\n');
    expect(await text(tree, `${H}/volumes/etcd-0/attached`)).toBe('node-0\n');
    expect(await text(tree, `${H}/volumes/spare/attached`)).toBe('no\n');
    expect(names(await listed(tree, `${H}/volumes/spare`))).toEqual(['name', 'id', 'state', 'region', 'created', 'tags', 'size', 'attached', 'info.json']);
  });

  it('gives a volume attached elsewhere the instance\'s id', async () => {
    const cloud = cloud_withExtras();
    const resources = cloud.resources.map((entry) => (entry.kind === 'volumes' && entry.record.name === 'spare' ? { ...entry, record: { ...entry.record, attachedTo: 'ocid1.instance.oc1.iad.elsewh' } } : entry));
    const other = new TenancyProvider({ driver: new FakeDriver({ ...cloud, resources }), now: (): string => NOW });
    expect(await text(other, `${H}/volumes/spare/attached`)).toBe('ocid1.instance.oc1.iad.elsewh\n');
  });

  it('gives a load balancer its addresses and shape', async () => {
    const items = await listed(tree, `${H}/loadbalancers`);
    expect(items.map((item) => [item.name, item.type, item.title])).toEqual([['api', 'loadbalancer', '129.0.0.10 10.0.32.5'], ['apps', 'loadbalancer', '129.0.0.11']]);
    expect(await text(tree, `${H}/loadbalancers/api/ip`)).toBe('129.0.0.10\n10.0.32.5\n');
    expect(await text(tree, `${H}/loadbalancers/api/shape`)).toBe('flexible\n');
  });

  it('nests a network\'s subnets and security groups, each a folder of fields', async () => {
    const network = await listed(tree, `${H}/networks/harbor-vcn`);
    expect(names(network)).toEqual(['name', 'id', 'state', 'region', 'created', 'tags', 'info.json', 'subnets', 'securitygroups']);
    expect(network.slice(-2).map((item) => [item.type, item.size])).toEqual([['kind', 3], ['kind', 2]]);
    const subnets = await listed(tree, `${H}/networks/harbor-vcn/subnets`);
    expect(subnets.map((item) => [item.name, item.type, item.status])).toEqual([['compute', 'subnet', 'available'], ['control', 'subnet', 'available'], ['lb', 'subnet', 'available']]);
    expect(await text(tree, `${H}/networks/harbor-vcn/subnets/control/id`)).toBe('ocid1.subnet.oc1.iad.sub000\n');
    expect(names(await listed(tree, `${H}/networks/harbor-vcn/securitygroups`))).toEqual(['api', 'cluster']);
    expect(await listed(tree, `${H}/networks/harbor-vcn/securitygroups`)).toMatchObject([{ type: 'securitygroup' }, { type: 'securitygroup' }]);
    expect(await text(tree, `${H}/networks/harbor-vcn/securitygroups/api/state`)).toBe('available\n');
  });

  it('shows a bucket\'s links as a field, its objects as files with folders for each /, and reads a small object', async () => {
    expect(names(await listed(tree, `${H}/buckets/iso`))).toEqual(['name', 'id', 'state', 'region', 'created', 'tags', 'links', 'info.json', 'objects']);
    expect(await text(tree, `${H}/buckets/iso/links`)).toBe('agent.x86_64.iso\tagent-iso-read\tObjectRead\t2026-11-06T14:10:00.000Z\n');
    const objects = await listed(tree, `${H}/buckets/iso/objects`);
    expect(objects.map((item) => [item.name, item.type, item.size])).toEqual([
      ['agent.x86_64.iso', 'object', 1_181_745_152], ['huge.bin', 'object', OBJECT_READ_LIMIT + 1], ['images', 'kind', 1], ['README', 'object', 30],
    ]);
    expect(objects[0].date).toBe('2026-10-06T14:10:00.000Z');
    expect(names(await listed(tree, `${H}/buckets/iso/objects/images`))).toEqual(['v1']);
    expect(await listed(tree, `${H}/buckets/iso/objects/images/v1`)).toEqual([{ name: 'small.txt', type: 'object', size: 5, owner: 'rudolph', date: NOW }]);
    expect(await text(tree, `${H}/buckets/iso/objects/README`)).toBe('the agent ISO the nodes boot.\n');
    expect(await text(tree, `${H}/buckets/iso/objects/images/v1/small.txt`)).toBe('small');
    const binary = await tree.readBinary(`${H}/buckets/iso/objects/README`);
    expect(binary.ok && binary.value.length).toBe(30);
  });

  it('refuses to read an object past the limit, and says why; an object lists as Not a directory', async () => {
    const big = await tree.read(`${H}/buckets/iso/objects/agent.x86_64.iso`);
    expect(big).toEqual({ ok: false, errno: 'EPERM', reason: `1181745152 bytes is past what cat reads through the tree (${OBJECT_READ_LIMIT}); it stays in the bucket` });
    expect(driver.calls['object_read']).toBeUndefined();
    expect((await tree.list(`${H}/buckets/iso/objects/README`)).ok).toBe(false);
    expect(errorStack_getAllOfType('error').join('\n')).toContain('Not a directory');
  });

  it('answers EIO with the cloud\'s words when an object cannot be read', async () => {
    const cloud = cloud_withExtras();
    const broken = new TenancyProvider({ driver: new FakeDriver({ ...cloud, objectBytes: {} }), now: (): string => NOW });
    expect(await broken.read(`${H}/buckets/iso/objects/README`)).toEqual({ ok: false, errno: 'EIO', reason: 'fake cloud: no object iso/README' });
  });

  it('shows a DNS zone\'s records as a file per name, relative to the zone, the apex as @', async () => {
    expect(names(await listed(tree, `${H}/dns`))).toEqual(['harbor.fnndsc.org']);
    expect(await listed(tree, `${H}/dns`)).toMatchObject([{ type: 'dnszone', status: 'active' }]);
    const records = await listed(tree, `${H}/dns/harbor.fnndsc.org/records`);
    expect(records.map((item) => [item.name, item.type, item.title])).toEqual([['@', 'record', 'SOA'], ['*.apps', 'record', 'A'], ['api', 'record', 'A'], ['api-int', 'record', 'A']]);
    expect(await text(tree, `${H}/dns/harbor.fnndsc.org/records/api`)).toBe('api.harbor.fnndsc.org. 300 IN A 129.0.0.10\n');
    expect(names(await listed(tree, `${H}/dns/harbor.fnndsc.org`))).toContain('records');
  });

  it('groups records by name, keeping a name outside the zone whole', () => {
    const sets = recordSets_build([
      { domain: 'a.z.org.', type: 'A', ttl: 60, data: '1.1.1.1' },
      { domain: 'a.z.org', type: 'AAAA', ttl: 60, data: '::1' },
      { domain: 'other.net', type: 'A', ttl: 60, data: '2.2.2.2' },
    ], 'z.org');
    expect(sets).toEqual([
      { name: 'a', types: ['A', 'AAAA'], text: 'a.z.org. 60 IN A 1.1.1.1\na.z.org. 60 IN AAAA ::1\n' },
      { name: 'other.net', types: ['A'], text: 'other.net. 60 IN A 2.2.2.2\n' },
    ]);
  });

  it('refuses what is not there with the shell\'s words', async () => {
    for (const missing of [
      `${H}/instances/nobody`, `${H}/instances/node-0/nofield`, `${H}/instances/node-0/state/deeper`, `${H}/networks/harbor-vcn/subnets/none`,
      `${H}/networks/harbor-vcn/subnets/control/nofield`, `${H}/buckets/iso/objects/none`, `${H}/buckets/iso/objects/images/none`,
      `${H}/dns/harbor.fnndsc.org/records/none`, `${H}/dns/harbor.fnndsc.org/records/api/deeper`, `${H}/volumes/none`,
    ]) {
      errorStack.stack_clear();
      expect((await tree.list(missing)).ok).toBe(false);
      expect(errorStack_getAllOfType('error').join('\n')).toContain('No such file or directory');
      expect(await tree.read(missing)).toEqual({ ok: false, errno: 'ENOENT' });
    }
    expect(await tree.read(`${H}/instances`)).toEqual({ ok: false, errno: 'EISDIR' });
    expect(await tree.read(`${H}/instances/node-0`)).toEqual({ ok: false, errno: 'EISDIR' });
  });

  it('holds kind folders at the tenancy\'s own level, and reserves their names among compartments', async () => {
    expect(await listed(tree, '/net/oci/fnndsc/instances')).toEqual([]);
    const cloud = fakeCloud_sample('fnndsc');
    const root = cloud.containers[0];
    const clash = { ...cloud.containers[1], id: 'ocid1.compartment.oc1..clash0', name: 'instances' };
    const reserved = new TenancyProvider({ driver: new FakeDriver({ ...cloud, containers: [...cloud.containers, clash] }), now: (): string => NOW });
    expect(names(await listed(reserved, '/net/oci/fnndsc'))).toContain('instances~clash0');
    expect(names(await listed(reserved, '/net/oci/fnndsc/instances~clash0'))).toEqual(['instances', 'networks', 'loadbalancers', 'volumes', 'buckets', 'dns', 'info.json']);
    expect(root.parentId).toBeNull();
  });

  it('asks the cloud once per kind, container and region until the answers age', async () => {
    await listed(tree, `${H}/instances`);
    await listed(tree, `${H}/instances/node-0`);
    await text(tree, `${H}/instances/node-0/ips`);
    await text(tree, `${H}/volumes/etcd-0/attached`);
    expect(driver.calls['instances_list']).toBe(1);
    tree.cache_clear();
    await listed(tree, `${H}/instances`);
    expect(driver.calls['instances_list']).toBe(2);
  });
});
