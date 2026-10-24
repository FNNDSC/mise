/**
 * @file What the TD controller draws of a domain, read from the host
 * (docs/stratus.adoc, D13): its condition in one word, whether money runs,
 * what it is (built here, adopted, read from a checkout) and what is refused
 * on it, its spec, each step with its times, the build's task while it
 * runs, the last plan counted with drift apart, and the last verify check by
 * check. Nothing here asks the cloud: `domain status` adds the live counts
 * and the cost, and a build's state event carries this alone.
 *
 * @module
 */
import * as fs from 'fs';
import * as path from 'path';
import { taskState_isOver, type DomainCondition, type DomainSummary, type PlanSummary, type VerifyCheckModel } from '@fnndsc/menu';
import { runner_get, type JobRecord } from '@fnndsc/brasa/core';
import { plan_count, type InfraPlan, type PlanRow } from '../cloud/builder.js';
import { lastDone_find, type HarborDomain, type StepState } from '../domains/harborOci.js';
import type { DomainRecord, DomainStore } from './state.js';
import { buildJob_id, FIRST_BILLING_STEP, stepNext_find, STEPS_SOURCE } from './steps.js';

import { VERIFY_FILE, type VerifyKept } from './verify.js';

export { VERIFY_FILE, type VerifyKept };

/** The parts of a summary the controller draws, beyond the tile's glance. */
export type DomainReadout = Required<Pick<DomainSummary, 'condition' | 'billing' | 'origin' | 'protected' | 'refused' | 'region' | 'compartment' | 'gone' | 'spec' | 'next' | 'billingStep' | 'running' | 'plan' | 'verify' | 'asking'>>;

/**
 * A step's state, as kept or as read from a checkout.
 *
 * @param domain - The domain.
 * @param name - The step.
 * @returns Its state, or `not done`.
 */
function stepState_read(domain: HarborDomain, name: string): string {
  return domain.steps.find((step: StepState): boolean => step.name === name)?.state ?? 'not done';
}

/**
 * Where a domain stands in one word.
 *
 * @param domain - The domain.
 * @param record - Its state on the host, or null for one read from a checkout.
 * @param running - Whether its build is running.
 * @param asking - Whether the engine waits on a question about it.
 * @returns The condition.
 */
export function condition_derive(domain: HarborDomain, record: DomainRecord | null, running: boolean, asking: boolean): DomainCondition {
  if (record?.gone !== undefined) return 'GONE';
  if (asking) return 'ASKING';
  if (running || domain.steps.some((step: StepState): boolean => step.state === 'running')) return 'BUILDING';
  if (domain.steps.some((step: StepState): boolean => step.state === 'failed')) return 'FAILED';
  if (stepState_read(domain, 'smoke') === 'done') return 'SERVING';
  if (stepState_read(domain, 'run') === 'done') return 'UP';
  if (domain.steps.some((step: StepState): boolean => step.state === 'done')) return 'STOPPED';
  return 'SIZING';
}

/**
 * The verbs refused on a domain, with why, in the words the verbs refuse with.
 *
 * @param domain - The domain.
 * @param record - Its state on the host, or null.
 * @returns By verb.
 */
export function refusals_derive(domain: HarborDomain, record: DomainRecord | null): Record<string, string> {
  if (domain.origin !== 'built' || record === null) return { build: 'read from a harbor-oci checkout, not built here', teardown: 'read from a harbor-oci checkout, not built here' };
  if (record.adopted !== undefined) return { build: `adopted from ${record.adopted.from}`, teardown: 'adopted, not built here' };
  if (record.gone !== undefined) return { build: 'torn down', teardown: 'already torn down' };
  return record.protected !== false ? { teardown: `protected (domain protect ${domain.name} off lifts it)` } : {};
}

/**
 * The last plan, counted, its rows grouped by action and kind.
 *
 * @param plan - The plan.
 * @param at - When it was made.
 * @returns The summary.
 */
export function planSummary_build(plan: InfraPlan, at: string | null): PlanSummary {
  const counts = plan_count(plan);
  const created: Set<string> = new Set(plan.rows.filter((row: PlanRow): boolean => row.action === 'create').map((row: PlanRow): string => row.name));
  const destroyed: Set<string> = new Set(plan.rows.filter((row: PlanRow): boolean => row.action === 'destroy').map((row: PlanRow): string => row.name));
  const groups: Map<string, PlanSummary['groups'][number]> = new Map();
  for (const row of plan.rows) {
    const replaced: boolean = created.has(row.name) && destroyed.has(row.name);
    if (replaced && row.action === 'destroy') continue;
    const action: string = replaced ? 'replace' : row.action === 'change' && row.drift === true ? 'drift' : row.action;
    const key: string = `${action}\u0000${row.kind}`;
    const group = groups.get(key) ?? { action, kind: row.kind, count: 0, names: [] };
    group.count++;
    group.names.push(row.name);
    groups.set(key, group);
  }
  return { create: counts.create, replace: counts.replace, change: counts.change, drift: counts.drift, destroy: counts.destroy, groups: [...groups.values()], at };
}

/**
 * When one of a domain's files was written.
 *
 * @param store - The domains kept.
 * @param name - The domain.
 * @param file - The file.
 * @returns Its time, or null.
 */
function fileTime_read(store: DomainStore, name: string, file: string): string | null {
  try {
    return fs.statSync(path.join(store.folder_derive(name), file)).mtime.toISOString();
  } catch {
    return null;
  }
}

/**
 * What the controller draws of a domain, from the host.
 *
 * @param domain - The domain.
 * @param store - The domains this daemon keeps, or null when it keeps none.
 * @param job - The build's task, when one was ever started.
 * @param asking - The question the engine waits on about it, or null.
 * @returns The readout.
 */
export function domainReadout_build(domain: HarborDomain, store: DomainStore | null, job: JobRecord | undefined, asking: string | null = null): DomainReadout {
  const record: DomainRecord | null = store?.record_read(domain.name) ?? null;
  const running: boolean = job !== undefined && !taskState_isOver(job.state);
  const runningStep: string | null = domain.steps.find((step: StepState): boolean => step.state === 'running')?.name ?? null;
  const planText: string | null = store?.file_read(domain.name, 'plan.json') ?? null;
  const verifyText: string | null = store?.file_read(domain.name, VERIFY_FILE) ?? null;
  const verify: VerifyKept | null = verifyText === null ? null : JSON.parse(verifyText) as VerifyKept;
  const applied: boolean = stepState_read(domain, FIRST_BILLING_STEP) === 'done' || lastDone_find(domain) !== null && (record === null || record.adopted !== undefined);
  return {
    condition: condition_derive(domain, record, running, asking !== null),
    billing: record?.gone === undefined && applied,
    origin: domain.origin !== 'built' || record === null ? 'checkout' : record.adopted !== undefined ? 'adopted' : 'built',
    protected: record?.protected !== false,
    refused: refusals_derive(domain, record),
    region: record?.region ?? domain.settings['OCI_REGION'] ?? null,
    compartment: record?.compartmentId ?? domain.settings['OCI_COMPARTMENT_OCID'] ?? null,
    gone: record?.gone ?? null,
    spec: store?.spec_read(domain.name)?.spec ?? null,
    next: record === null || record.adopted !== undefined || record.gone !== undefined ? null : stepNext_find(record),
    billingStep: FIRST_BILLING_STEP,
    running: running ? { job: (job as JobRecord).id, step: runningStep, since: record?.steps[runningStep ?? '']?.started ?? (job as JobRecord).started } : null,
    plan: planText === null || store === null ? null : planSummary_build(JSON.parse(planText) as InfraPlan, fileTime_read(store, domain.name, 'plan.json')),
    verify: verify === null ? null : { at: verify.at, checks: verify.checks },
    asking,
  };
}

/**
 * A domain's steps for the model: each with its name, evidence and times.
 *
 * @param domain - The domain.
 * @param record - Its state on the host, or null.
 * @returns The steps.
 */
export function summarySteps_map(domain: HarborDomain, record: DomainRecord | null): DomainSummary['steps'] {
  return domain.steps.map((step: StepState) => ({
    folder: step.folder,
    state: step.state,
    name: step.name,
    evidence: step.evidence,
    started: record?.steps[step.name]?.started ?? null,
    ended: record?.steps[step.name]?.ended ?? null,
  }));
}

/**
 * One domain's summary as the host knows it, without asking the cloud: the
 * live counts null and the cost absent. What a build's state event carries.
 *
 * @param store - The domains this daemon keeps, or null.
 * @param domainsPath - The folder the domains stand in.
 * @param domain - The domain.
 * @param asking - The question the engine waits on about it, or null.
 * @returns The summary.
 */
export function domainSummary_read(store: DomainStore | null, domainsPath: string, domain: HarborDomain, asking: string | null = null): DomainSummary {
  const job: JobRecord | undefined = runner_get()?.job_get(STEPS_SOURCE, buildJob_id(domain.name));
  return {
    name: domain.name,
    path: `${domainsPath}/${domain.name}`,
    cluster: domain.cluster,
    lastDone: lastDone_find(domain)?.folder ?? null,
    steps: summarySteps_map(domain, store?.record_read(domain.name) ?? null),
    resources: null,
    ...domainReadout_build(domain, store, job, asking),
  };
}
