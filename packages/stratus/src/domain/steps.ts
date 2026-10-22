/**
 * @file A domain's build steps, written once over the three drivers
 * (docs/stratus.adoc, D3): their names and order, what each asks of the
 * cloud's builder and of the installer, and the run that takes a domain from
 * its first step not done to where it was asked to stop.
 *
 * A run is one of the core runner's jobs (`/proc/steps/<domain>-build`): it
 * outlives the command that started it and every surface. It stops on its
 * own before the first step that bills until the operator has accepted the
 * cost, which only the foreground `domain build` asks; and before a step
 * this session does not have yet. Every step records what later ones need in
 * the domain's state, so a run picked up after a restart starts from the
 * first step not done and repeats nothing the cloud already holds.
 *
 * The order and the waits are `harbor-oci`'s, proven live once: the hosts
 * have 45 minutes to register, the install 120.
 *
 * @module
 */
import type { JobContext, JobRun } from '@fnndsc/brasa/core';
import { planCounts_of, type BuildCall, type CloudBuilder, type InfraOutputs, type InfraPlan, type PreflightCheck } from '../cloud/builder.js';
import type { Installer, InstallerHost, InstallStatus } from '../installer/installer.js';
import { specNodes_of, type DomainSpec, type SpecNode } from './spec.js';
import type { DomainRecord, DomainStore, StepRecord } from './state.js';

/** The build's steps, in order: the machine, then ChRIS on it. */
export const BUILD_STEPS: ReadonlyArray<string> = ['preflight', 'cluster', 'iso', 'infra-plan', 'infra-apply', 'dns', 'manifests', 'hosts', 'run', 'postinstall', 'verify', 'chris-deploy', 'chris-seed', 'smoke'];

/** The first step that bills: the run stops before it until the cost is accepted. */
export const FIRST_BILLING_STEP: string = 'infra-apply';

/** The steps this session has; the run stops before any other. */
export const STEPS_WRITTEN: ReadonlyArray<string> = ['preflight', 'cluster', 'iso', 'infra-plan', 'infra-apply', 'dns', 'manifests', 'hosts', 'run'];

/** The task source the runs are kept in. */
export const STEPS_SOURCE: string = 'steps';

/** What the steps run over. */
export interface BuildDeps {
  readonly store: DomainStore;
  readonly builder: CloudBuilder;
  readonly installer: Installer;
  /** How many availability domains the region has. */
  readonly zones: number;
  /** The OpenShift version a cluster is made at. */
  readonly version: string;
  /** How often a wait asks again, in milliseconds. */
  readonly pollMs: number;
  /** How long the hosts have to register, in milliseconds. */
  readonly hostsWaitMs: number;
  /** How long the install has, in milliseconds. */
  readonly installWaitMs: number;
}

/** The waits `harbor-oci` proved, polled each minute. */
export const BUILD_WAITS: Pick<BuildDeps, 'pollMs' | 'hostsWaitMs' | 'installWaitMs'> = { pollMs: 60_000, hostsWaitMs: 45 * 60_000, installWaitMs: 120 * 60_000 };

/**
 * A run's job id.
 *
 * @param domain - The domain.
 * @returns `<domain>-build`.
 */
export function buildJob_id(domain: string): string {
  return `${domain}-build`;
}

/**
 * The first step not done.
 *
 * @param record - The domain's state.
 * @returns The step, or null when every step is done.
 */
export function stepNext_of(record: DomainRecord): string | null {
  return BUILD_STEPS.find((step: string): boolean => record.steps[step]?.state !== 'done') ?? null;
}

/** What a step is handed. */
interface StepCall extends BuildCall {
  readonly name: string;
  readonly spec: DomainSpec;
  readonly deps: BuildDeps;
  readonly record: () => DomainRecord;
  readonly remember: (ids: Record<string, string>) => void;
  readonly progress: JobContext['progress_set'];
}

/**
 * Waits a poll, unless stopped.
 *
 * @param ms - How long.
 * @param signal - Stops it.
 */
function poll_wait(ms: number, signal: AbortSignal): Promise<void> {
  if (ms <= 0 || signal.aborted) return Promise.resolve();
  return new Promise<void>((resolve: () => void): void => {
    const timer: ReturnType<typeof setTimeout> = setTimeout(resolve, ms);
    signal.addEventListener('abort', (): void => { clearTimeout(timer); resolve(); }, { once: true });
  });
}

/**
 * An id a later step needs, or why it is missing.
 *
 * @param record - The domain's state.
 * @param key - The id.
 * @param step - The step that records it.
 * @returns The id.
 * @throws Error - When it was never recorded.
 */
function id_need(record: DomainRecord, key: string, step: string): string {
  const value: string | undefined = record.ids[key];
  if (value === undefined) throw new Error(`no ${key} recorded: ${step} has not been done`);
  return value;
}

/** Each step's work. */
const STEP_WORK: Readonly<Record<string, (call: StepCall) => Promise<string>>> = {
  preflight: async (call: StepCall): Promise<string> => {
    const record: DomainRecord = call.record();
    const checks: PreflightCheck[] = await call.deps.builder.preflight({ domain: call.name, spec: call.spec, region: record.region, baseDomain: record.baseDomain }, call);
    const failed: PreflightCheck[] = checks.filter((check: PreflightCheck): boolean => !check.ok);
    if (failed.length > 0) throw new Error(`preflight: ${failed.map((check: PreflightCheck): string => `${check.name}: ${check.note}`).join('; ')}`);
    return `${checks.length} checks pass`;
  },
  cluster: async (call: StepCall): Promise<string> => {
    const record: DomainRecord = call.record();
    if (record.ids['clusterId'] !== undefined) return `already made: ${record.ids['clusterId']}`;
    const made = await call.deps.installer.cluster_create({ name: call.name, baseDomain: record.baseDomain, version: call.deps.version });
    call.remember({ clusterId: made.clusterId, infraEnvId: made.infraEnvId });
    call.log(`installer: cluster ${made.clusterId}, infra-env ${made.infraEnvId}`);
    return `cluster ${made.clusterId}`;
  },
  iso: async (call: StepCall): Promise<string> => {
    const record: DomainRecord = call.record();
    const image = await call.deps.installer.isoUrl_get(id_need(record, 'infraEnvId', 'cluster'));
    const stored = await call.deps.builder.iso_store({ domain: call.name, url: image.url, region: record.region }, call);
    call.remember({ isoObject: stored.object, isoExpires: stored.expires });
    return `${stored.object}, linked until ${stored.expires.slice(0, 10)}`;
  },
  'infra-plan': async (call: StepCall): Promise<string> => {
    const record: DomainRecord = call.record();
    const plan: InfraPlan = await call.deps.builder.infra_plan({ domain: call.name, spec: call.spec, region: record.region, isoObject: id_need(record, 'isoObject', 'iso') }, call);
    const counts = planCounts_of(plan);
    call.deps.store.file_write(call.name, 'plan.json', `${JSON.stringify(plan, null, 2)}\n`);
    call.remember({ planRef: plan.ref });
    if (counts.change > 0 || counts.destroy > 0) throw new Error(`the plan alters ${counts.change} and destroys ${counts.destroy} existing resources: refused`);
    return `${counts.create} to create, ${counts.change} to change${counts.drift > 0 ? ` (and ${counts.drift} tag drift)` : ''}, ${counts.destroy} to destroy`;
  },
  'infra-apply': async (call: StepCall): Promise<string> => {
    const record: DomainRecord = call.record();
    if (record.ids['stackRef'] !== undefined) return `already applied: ${record.ids['stackRef']}`;
    const text: string | null = call.deps.store.file_read(call.name, 'plan.json');
    if (text === null) throw new Error('no plan recorded: infra-plan has not been done');
    const plan: InfraPlan = JSON.parse(text) as InfraPlan;
    const outputs: InfraOutputs = await call.deps.builder.infra_apply({ domain: call.name, plan, region: record.region }, call);
    call.remember({ stackRef: outputs.stackRef, apiIp: outputs.apiIp, apiIntIp: outputs.apiIntIp, appsIp: outputs.appsIp });
    return `${planCounts_of(plan).create} created; billing since ${new Date().toISOString().slice(0, 16)}`;
  },
  dns: async (call: StepCall): Promise<string> => {
    const record: DomainRecord = call.record();
    const outputs: InfraOutputs = { stackRef: id_need(record, 'stackRef', 'infra-apply'), apiIp: id_need(record, 'apiIp', 'infra-apply'), apiIntIp: id_need(record, 'apiIntIp', 'infra-apply'), appsIp: id_need(record, 'appsIp', 'infra-apply') };
    const names: string[] = await call.deps.builder.dns_upsert({ domain: call.name, baseDomain: record.baseDomain, outputs }, call);
    return `${names.length} records`;
  },
  manifests: async (call: StepCall): Promise<string> => {
    const manifests = await call.deps.builder.manifests_of();
    await call.deps.installer.manifests_upload(id_need(call.record(), 'clusterId', 'cluster'), manifests);
    call.log(`sent ${manifests.map((manifest) => manifest.name).join(', ')}`);
    return `${manifests.length} platform manifests sent`;
  },
  hosts: async (call: StepCall): Promise<string> => {
    const clusterId: string = id_need(call.record(), 'clusterId', 'cluster');
    const nodes: SpecNode[] = specNodes_of(call.name, call.spec, call.deps.zones);
    const deadline: number = Date.now() + call.deps.hostsWaitMs;
    const assigned: Set<string> = new Set();
    let seen: number = -1;
    while (!call.signal.aborted) {
      const hosts: InstallerHost[] = await call.deps.installer.hosts_list(clusterId);
      for (const host of hosts.filter((entry: InstallerHost): boolean => !assigned.has(entry.name))) {
        const role: 'master' | 'worker' = nodes.find((node: SpecNode): boolean => node.name === host.name)?.role === 'worker' ? 'worker' : 'master';
        await call.deps.installer.role_set(clusterId, host.name, role);
        assigned.add(host.name);
        call.log(`${host.name} registered in ${host.zone} · role ${role}`);
      }
      if (hosts.length !== seen) { call.progress({ current: hosts.length, total: nodes.length, unit: 'nodes' }); seen = hosts.length; }
      if (hosts.length >= nodes.length) return `${hosts.length} of ${nodes.length} hosts registered`;
      if (Date.now() >= deadline) throw new Error(`${hosts.length} of ${nodes.length} hosts registered after ${Math.round(call.deps.hostsWaitMs / 60_000)} minutes`);
      await poll_wait(call.deps.pollMs, call.signal);
    }
    return 'stopped while waiting for hosts';
  },
  run: async (call: StepCall): Promise<string> => {
    const record: DomainRecord = call.record();
    const clusterId: string = id_need(record, 'clusterId', 'cluster');
    if (record.ids['installStarted'] === undefined) {
      await call.deps.installer.install_start(clusterId);
      call.remember({ installStarted: new Date().toISOString() });
    }
    const deadline: number = Date.now() + call.deps.installWaitMs;
    let last: number = -1;
    while (!call.signal.aborted) {
      const status: InstallStatus = await call.deps.installer.install_status(clusterId);
      if (status.percent !== last) { call.progress({ current: status.percent, total: 100 }); call.log(`install ${status.percent}% · ${status.note}`); last = status.percent; }
      if (status.state === 'installed') {
        call.deps.store.secret_write(call.name, 'kubeconfig', await call.deps.installer.kubeconfig_get(clusterId));
        return 'installed; the kubeconfig is on the host';
      }
      if (status.state === 'error') throw new Error(`the install failed: ${status.note}`);
      if (Date.now() >= deadline) throw new Error(`the install was at ${status.percent}% after ${Math.round(call.deps.installWaitMs / 60_000)} minutes`);
      await poll_wait(call.deps.pollMs, call.signal);
    }
    return 'stopped while installing';
  },
};

/**
 * Records a step's state.
 *
 * @param store - The domains.
 * @param name - The domain.
 * @param step - The step.
 * @param change - What changed.
 */
function step_record(store: DomainStore, name: string, step: string, change: StepRecord): void {
  store.record_update(name, (record: DomainRecord): void => { record.steps[step] = { ...record.steps[step], ...change }; });
}

/**
 * The run that builds a domain from its first step not done.
 *
 * @param name - The domain.
 * @param through - The last step to run; absent, as far as this session's steps go.
 * @param deps - What the steps run over.
 * @returns The job's work.
 */
export function buildRun_make(name: string, through: string | undefined, deps: BuildDeps): JobRun {
  return async (context: JobContext): Promise<void> => {
    const spec: DomainSpec | null = deps.store.spec_read(name)?.spec ?? null;
    if (spec === null) throw new Error(`${name}: its spec.yaml does not read`);
    if (deps.store.record_read(name)?.adopted !== undefined) throw new Error(`${name} was adopted: building on it is refused until it is allowed by name`);
    for (;;) {
      if (context.signal.aborted) return;
      const record: DomainRecord | null = deps.store.record_read(name);
      if (record === null) throw new Error(`${name}: no such domain`);
      const step: string | null = stepNext_of(record);
      if (step === null) { context.log_write('every step is done'); return; }
      if (!STEPS_WRITTEN.includes(step)) { context.log_write(`stopping before ${step}: not a step this session has yet`); context.data_set('stoppedBefore', step); return; }
      if (step === FIRST_BILLING_STEP && record.billingAccepted === undefined) {
        context.log_write(`stopping before ${step}: it starts billing, and waits on the operator's answer (domain build ${name})`);
        context.data_set('stoppedBefore', step);
        return;
      }
      context.data_set('step', step);
      step_record(deps.store, name, step, { state: 'running', started: new Date().toISOString() });
      context.log_write(`${step}: started`);
      const call: StepCall = {
        name, spec, deps,
        log: (line: string): void => context.log_write(`${step}: ${line}`),
        signal: context.signal,
        record: (): DomainRecord => deps.store.record_read(name) as DomainRecord,
        remember: (ids: Record<string, string>): void => { deps.store.record_update(name, (current: DomainRecord): void => { Object.assign(current.ids, ids); }); },
        progress: (progress): void => context.progress_set(progress),
      };
      let note: string;
      try {
        note = await (STEP_WORK[step] as (call: StepCall) => Promise<string>)(call);
      } catch (error: unknown) {
        const reason: string = error instanceof Error ? error.message : String(error);
        step_record(deps.store, name, step, { state: 'failed', ended: new Date().toISOString(), note: reason });
        throw new Error(`${step}: ${reason}`);
      }
      if (context.signal.aborted) {
        step_record(deps.store, name, step, { state: 'not done', note: 'stopped when asked' });
        return;
      }
      step_record(deps.store, name, step, { state: 'done', ended: new Date().toISOString(), note });
      context.log_write(`${step}: done · ${note}`);
      if (step === through) { context.data_set('stoppedBefore', stepNext_of(deps.store.record_read(name) as DomainRecord) ?? ''); return; }
    }
  };
}

/**
 * The run that plans a domain against its stack and records the plan:
 * an adopted domain's, or a built one's re-plan. It applies nothing.
 *
 * @param name - The domain.
 * @param builder - The cloud's build half.
 * @param store - The domains.
 * @returns The job's work.
 */
export function planRun_make(name: string, builder: CloudBuilder, store: DomainStore): JobRun {
  return async (context: JobContext): Promise<void> => {
    const record: DomainRecord | null = store.record_read(name);
    const spec: DomainSpec | null = store.spec_read(name)?.spec ?? null;
    if (record === null || spec === null) throw new Error(`${name}: no such domain, or its spec.yaml does not read`);
    const stackRef: string | undefined = record.ids['stackRef'];
    if (stackRef === undefined) throw new Error(`${name}: no stack yet`);
    const plan: InfraPlan = await builder.infra_plan(
      { domain: name, spec, region: record.region, isoObject: record.ids['isoObject'] ?? '', stackRef },
      { log: (line: string): void => context.log_write(line), signal: context.signal },
    );
    if (context.signal.aborted) return;
    store.file_write(name, 'plan.json', `${JSON.stringify(plan, null, 2)}\n`);
    const counts = planCounts_of(plan);
    context.log_write(`plan: ${counts.create} to create, ${counts.change} to change${counts.drift > 0 ? ` and ${counts.drift} Oracle-Tags drift` : ''}, ${counts.destroy} to destroy`);
  };
}
