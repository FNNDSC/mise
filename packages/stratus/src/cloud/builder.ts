/**
 * @file The cloud driver's build half: what a domain's steps ask of a cloud
 * (docs/stratus.adoc, D3). The read half is `driver.ts`; a cloud that cannot
 * build yet has a driver and no builder, and the build verbs say so.
 *
 * OCI's builder runs Terraform in Resource Manager: a plan is a plan job
 * read as JSON, an apply is an apply job. Its plan says which changes are
 * `Oracle-Tags` drift, so a re-plan can be read for real change (D6).
 *
 * @module
 */
import type { DomainSpec } from '../domain/spec.js';
import type { PlatformManifest } from '../installer/installer.js';

/** One check the build makes before it starts. */
export interface PreflightCheck {
  name: string;
  ok: boolean;
  note: string;
}

/** One change a plan would make. */
export interface PlanRow {
  action: 'create' | 'change' | 'destroy';
  /** The neutral kind (`instances`, `loadbalancers`, …) or the cloud's own. */
  kind: string;
  name: string;
  /** A change the cloud makes to its own tags after an apply, not a real one. */
  drift?: boolean;
}

/**
 * An infrastructure plan, as the operator is asked about it.
 *
 * @property ref - The cloud's handle on it, for the apply (OCI: the plan job's id).
 * @property rows - Each change.
 */
export interface InfraPlan {
  ref: string;
  rows: ReadonlyArray<PlanRow>;
}

/** A plan's counts: a resource both destroyed and created is replaced, drift is apart from real change. */
export interface PlanCounts {
  create: number;
  replace: number;
  change: number;
  drift: number;
  destroy: number;
  /** The kinds replaced, for the line. */
  replacedKinds: string[];
}

/**
 * A plan's counts (D6).
 *
 * @param plan - The plan.
 * @returns Creations, replacements, real changes, drift, destructions.
 */
export function planCounts_of(plan: InfraPlan): PlanCounts {
  const rows: ReadonlyArray<PlanRow> = plan.rows;
  const created: Set<string> = new Set(rows.filter((row: PlanRow): boolean => row.action === 'create').map((row: PlanRow): string => row.name));
  const replaced: PlanRow[] = rows.filter((row: PlanRow): boolean => row.action === 'destroy' && created.has(row.name));
  const replacedNames: Set<string> = new Set(replaced.map((row: PlanRow): string => row.name));
  return {
    create: rows.filter((row: PlanRow): boolean => row.action === 'create' && !replacedNames.has(row.name)).length,
    replace: replaced.length,
    change: rows.filter((row: PlanRow): boolean => row.action === 'change' && row.drift !== true).length,
    drift: rows.filter((row: PlanRow): boolean => row.action === 'change' && row.drift === true).length,
    destroy: rows.filter((row: PlanRow): boolean => row.action === 'destroy' && !replacedNames.has(row.name)).length,
    replacedKinds: [...new Set(replaced.map((row: PlanRow): string => row.kind))].sort(),
  };
}

/**
 * Whether a plan touches anything that exists, drift aside: what an apply refuses unless asked by name.
 *
 * @param counts - The plan's counts.
 * @returns True when it replaces, changes or destroys.
 */
export function planCounts_alter(counts: PlanCounts): boolean {
  return counts.replace > 0 || counts.change > 0 || counts.destroy > 0;
}

/**
 * A plan's counts in a line.
 *
 * @param counts - The counts.
 * @returns `3 to create, 21 to replace (loadbalancers), 0 to change and 24 Oracle-Tags drift, 0 to destroy`.
 */
export function planCounts_words(counts: PlanCounts): string {
  const replace: string = counts.replace > 0 ? `, ${counts.replace} to replace (${counts.replacedKinds.join(', ')})` : '';
  const drift: string = counts.drift > 0 ? ` and ${counts.drift} Oracle-Tags drift` : '';
  return `${counts.create} to create${replace}, ${counts.change} to change${drift}, ${counts.destroy} to destroy`;
}

/** What every builder call is given to report with and to stop on. */
export interface BuildCall {
  /** Writes a line to the step's log. */
  readonly log: (line: string) => void;
  /** Aborted when the operator asks the step to stop. */
  readonly signal: AbortSignal;
}

/** The addresses an apply leaves for the DNS records. */
export interface InfraOutputs {
  /** The API's load balancer address. */
  apiIp: string;
  /** The internal API's address. */
  apiIntIp: string;
  /** The applications' (`*.apps`) address. */
  appsIp: string;
  /** The stack's handle, for a later plan and the teardown. */
  stackRef: string;
}

/** A cloud's build half. */
export interface CloudBuilder {
  /** Its id (`oci`, `fake`). */
  readonly id: string;
  /** Checks the tenancy can take the domain: keys, limits, the tag namespace, the zone. */
  preflight(request: { domain: string; spec: DomainSpec; region: string; baseDomain: string }, call: BuildCall): Promise<PreflightCheck[]>;
  /** Puts the discovery image where the machines boot from, and returns its object's name. */
  iso_store(request: { domain: string; url: string; region: string }, call: BuildCall): Promise<{ object: string; expires: string }>;
  /** Plans the infrastructure: against the domain's stack when it has one (adopted, or a re-plan), else a new stack. */
  infra_plan(request: { domain: string; spec: DomainSpec; region: string; isoObject: string; stackRef?: string }, call: BuildCall): Promise<InfraPlan>;
  /** Applies a plan. Billing starts here. */
  infra_apply(request: { domain: string; plan: InfraPlan; region: string }, call: BuildCall): Promise<InfraOutputs>;
  /** Writes the cluster's records in its zone. */
  dns_upsert(request: { domain: string; baseDomain: string; outputs: InfraOutputs }, call: BuildCall): Promise<string[]>;
  /** The platform's manifests for the installer. */
  manifests_of(): Promise<PlatformManifest[]>;
  /** Takes in infrastructure built elsewhere: a stack with its variables and its Terraform state; returns the stack's handle. */
  stack_adopt?(request: { domain: string; region: string; compartmentId: string; variables: Record<string, string>; state: Buffer; stackVersion: string }, call: BuildCall): Promise<string>;
}
