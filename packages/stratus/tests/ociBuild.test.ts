/**
 * @file A new domain's build and teardown over OCI, against recorded
 * answers: preflight's checks, the image's bucket and link, a new stack's
 * variables and plan, the apply's outputs, the records, and the teardown in
 * its order; and the teardown verb.
 */
import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { BufferSink, HeadlessSurface, JobRunner, runner_install, sink_set, surface_set, type PromptRequest } from '@fnndsc/brasa/core';
import type { BuildCall } from '../src/cloud/builder.js';
import type { OciBuildApi, OciLink } from '../src/cloud/oci/buildApi.js';
import type { RmApi, RmJobRecord, RmOperation } from '../src/cloud/oci/rmApi.js';
import { OciBuilder } from '../src/cloud/oci/builder.js';
import { familyShape_of, stackVariables_build } from '../src/cloud/oci/stackVars.js';
import { FakeDriver, fakeCloud_sample } from '../src/cloud/fake/driver.js';
import { FakeBuildWorld, FakeCloudBuilder, FakeInstaller } from '../src/cloud/fake/builder.js';
import { FakeKube, fakeVerifyReach } from '../src/cluster/fakeKube.js';
import type { KubeApi } from '../src/cluster/kube.js';
import { SPEC_DEFAULT, specOptions_apply, type DomainSpec } from '../src/domain/spec.js';
import { DomainStore, type DomainRecord } from '../src/domain/state.js';
import { STEPS_SOURCE, type BuildDeps } from '../src/domain/steps.js';
import { clusterVolumes_read } from '../src/domain/teardown.js';
import { DomainTree } from '../src/vfs/domains.js';
import { domain_run, type DomainCommandContext } from '../src/commands/domain.js';

const plain = (text: string | undefined): string => (text ?? '').replace(/\x1b\[[0-9;]*m/g, '');

/** OCI's other calls, answering from fields and recording what was asked. */
class RecordedApi implements OciBuildApi {
  calls: string[] = [];
  compartment: string = 'ACTIVE';
  tagged: boolean = true;
  lbFree: number | null = 7;
  served: string[] = ['ns1.p68.dns.oraclecloud.net', 'ns2.p68.dns.oraclecloud.net'];
  async tenancy_get() { return { id: 'ocid1.tenancy.t', name: 'fnndsc-bch' }; }
  async compartmentState_get() { return this.compartment; }
  async tag_exists() { return this.tagged; }
  async limitFree_get() { return this.lbFree; }
  async zoneNameservers_get() { return this.served; }
  async bucket_ensure(bucket: string) { this.calls.push(`bucket ${bucket}`); }
  async object_put(bucket: string, object: string, _body: Readable | Buffer, length?: number) { this.calls.push(`put ${bucket}/${object} ${length}`); }
  async object_delete(bucket: string, object: string) { this.calls.push(`delete ${bucket}/${object}`); }
  async link_create(bucket: string, object: string): Promise<OciLink> { this.calls.push(`link ${bucket}/${object}`); return { id: 'par-1', url: 'https://objectstorage/p/SECRET/o/x.iso' }; }
  async link_delete(_bucket: string, linkId: string) { this.calls.push(`unlink ${linkId}`); }
  async record_upsert(zone: string, name: string, address: string) { this.calls.push(`A ${name} ${address} in ${zone}`); }
  async record_delete(_zone: string, name: string) { this.calls.push(`unrecord ${name}`); }
  async volume_delete(id: string) { this.calls.push(`volume ${id}`); }
}

/** Resource Manager, answering every job with success. */
class OkRm implements RmApi {
  calls: string[] = [];
  variables: Record<string, string> = {};
  async stack_create(request: { compartmentId: string; displayName: string; zipBase64: string; variables: Record<string, string>; tags: Record<string, string> }) {
    this.variables = request.variables;
    this.calls.push(`stack ${JSON.stringify(request.tags)}`);
    return { id: 'stack-1', displayName: request.displayName, state: 'ACTIVE', compartmentId: request.compartmentId };
  }
  async stack_update() {}
  async stack_get(id: string) { return { id, displayName: 's', state: 'ACTIVE', compartmentId: 'c' }; }
  async stacks_tagged() { return []; }
  async job_create(stackId: string, operation: RmOperation): Promise<RmJobRecord> { this.calls.push(`${operation.kind} ${stackId}${operation.kind === 'apply' ? ` from ${operation.planJobId}` : ''}`); return { id: `job-${operation.kind}`, state: 'ACCEPTED' }; }
  async job_get(id: string): Promise<RmJobRecord> { return { id, state: 'SUCCEEDED' }; }
  async job_cancel() {}
  async jobLog_read() { return []; }
  async jobPlan_read() { return { resource_changes: [{ address: 'oci_core_instance.cp[0]', type: 'oci_core_instance', change: { actions: ['create'] } }] }; }
  outputs: Record<string, string> = { open_shift_api_lb_addr: '129.0.0.1', open_shift_api_int_lb_addr: '10.0.0.2', open_shift_apps_lb_addr: '129.0.0.3', dynamic_custom_manifest: 'kind: List\n' };
  async jobOutputs_read() { return this.outputs; }
  async stackResources_count() { return 79; }
}

describe('a new stack\'s variables', () => {
  it('are the spec in OCI units and harbor-oci\'s choices, every value a string', () => {
    const variables = stackVariables_build({ domain: 'trial', spec: SPEC_DEFAULT, tenancyId: 't', compartmentId: 'c', region: 'r', baseDomain: 'b.org', isoLink: 'https://iso', sshPublicKey: 'ssh-ed25519 k' });
    expect(variables).toMatchObject({
      cluster_name: 'trial', zone_dns: 'b.org', installation_method: 'Assisted', openshift_image_source_uri: 'https://iso',
      control_plane_count: '3', control_plane_shape: 'VM.Standard.E5.Flex', control_plane_ocpu: '4', control_plane_memory: '24', control_plane_boot_size: '200', control_plane_boot_volume_vpus_per_gb: '100',
      compute_count: '0', create_public_dns: 'false', create_private_dns: 'false', tag_namespace_compartment_ocid_resource_tagging: 'c', oci_driver_version: 'v1.34.0',
    });
    const workers: DomainSpec = (specOptions_apply(SPEC_DEFAULT, new Map([['--workers', '2x8/32']])) as { spec: DomainSpec }).spec;
    expect(stackVariables_build({ domain: 't', spec: workers, tenancyId: 't', compartmentId: 'c', region: 'r', baseDomain: 'b', isoLink: 'i', sshPublicKey: 'k' })).toMatchObject({ compute_count: '2', compute_ocpu: '4', compute_boot_volume_vpus_per_gb: '10' });
    expect(() => stackVariables_build({ domain: 't', spec: { ...SPEC_DEFAULT, controlPlane: { ...SPEC_DEFAULT.controlPlane, vcpu: 7 } }, tenancyId: 't', compartmentId: 'c', region: 'r', baseDomain: 'b', isoLink: 'i', sshPublicKey: 'k' })).toThrow('7 vCPU is not whole OCPUs');
    expect(() => stackVariables_build({ domain: 't', spec: { ...SPEC_DEFAULT, controlPlane: { ...SPEC_DEFAULT.controlPlane, bootTier: 'gold' } }, tenancyId: 't', compartmentId: 'c', region: 'r', baseDomain: 'b', isoLink: 'i', sshPublicKey: 'k' })).toThrow('boot tier gold');
    expect(() => familyShape_of('Z9')).toThrow('no flexible shape known');
    expect(familyShape_of('A1')).toEqual({ shape: 'VM.Standard.A1.Flex', vcpuPerOcpu: 1 });
  });
});

describe('the OCI builder\'s build and teardown', () => {
  let api: RecordedApi;
  let rm: OkRm;
  let builder: OciBuilder;
  let logged: string[];
  const call = (): BuildCall => ({ log: (line: string): void => { logged.push(line); }, signal: new AbortController().signal });

  beforeEach(() => {
    api = new RecordedApi();
    rm = new OkRm();
    logged = [];
    builder = new OciBuilder({
      rm: () => rm, api: () => api, driver: new FakeDriver(fakeCloud_sample()), sshPublicKey: () => 'ssh-ed25519 k\n',
      nameservers_resolve: async () => ['ns2.p68.dns.oraclecloud.net.', 'ns1.p68.dns.oraclecloud.net.'],
      iso_fetch: async () => ({ body: Readable.from(['iso']), length: 3 }), zip_fetch: async () => Buffer.from('zip'), pollMs: 0,
    });
  });

  it('preflight checks what harbor-oci checked, each on its own', async () => {
    const checks = await builder.preflight({ domain: 'trial', spec: SPEC_DEFAULT, region: 'us-ashburn-1', baseDomain: 'b.org', compartmentId: 'c' }, call());
    expect(checks.map((check) => `${check.name}:${check.ok}`)).toEqual(['credential:true', 'compartment:true', 'attribution tag:true', 'spec:true', 'room:false', 'load balancers:true', 'zone:true', 'SSH key:true']);
    expect(checks.find((check) => check.name === 'room')?.note).toContain('not said');
    api.compartment = 'DELETED'; api.tagged = false; api.lbFree = 2; api.served = ['ns9'];
    const workers: DomainSpec = (specOptions_apply(SPEC_DEFAULT, new Map([['--workers', '2x8/32']])) as { spec: DomainSpec }).spec;
    const bad = Object.fromEntries((await builder.preflight({ domain: 'trial', spec: workers, region: 'us-ashburn-1', baseDomain: 'b.org', compartmentId: 'c' }, call())).map((check) => [check.name, check]));
    expect(bad['compartment']).toMatchObject({ ok: false, note: 'deleted' });
    expect(bad['attribution tag']?.ok).toBe(false);
    expect(bad['spec']?.note).toContain('workers are not proven on OCI yet');
    expect(bad['load balancers']).toMatchObject({ ok: false, note: '3 needed, 2 free' });
    expect(bad['zone']?.note).toBe('b.org: OCI serves ns9, the world asks ns1.p68.dns.oraclecloud.net ns2.p68.dns.oraclecloud.net');
    const none = Object.fromEntries((await builder.preflight({ domain: 'trial', spec: SPEC_DEFAULT, region: 'us-ashburn-1', baseDomain: 'b.org', compartmentId: '' }, call())).map((check) => [check.name, check]));
    expect(none['compartment']?.note).toBe('none chosen: domain new --compartment <ocid>');
  });

  it('copies the image into a private bucket and links it, makes a stack from the spec, plans, applies and writes the records', async () => {
    const stored = await builder.iso_store({ domain: 'trial', url: 'https://img', region: 'r', compartmentId: 'c' }, call());
    expect(stored).toMatchObject({ object: 'trial-discovery.iso', link: 'https://objectstorage/p/SECRET/o/x.iso', linkId: 'par-1' });
    expect(api.calls).toEqual(['bucket stratus-iso', 'put stratus-iso/trial-discovery.iso 3', 'link stratus-iso/trial-discovery.iso']);
    const plan = await builder.infra_plan({ domain: 'trial', spec: SPEC_DEFAULT, region: 'r', isoObject: 'trial-discovery.iso', compartmentId: 'c', baseDomain: 'b.org', isoLink: stored.link }, call());
    expect(plan).toMatchObject({ ref: 'job-plan', stackRef: 'stack-1', rows: [{ action: 'create', kind: 'instances' }] });
    expect(rm.variables).toMatchObject({ cluster_name: 'trial', openshift_image_source_uri: 'https://objectstorage/p/SECRET/o/x.iso', tenancy_ocid: 'ocid1.tenancy.t', public_ssh_key: 'ssh-ed25519 k' });
    const outputs = await builder.infra_apply({ domain: 'trial', plan, region: 'r' }, call());
    expect(outputs).toEqual({ stackRef: 'stack-1', apiIp: '129.0.0.1', apiIntIp: '10.0.0.2', appsIp: '129.0.0.3', manifests: [{ name: 'oci-dynamic-custom-manifest.yml', content: 'kind: List\n' }] });
    expect(rm.calls).toEqual(['stack {"mise-domain":"trial"}', 'plan stack-1', 'apply stack-1 from job-plan']);
    expect(await builder.dns_upsert({ domain: 'trial', baseDomain: 'b.org', outputs, compartmentId: 'c', region: 'r' }, call())).toEqual(['api.trial.b.org', 'api-int.trial.b.org', '*.apps.trial.b.org']);
    expect(api.calls.slice(-3)).toEqual(['A api.trial.b.org 129.0.0.1 in b.org', 'A api-int.trial.b.org 10.0.0.2 in b.org', 'A *.apps.trial.b.org 129.0.0.3 in b.org']);
    delete rm.outputs['dynamic_custom_manifest'];
    await expect(builder.infra_apply({ domain: 'trial', plan, region: 'r' }, call())).rejects.toThrow('the apply left no dynamic_custom_manifest');
    await expect(builder.infra_apply({ domain: 'trial', plan: { ref: 'p', rows: [] }, region: 'r' }, call())).rejects.toThrow('no stack to apply in');
  });

  it('tears down in its order: the stack, the records, the image, the cluster\'s volumes', async () => {
    expect(await builder.stackResources_count({ region: 'r', stackRef: 'stack-1' })).toBe(79);
    const gone = await builder.teardown_run({ domain: 'trial', region: 'r', compartmentId: 'c', baseDomain: 'b.org', stackRef: 'stack-1', isoObject: 'trial-discovery.iso', isoLinkId: 'par-1', volumeIds: ['vol-1'] }, call());
    expect(rm.calls).toEqual(['destroy stack-1']);
    expect(api.calls).toEqual(['unrecord api.trial.b.org', 'unrecord api-int.trial.b.org', 'unrecord *.apps.trial.b.org', 'unlink par-1', 'delete stratus-iso/trial-discovery.iso', 'volume vol-1']);
    expect(gone).toEqual(["the stack's resources (stack-1)", '3 DNS records', 'the image trial-discovery.iso and its link', '1 volumes the cluster made']);
  });

  it('reads the cluster\'s own block volumes from its PersistentVolumes', async () => {
    const kube: KubeApi = { ...new FakeKube({ nodes: [] }), json_get: async () => ({ items: [
      { spec: { csi: { driver: 'blockvolume.csi.oraclecloud.com', volumeHandle: 'ocid1.volume.a' } } },
      { spec: { csi: { driver: 'other.csi', volumeHandle: 'x' } } },
      { spec: { nfs: {} } },
    ] }) } as KubeApi;
    expect(await clusterVolumes_read(kube)).toEqual(['ocid1.volume.a']);
  });
});

describe('domain teardown', () => {
  let root: string;
  let store: DomainStore;
  let context: DomainCommandContext;
  let surface: HeadlessSurface & { answer: string };
  let installer: FakeInstaller;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'stratus-teardown-'));
    store = new DomainStore(join(root, 'domains'));
    const world: FakeBuildWorld = new FakeBuildWorld(0);
    const builder: FakeCloudBuilder = new FakeCloudBuilder(world);
    installer = new FakeInstaller(world);
    const deps: BuildDeps = { store, builder, installer, zones: 3, version: '4.22', pollMs: 0, hostsWaitMs: 1000, installWaitMs: 1000 };
    const domains: DomainTree = new DomainTree({ sources: [], owner: (): string => 'r', now: (): Date => new Date(), store });
    const driver: FakeDriver = new FakeDriver(fakeCloud_sample());
    const verifyReach = { ...fakeVerifyReach(() => []), kube_make: (): KubeApi => ({ ...new FakeKube({ nodes: [] }), json_get: async () => ({ items: [{ spec: { csi: { driver: 'blockvolume.csi.oraclecloud.com', volumeHandle: 'v1' } } }] }) }) as KubeApi };
    context = { domains, driver, region: (): string => 'r', domainsPath: (): string => '/d', build: { domains, store, driver, region: (): string => 'r', deps, builder, baseDomain: 'b', verifyReach } };
    surface = Object.assign(new HeadlessSurface(), { answer: 'trial' });
    (surface.capabilities as { tasks?: boolean }).tasks = true;
    surface.prompt = async (_request: PromptRequest): Promise<string> => surface.answer;
    surface_set(surface);
    runner_install(new JobRunner(join(root, 'jobs'), [{ id: STEPS_SOURCE, label: 'steps' }]));
    sink_set(new BufferSink());
    store.create({ name: 'trial', created: 'now', region: 'r', baseDomain: 'b', steps: {}, ids: { stackRef: 'stack-1', isoObject: 'trial-discovery.iso', clusterId: 'cluster-trial', infraEnvId: 'infraenv-trial' }, compartmentId: 'c' }, SPEC_DEFAULT);
    store.secret_write('trial', 'kubeconfig', 'clusters: []\n');
  });
  afterEach(() => { runner_install(null); surface_set(new HeadlessSurface()); rmSync(root, { recursive: true, force: true }); });

  it('shows what goes, asks for the name, and removes it; a wrong name removes nothing', async () => {
    surface.answer = 'tria';
    expect(plain((await domain_run(context, ['teardown', 'trial'])).rendered)).toBe("not torn down: 'tria' is not trial\n");
    expect(store.record_read('trial')?.gone).toBeUndefined();
    surface.answer = 'trial';
    expect(plain((await domain_run(context, ['teardown', 'trial'])).rendered)).toBe('trial: torn down\n');
    expect((store.record_read('trial') as DomainRecord).gone).toBeDefined();
    expect(installer.deleted).toEqual(['cluster-trial']);
    expect(plain((await domain_run(context, ['teardown', 'trial'])).rendered)).toContain('already torn down');
    expect(plain((await domain_run(context, ['status', 'trial'])).rendered)).toContain('torn down');
    expect((await domain_run(context, ['build', 'trial'])).renderedErr).toContain('was torn down');
  });

  it('refuses what it must not tear down, and when it cannot read the cluster\'s volumes', async () => {
    store.create({ name: 'harbor', created: 'now', region: 'r', baseDomain: 'b', steps: {}, ids: {}, adopted: { from: '/x', at: 'now' } }, SPEC_DEFAULT);
    expect((await domain_run(context, ['teardown', 'harbor'])).renderedErr).toBe('domain teardown: harbor: Operation not permitted: adopted, not built here\n');
    expect((await domain_run(context, ['teardown', 'nope'])).renderedErr).toBe('domain teardown: nope: no such domain\n');
    expect((await domain_run(context, ['teardown'])).renderedErr).toBe('domain teardown: usage: domain teardown <name>\n');
    const blind: DomainCommandContext = { ...context, build: { ...context.build!, verifyReach: { ...context.build!.verifyReach!, kube_make: (): KubeApi => ({ ...new FakeKube({ nodes: [] }), json_get: async () => { throw new Error('unreachable'); } }) as KubeApi } } };
    expect((await domain_run(blind, ['teardown', 'trial'])).renderedErr).toBe("domain teardown: trial: cannot read the cluster's volumes (unreachable): refusing, they would be left billing\n");
    const untiered: HeadlessSurface = new HeadlessSurface();
    surface_set(untiered);
    expect((await domain_run(context, ['teardown', 'trial'])).renderedErr).toContain('tearing down needs the tasks tier');
    const noBuilder: DomainCommandContext = { ...context, build: { ...context.build!, builder: null } };
    expect((await domain_run(noBuilder, ['teardown', 'trial'])).renderedErr).toBe('domain teardown: this cloud cannot tear a domain down yet\n');
  });
});
