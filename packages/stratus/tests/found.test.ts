/**
 * @file The tenancy is the truth about its domains (docs/stratus.adoc, D15):
 * a session lists what the tenancy holds by the `mise-domain` tag, a found
 * domain answers reads and `adopt` only, and `domain adopt <name>` with no
 * checkout keeps it here from what its stack says.
 */
import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FakeDriver, fakeCloud_sample, type FakeCloud, type FakeStack } from '../src/cloud/fake/driver.js';
import { FakeBuildWorld, FakeCloudBuilder, FakeInstaller } from '../src/cloud/fake/builder.js';
import type { CloudContainer, CloudDriver, FoundDomain } from '../src/cloud/driver.js';
import { foundDomains_fold, tagQuery_format } from '../src/cloud/oci/resourceMap.js';
import type { OciSearchRecord } from '../src/cloud/oci/resourceApi.js';
import { stackSpec_derive, stackVariables_build } from '../src/cloud/oci/stackVars.js';
import { DomainStore, DOMAIN_TAG, type DomainRecord } from '../src/domain/state.js';
import { SPEC_DEFAULT, type DomainSpec } from '../src/domain/spec.js';
import type { BuildDeps } from '../src/domain/steps.js';
import { DomainTree } from '../src/vfs/domains.js';
import { domain_run, foundDomain_make, type DomainCommandContext } from '../src/commands/domain.js';

const REGION: string = 'us-ashburn-1';
const QUAY_COMPARTMENT: string = 'ocid1.compartment.oc1..quay';
const QUAY_STACK: string = 'ocid1.ormstack.oc1..quay';
const ANSI: RegExp = /\u001b\[[0-9;]*m/g;

/** A compartment carrying the domain tag. */
function compartment_make(name: string, id: string, state: string = 'active'): CloudContainer {
  return { name, id, parentId: 'ocid1.tenancy.oc1..root', state, created: '2026-10-23T19:00:00.000Z', description: `${name}'s compartment`, tags: { [DOMAIN_TAG]: name }, noun: 'compartment' };
}

/** A stack carrying the domain tag. */
function stack_make(name: string, id: string, compartmentId: string, state: string = 'active', region: string = REGION): FakeStack {
  return { id, displayName: `${name} · a Trusted Domain`, compartmentId, state, region, tags: { [DOMAIN_TAG]: name } };
}

/** The sample cloud with quay's compartment and stack in it, tagged. */
function cloud_make(extra: Partial<FakeCloud> = {}): FakeCloud {
  const sample: FakeCloud = fakeCloud_sample();
  return { ...sample, containers: [...sample.containers, compartment_make('quay', QUAY_COMPARTMENT)], stacks: [stack_make('quay', QUAY_STACK, QUAY_COMPARTMENT)], ...extra };
}

describe('finding domains by their tag', () => {
  it('the fake cloud folds a tagged stack and compartment into one domain, sorted, the gone and the other region left out', async () => {
    const driver = new FakeDriver(cloud_make({
      containers: [...fakeCloud_sample().containers, compartment_make('quay', QUAY_COMPARTMENT), compartment_make('old', 'ocid1.compartment.oc1..old', 'deleted'), compartment_make('alpha', 'ocid1.compartment.oc1..alpha')],
      stacks: [stack_make('quay', QUAY_STACK, QUAY_COMPARTMENT), stack_make('old', 'ocid1.ormstack.oc1..old', 'ocid1.compartment.oc1..old', 'deleted'), stack_make('far', 'ocid1.ormstack.oc1..far', 'c', 'active', 'eu-frankfurt-1')],
    }));
    const found: FoundDomain[] = await driver.domains_find(DOMAIN_TAG, REGION);
    expect(found.map((domain: FoundDomain): string => domain.name)).toEqual(['alpha', 'quay']);
    expect(found[1]).toEqual({ name: 'quay', stack: { id: QUAY_STACK, state: 'active', compartmentId: QUAY_COMPARTMENT }, compartmentId: QUAY_COMPARTMENT, region: REGION });
    expect(found[0]?.stack).toBeNull();
  });

  it('the OCI search asks for every stack and compartment carrying the tag, and folds the hits the same way', () => {
    expect(tagQuery_format(DOMAIN_TAG)).toBe("query ormstack, compartment resources where freeformTags.key = 'mise-domain'");
    const hit = (resourceType: string, identifier: string, compartmentId: string, name: string, lifecycleState: string = 'ACTIVE'): OciSearchRecord => ({ resourceType, lifecycleState, identifier, displayName: name, compartmentId, freeformTags: { [DOMAIN_TAG]: name } });
    const folded: FoundDomain[] = foundDomains_fold([
      hit('OrmStack', QUAY_STACK, QUAY_COMPARTMENT, 'quay'),
      hit('Compartment', QUAY_COMPARTMENT, 'ocid1.tenancy.oc1..root', 'quay'),
      hit('Compartment', 'ocid1.compartment.oc1..harbor', 'ocid1.tenancy.oc1..root', 'harbor'),
      hit('OrmStack', 'ocid1.ormstack.oc1..gone', 'c', 'gone', 'DELETED'),
      { resourceType: 'Instance', lifecycleState: 'RUNNING', identifier: 'i', displayName: 'i', compartmentId: 'c', freeformTags: {} },
    ], DOMAIN_TAG, REGION);
    expect(folded).toEqual([
      { name: 'harbor', stack: null, compartmentId: 'ocid1.compartment.oc1..harbor', region: REGION },
      { name: 'quay', stack: { id: QUAY_STACK, state: 'active', compartmentId: QUAY_COMPARTMENT }, compartmentId: QUAY_COMPARTMENT, region: REGION },
    ]);
  });

  it('a found domain reads as one: no spec, no steps, its compartment the tagged one else the stack\'s', () => {
    const domain = foundDomain_make({ name: 'quay', stack: { id: QUAY_STACK, state: 'active', compartmentId: 'ocid1.compartment.oc1..other' }, compartmentId: null, region: REGION });
    expect(domain.origin).toBe('found');
    expect(domain.steps).toEqual([]);
    expect(domain.settings['OCI_COMPARTMENT_OCID']).toBe('ocid1.compartment.oc1..other');
    expect(domain.root).toBe(QUAY_STACK);
  });

  it('a stack\'s variables read back into the spec and zone they were built from', () => {
    const spec: DomainSpec = { ...SPEC_DEFAULT, workers: { count: 2, vcpu: 8, ramGib: 32, bootGib: 120, bootTier: 'balanced' } };
    const variables: Record<string, string> = stackVariables_build({ domain: 'quay', spec, tenancyId: 't', compartmentId: QUAY_COMPARTMENT, region: REGION, baseDomain: 'oci.example.org', isoLink: 'https://x', sshPublicKey: 'ssh-ed25519 k' });
    expect(stackSpec_derive(variables)).toEqual({ spec, baseDomain: 'oci.example.org' });
    expect(stackSpec_derive({ zone_dns: 'z' })).toEqual({ spec: null, baseDomain: 'z' });
  });
});

describe('a session over a tenancy holding a domain it keeps nothing of', () => {
  let root: string;
  let store: DomainStore;
  let world: FakeBuildWorld;
  let builder: FakeCloudBuilder;
  let context: DomainCommandContext;

  /** The session over a driver. */
  function context_make(driver: CloudDriver): DomainCommandContext {
    const domains: DomainTree = new DomainTree({ sources: [], owner: (): string => 'rudolph', now: (): Date => new Date('2026-10-26T20:00:00.000Z'), store });
    const deps: BuildDeps = { store, builder, installer: new FakeInstaller(world), zones: 3, version: '4.22', pollMs: 0, hostsWaitMs: 1000, installWaitMs: 1000 };
    return { domains, driver, region: (): string => REGION, domainsPath: (): string => '/net/oci/fnndsc/domains', build: { domains, store, driver, region: (): string => REGION, deps, builder, baseDomain: 'fake.example' } };
  }

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'stratus-found-'));
    store = new DomainStore(root);
    world = new FakeBuildWorld(0);
    builder = new FakeCloudBuilder(world);
    context = context_make(new FakeDriver(cloud_make()));
  });
  afterEach(() => { rmSync(root, { recursive: true, force: true }); });

  it('domain status lists it as found, not adopted, STOPPED while nothing lives in its compartment, and the model says so', async () => {
    const answer = await domain_run(context, []);
    const text: string = answer.rendered.replace(ANSI, '');
    expect(text).toContain('quay');
    expect(text).toContain(`found        stack ${QUAY_STACK} (active), compartment ${QUAY_COMPARTMENT}; not adopted: domain adopt quay keeps it here`);
    const model = answer.model?.data as { domains: Array<{ name: string; origin?: string; condition?: string; refused?: Record<string, string> }> };
    expect(model.domains.map((domain) => [domain.name, domain.origin, domain.condition])).toEqual([['quay', 'found', 'STOPPED']]);
    expect(model.domains[0]?.refused?.['build']).toBe('found in the tenancy, not adopted: domain adopt quay first');
    expect((await domain_run(context, ['quay'])).rendered).toBe(answer.rendered);
  });

  it('a found domain is refused the build verbs by name, and the status says when the tenancy was not searched', async () => {
    expect((await domain_run(context, ['plan', 'quay'])).renderedErr).toBe('domain plan: quay: found in the tenancy, not adopted: domain adopt quay first\n');
    expect((await domain_run(context, ['teardown', 'quay'])).renderedErr).toBe('domain teardown: quay: found in the tenancy, not adopted: domain adopt quay first\n');
    const failing = new FakeDriver(cloud_make());
    failing.domains_find = async (): Promise<FoundDomain[]> => { throw new Error('search refused'); };
    const unsearched = await domain_run(context_make(failing), []);
    expect(unsearched.rendered.replace(ANSI, '')).toContain('no domains here (the tenancy was not searched: search refused)');
  });

  it('domain adopt <name> with no checkout keeps the found domain here from what its stack says, and the build verbs then answer', async () => {
    const spec: DomainSpec = { ...SPEC_DEFAULT, workers: { count: 2, vcpu: 8, ramGib: 32, bootGib: 120, bootTier: 'balanced' } };
    world.stacks.set(QUAY_STACK, { state: 'active', compartmentId: QUAY_COMPARTMENT, baseDomain: 'oci.example.org', spec });
    const adopted = await domain_run(context, ['adopt', 'quay']);
    expect(adopted.renderedErr ?? '').toBe('');
    const text: string = adopted.rendered.replace(ANSI, '');
    expect(text).toContain(`quay  adopted from the tenancy: stack ${QUAY_STACK} (active), compartment ${QUAY_COMPARTMENT}`);
    expect(text).toContain('the spec its stack says');
    expect(text).toContain('copy them into');
    const record: DomainRecord | null = store.record_read('quay');
    expect(record?.ids['stackRef']).toBe(QUAY_STACK);
    expect(record?.adopted?.from).toBe('the tenancy');
    expect(record?.compartmentId).toBe(QUAY_COMPARTMENT);
    expect(record?.baseDomain).toBe('oci.example.org');
    expect(record?.steps['compartment']?.state).toBe('done');
    expect(record?.protected).toBe(true);
    expect(store.spec_read('quay')?.spec).toEqual(spec);
    const status = await domain_run(context, ['status', 'quay']);
    const model = status.model?.data as { domains: Array<{ origin?: string }> };
    expect(model.domains[0]?.origin).toBe('adopted');
    expect((await domain_run(context, ['adopt', 'quay'])).rendered).toBe(`quay: already adopted; its stack is ${QUAY_STACK}\n`);
    expect((await domain_run(context, ['adopt', 'nope'])).renderedErr).toBe('domain adopt: nope: nothing in the tenancy is tagged mise-domain=nope; a harbor-oci checkout adopts with --from\n');
  });

  it('a domain kept here stands in for the one found under its name', async () => {
    world.stacks.set(QUAY_STACK, { state: 'active', compartmentId: QUAY_COMPARTMENT, baseDomain: null, spec: null });
    await domain_run(context, ['adopt', 'quay']);
    expect(store.spec_read('quay')?.spec).toEqual(SPEC_DEFAULT);
    const model = (await domain_run(context, [])).model?.data as { domains: Array<{ name: string; origin?: string }> };
    expect(model.domains).toHaveLength(1);
    expect(model.domains[0]?.origin).toBe('adopted');
  });
});
