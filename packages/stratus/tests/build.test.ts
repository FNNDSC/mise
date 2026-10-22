/**
 * @file Building a domain over the fake cloud and the fake installer: its
 * state on the host, the steps' run in the core's runner, and the verbs
 * `domain new`, `domain plan` and `domain build`.
 */
import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BufferSink, HeadlessSurface, JobRunner, runner_install, sink_set, surface_set, type CommandEnvelope, type JobRecord, type PromptRequest } from '@fnndsc/brasa/core';
import { FakeDriver, fakeCloud_sample } from '../src/cloud/fake/driver.js';
import { FakeBuildWorld, FakeCloudBuilder, FakeInstaller } from '../src/cloud/fake/builder.js';
import type { BuildCall, CloudBuilder, InfraPlan, PreflightCheck } from '../src/cloud/builder.js';
import { planCounts_of } from '../src/cloud/builder.js';
import { DomainStore, domainsRoot_of, type DomainRecord } from '../src/domain/state.js';
import { SPEC_DEFAULT, specOptions_apply, type DomainSpec } from '../src/domain/spec.js';
import { buildJob_id, buildRun_make, stepNext_of, STEPS_SOURCE, type BuildDeps } from '../src/domain/steps.js';
import { cost_words, familyShape_find, specCost_of, specFit_read } from '../src/domain/sizing.js';
import { builtDomain_read } from '../src/domain/view.js';
import { DomainTree } from '../src/vfs/domains.js';
import { domain_run, type DomainCommandContext } from '../src/commands/domain.js';
import { options_read, spec_line, type BuildCommandContext } from '../src/commands/build.js';

const plain = (text: string | undefined): string => (text ?? '').replace(/\x1b\[[0-9;]*m/g, '');

/** A surface that may start tasks and answers every question as told. */
class GrantedSurface extends HeadlessSurface {
  answers: string[] = [];
  asked: string[] = [];
  constructor(tasks: boolean) {
    super();
    (this.capabilities as { tasks?: boolean }).tasks = tasks;
  }
  override async prompt(request: PromptRequest): Promise<string> {
    this.asked.push(request.message);
    return this.answers.shift() ?? 'n';
  }
}

describe('building a domain over the fakes', () => {
  let root: string;
  let store: DomainStore;
  let deps: BuildDeps;
  let runner: JobRunner;
  let surface: GrantedSurface;
  let sink: BufferSink;
  let context: DomainCommandContext;

  const record_new = (name: string, spec: DomainSpec = SPEC_DEFAULT): void => {
    store.create({ name, created: '2026-10-22T00:00:00.000Z', region: 'us-ashburn-1', baseDomain: 'fake.example', steps: {}, ids: {} }, spec);
  };

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'stratus-build-'));
    store = new DomainStore(join(root, 'domains'));
    const world: FakeBuildWorld = new FakeBuildWorld(0);
    deps = { store, builder: new FakeCloudBuilder(world), installer: new FakeInstaller(world), zones: 3, version: '4.22', pollMs: 0, hostsWaitMs: 1000, installWaitMs: 1000 };
    surface = new GrantedSurface(true);
    surface_set(surface);
    runner = new JobRunner(join(root, 'jobs'), [{ id: STEPS_SOURCE, label: 'build steps' }]);
    runner_install(runner);
    sink = new BufferSink();
    sink_set(sink);
    const driver: FakeDriver = new FakeDriver(fakeCloud_sample());
    const domains: DomainTree = new DomainTree({ sources: [], owner: (): string => 'rudolph', now: (): Date => new Date('2026-10-22T12:00:00Z'), store });
    const build: BuildCommandContext = { domains, store, driver, region: (): string => 'us-ashburn-1', deps, baseDomain: 'fake.example' };
    context = { domains, driver, region: (): string => 'us-ashburn-1', domainsPath: (): string => '/net/oci/fnndsc/domains', build };
  });
  afterEach(() => { runner_install(null); surface_set(new HeadlessSurface()); rmSync(root, { recursive: true, force: true }); });

  it('keeps a domain on the host: spec, state, secrets, files', () => {
    expect(domainsRoot_of({ XDG_STATE_HOME: '/s' })).toBe('/s/stratus/domains');
    record_new('trial');
    expect(store.names_list()).toEqual(['trial']);
    expect(() => record_new('trial')).toThrow('already kept');
    expect(store.spec_read('trial')?.spec).toEqual(SPEC_DEFAULT);
    expect(statSync(join(store.folder_of('trial'), 'state.json')).mode & 0o777).toBe(0o600);
    store.secret_write('trial', 'kubeconfig', 'secret');
    expect(store.secrets_list('trial')).toEqual([{ name: 'kubeconfig', hostPath: join(store.folder_of('trial'), 'auth', 'kubeconfig') }]);
    store.file_write('trial', 'plan.json', '{}');
    expect(store.file_read('trial', 'plan.json')).toBe('{}');
    expect(store.file_read('trial', 'nope')).toBeNull();
    expect(store.record_read('nope')).toBeNull();
    expect(store.spec_read('nope')).toBeNull();
    expect(() => store.record_update('nope', () => {})).toThrow('no such domain');
    expect(new DomainStore(join(root, 'none')).names_list()).toEqual([]);
  });

  it('runs to the first billing step, then from it once accepted, to the end of the steps it has', async () => {
    record_new('trial');
    const first: JobRecord = await runner.job_start(STEPS_SOURCE, buildJob_id('trial'), 'build trial', buildRun_make('trial', undefined, deps)).finished;
    expect(first.state).toBe('done');
    expect(first.data['stoppedBefore']).toBe('infra-apply');
    expect(stepNext_of(store.record_read('trial') as DomainRecord)).toBe('infra-apply');
    const planned: InfraPlan = JSON.parse(store.file_read('trial', 'plan.json') as string) as InfraPlan;
    expect(planCounts_of(planned)).toEqual({ create: 17, change: 0, drift: 0, destroy: 0 });
    store.record_update('trial', (record: DomainRecord): void => { record.billingAccepted = 'now'; });
    const second: JobRecord = await runner.job_start(STEPS_SOURCE, buildJob_id('trial'), 'build trial', buildRun_make('trial', undefined, deps)).finished;
    expect(second.data['stoppedBefore']).toBe('postinstall');
    const record: DomainRecord = store.record_read('trial') as DomainRecord;
    expect(record.steps['run']).toMatchObject({ state: 'done', note: 'installed; the kubeconfig is on the host' });
    expect(record.ids).toMatchObject({ clusterId: 'cluster-trial', infraEnvId: 'infraenv-trial', isoObject: 'trial-discovery.iso' });
    expect(store.secrets_list('trial').map((secret) => secret.name)).toEqual(['kubeconfig']);
    expect(runner.log_read(STEPS_SOURCE, buildJob_id('trial'))).toContain('trial-cp-2 registered');
  });

  it('stops where it was asked to, and a step already done repeats nothing', async () => {
    record_new('trial');
    const run: JobRecord = await runner.job_start(STEPS_SOURCE, 'a', 'a', buildRun_make('trial', 'cluster', deps)).finished;
    expect(run.data['stoppedBefore']).toBe('iso');
    store.record_update('trial', (record: DomainRecord): void => { record.steps['cluster'] = { state: 'not done' }; });
    await runner.job_start(STEPS_SOURCE, 'b', 'b', buildRun_make('trial', 'cluster', deps)).finished;
    expect(store.record_read('trial')?.steps['cluster']?.note).toBe('already made: cluster-trial');
  });

  it('fails a step that fails, saying why, and refuses a plan that alters what exists', async () => {
    record_new('trial');
    const refusing: CloudBuilder = Object.assign(Object.create(deps.builder) as CloudBuilder, {
      preflight: async (): Promise<PreflightCheck[]> => [{ name: 'quota', ok: false, note: 'no E5 cores left' }],
    });
    const failed: JobRecord = await runner.job_start(STEPS_SOURCE, 'a', 'a', buildRun_make('trial', undefined, { ...deps, builder: refusing })).finished;
    expect(failed).toMatchObject({ state: 'failed', outcome: 'preflight: preflight: quota: no E5 cores left' });
    expect(store.record_read('trial')?.steps['preflight']?.state).toBe('failed');
    const altering: CloudBuilder = Object.assign(Object.create(deps.builder) as CloudBuilder, {
      infra_plan: async (_r: unknown, _c: BuildCall): Promise<InfraPlan> => ({ ref: 'p', rows: [{ action: 'change', kind: 'instances', name: 'x' }, { action: 'change', kind: 'instances', name: 'y', drift: true }] }),
    });
    const refused: JobRecord = await runner.job_start(STEPS_SOURCE, 'b', 'b', buildRun_make('trial', undefined, { ...deps, builder: altering })).finished;
    expect(refused.outcome).toBe('infra-plan: the plan alters 1 and destroys 0 existing resources: refused');
    expect(planCounts_of({ ref: 'p', rows: [{ action: 'change', kind: 'i', name: 'y', drift: true }, { action: 'destroy', kind: 'i', name: 'z' }] })).toEqual({ create: 0, change: 0, drift: 1, destroy: 1 });
  });

  it('a run with no spec, or no domain, fails saying so', async () => {
    expect((await runner.job_start(STEPS_SOURCE, 'a', 'a', buildRun_make('ghost', undefined, deps)).finished).outcome).toBe('ghost: its spec.yaml does not read');
  });

  it('stops when asked, leaving the step not done', async () => {
    record_new('slow');
    const world: FakeBuildWorld = new FakeBuildWorld(40);
    const slow: BuildDeps = { ...deps, builder: new FakeCloudBuilder(world), installer: new FakeInstaller(world) };
    const { finished } = runner.job_start(STEPS_SOURCE, 'slow', 'slow', buildRun_make('slow', undefined, slow));
    setTimeout(() => runner.job_stop(STEPS_SOURCE, 'slow'), 10);
    expect((await finished).state).toBe('cancelled');
    expect(store.record_read('slow')?.steps['preflight']).toMatchObject({ state: 'not done', note: 'stopped when asked' });
  });

  it('times a host wait and an install out', async () => {
    record_new('stuck');
    store.record_update('stuck', (record: DomainRecord): void => {
      for (const step of ['preflight', 'cluster', 'iso', 'infra-plan', 'infra-apply', 'dns', 'manifests']) record.steps[step] = { state: 'done' };
      record.ids['clusterId'] = 'cluster-stuck';
    });
    const failed: JobRecord = await runner.job_start(STEPS_SOURCE, 'a', 'a', buildRun_make('stuck', undefined, { ...deps, hostsWaitMs: -1 })).finished;
    expect(failed.outcome).toBe('hosts: 0 of 3 hosts registered after 0 minutes');
  });

  it('shows a built domain as every domain is shown', () => {
    record_new('trial');
    const view = builtDomain_read(store, 'trial');
    expect(view).toMatchObject({ name: 'trial', origin: 'built', cluster: 'trial.fake.example', settings: { CLUSTER_NAME: 'trial', BASE_DOMAIN: 'fake.example' } });
    expect(view?.steps[0]).toEqual({ folder: '01-preflight', name: 'preflight', state: 'not done', evidence: 'not run yet' });
    expect(view?.steps[9]?.evidence).toBe('not a step this session has yet');
    expect(builtDomain_read(store, 'nope')).toBeNull();
  });

  it('reads what a spec needs and costs', async () => {
    const driver: FakeDriver = new FakeDriver(fakeCloud_sample());
    const spec: DomainSpec = (specOptions_apply(SPEC_DEFAULT, new Map([['--workers', '2x8/32']])) as { spec: DomainSpec }).spec;
    const shape = familyShape_find(await driver.shapes_list('us-ashburn-1'), 'e5');
    const cost = specCost_of(spec, shape, await driver.prices_list());
    expect(cost?.hourly).toBeCloseTo(40 * 0.015 + 136 * 0.002);
    expect(cost_words(cost!)).toBe('$0.87 an hour (compute and memory (40 vCPU, 136 GiB); volumes and load balancers are not priced yet)');
    expect(cost_words({ hourly: 1, currency: 'EUR', covers: 'x' })).toBe('EUR 1.00 an hour (x)');
    expect(specCost_of(spec, undefined, [])).toBeNull();
    const fits = await specFit_read(driver, 'us-ashburn-1', 'trial', spec);
    expect(fits[0]).toMatchObject({ zone: 'Uocm:US-ASHBURN-AD-1', nodes: ['trial-cp-0', 'trial-w-0'], coresNeeded: 8, coresFree: 9238, memoryNeeded: 56 });
  });

  it('domain new writes a spec and nothing else, and refuses what it cannot take', async () => {
    const made: CommandEnvelope = await domain_run(context, ['new', 'trial', '--workers', '2x8/32', '--data=100']);
    expect(plain(made.rendered)).toContain('trial  trial.fake.example  spec written');
    expect(plain(made.rendered)).toContain('workers 2 × 8 vCPU 32 GiB · ChRIS data 100 GiB');
    expect((await domain_run(context, ['new', 'trial'])).renderedErr).toBe('domain new: trial: File exists\n');
    expect((await domain_run(context, ['new', 'Trial'])).renderedErr).toContain("a domain's name is a DNS label");
    expect((await domain_run(context, ['new'])).renderedErr).toContain('usage: domain new <name>');
    expect((await domain_run(context, ['new', 'x', '--colour', 'red'])).renderedErr).toContain('--colour: unknown option');
    expect((await domain_run(context, ['new', 'x', '--workers'])).renderedErr).toContain('--workers takes a value');
    expect((await domain_run(context, ['new', 'x', '--plane', '2x8/24'])).renderedErr).toContain('the control plane is three nodes');
    const unanchored: DomainCommandContext = { ...context, build: { ...context.build!, baseDomain: null } };
    expect((await domain_run(unanchored, ['new', 'y'])).renderedErr).toContain('--base-domain <zone> is needed');
    const offline: DomainCommandContext = { ...context, build: { ...context.build!, region: (): null => null } };
    expect((await domain_run(offline, ['new', 'y'])).renderedErr).toBe('domain new: not connected\n');
    expect(options_read(['a', '--x=1'], ['--x'])).toEqual({ options: new Map([['--x', '1']]), rest: ['a'] });
    expect(spec_line(SPEC_DEFAULT)).toBe('E5 · plane 3 × 8 vCPU 24 GiB · workers 0 (compact) · ChRIS data 20 GiB');
  });

  it('domain plan reads only, and says the plan itself needs the tier', async () => {
    record_new('trial');
    surface_set(new GrantedSurface(false));
    const plan: string = plain((await domain_run(context, ['plan', 'trial'])).rendered);
    expect(plan).toContain('fit, E5 per availability domain (us-ashburn-1):');
    expect(plan).toContain('$0.50 an hour');
    expect(plan).toContain('steps next: preflight');
    expect(plan).toContain('the infrastructure plan needs the tasks tier');
    surface_set(surface);
    expect(plain((await domain_run(context, ['plan'])).rendered)).toContain('domain build trial --through infra-plan makes it');
    store.file_write('trial', 'plan.json', JSON.stringify({ ref: 'p', rows: [{ action: 'create', kind: 'i', name: 'a' }, { action: 'change', kind: 'i', name: 'b', drift: true }] }));
    expect(plain((await domain_run(context, ['plan', 'trial'])).rendered)).toContain('plan  1 to create, 0 to change and 1 Oracle-Tags drift, 0 to destroy');
    expect((await domain_run(context, ['plan', 'nope'])).renderedErr).toBe('domain plan: nope: no such domain\n');
    expect((await domain_run(context, ['plan', '-x'])).renderedErr).toBe('domain plan: usage: domain plan [<name>]\n');
    record_new('other');
    expect((await domain_run(context, ['plan'])).renderedErr).toBe('domain plan: which domain? (other, trial)\n');
  });

  it('domain build asks before billing, follows the run, and says where it stopped', async () => {
    record_new('trial');
    surface.answers = ['n'];
    const declined: CommandEnvelope = await domain_run(context, ['build', 'trial']);
    expect(plain(declined.rendered)).toBe('stopped before infra-apply; nothing bills (domain build trial asks again)\n');
    expect(surface.asked[0]).toBe('infra-apply creates 17 resources. Billing starts at $0.50 an hour (compute and memory (24 vCPU, 72 GiB); volumes and load balancers are not priced yet). Continue? [y/N]');
    expect(sink.text_get()).toContain('infra-plan: done');
    surface.answers = ['y'];
    const built: CommandEnvelope = await domain_run(context, ['build', 'trial']);
    expect(plain(built.rendered)).toBe('trial: built through run; postinstall and after are not steps this session has yet\n');
    expect(store.record_read('trial')?.billingAccepted).toBeDefined();
    expect(plain((await domain_run(context, ['status', 'trial'])).rendered)).toContain('built here');
  });

  it('domain build stops where asked, and refuses what it cannot do', async () => {
    record_new('trial');
    expect(plain((await domain_run(context, ['build', 'trial', '--through', 'cluster'])).rendered)).toBe('trial: done through cluster; next: iso\n');
    expect((await domain_run(context, ['build', 'trial', '--through', 'nope'])).renderedErr).toContain('--through nope: no such step');
    expect((await domain_run(context, ['build', 'trial', '--colour'])).renderedErr).toContain('--colour: unknown option');
    expect((await domain_run(context, ['build', 'a', 'b'])).renderedErr).toContain('usage: domain build');
    surface_set(new GrantedSurface(false));
    expect((await domain_run(context, ['build', 'trial'])).renderedErr).toContain('starting a task needs the tasks tier');
    const unbuildable: DomainCommandContext = { ...context, build: { ...context.build!, deps: null } };
    expect((await domain_run(unbuildable, ['build', 'trial'])).renderedErr).toContain('build steps are not written yet');
    runner_install(null);
    expect((await domain_run(context, ['build', 'trial'])).renderedErr).toBe('domain build: this session runs no tasks\n');
    const noBuild: DomainCommandContext = { ...context, build: undefined };
    expect((await domain_run(noBuild, ['new', 'x'])).renderedErr).toBe('domain: new: this session builds no domains\n');
  });

  it('domain build refuses a domain read from a checkout', async () => {
    const checkout: DomainTree = new DomainTree({ sources: [{ name: 'harbor', root: join(root, 'missing') }], owner: (): string => 'r', now: (): Date => new Date(), store });
    const ctx: DomainCommandContext = { ...context, domains: checkout, build: { ...context.build!, domains: checkout } };
    expect((await domain_run(ctx, ['build', 'harbor'])).renderedErr).toBe('domain build: harbor: read from a harbor-oci checkout, not built here; adopting it comes with domain adopt\n');
  });
});
