/**
 * @file `domain new`, `domain plan` and `domain build`: making a domain's
 * spec, saying what it would take and cost, and building it (docs/stratus.adoc,
 * D6, D7, D10).
 *
 * `domain new` writes the spec and nothing else. `domain plan` reads only,
 * without the `tasks` tier: the fit per availability domain, the hourly cost
 * from the price list, where the steps stand; it says by name that the
 * infrastructure plan needs the tier. `domain build` starts the domain's run
 * in the core's runner and follows it; the run stops before the first step
 * that bills, and the command asks the operator, with the plan's counts and
 * the cost, before it goes on. Ctrl-C stops following, not the build.
 *
 * @module
 */
import chalk from 'chalk';
import { envelope_error, envelope_ok, STRATUS_DOMAIN_STATE_EVENT, taskState_isOver, type CommandEnvelope } from '@fnndsc/menu';
import {
  commandCancellation_enable, commandCancellation_signalGet, JobRefusal, repl_confirm, repl_question, repl_questionHidden, runner_get, sink_dataLine, sink_get, surface_get,
  type JobRecord, type JobRunner,
} from '@fnndsc/brasa/core';
import type { CloudDriver, CloudPrice, CloudShape } from '../cloud/driver.js';
import { planCounts_alter, planCounts_of, planCounts_words, type CloudBuilder, type InfraPlan } from '../cloud/builder.js';
import { adoption_keep, adoptRun_make, checkout_read, type CheckoutRead } from '../domain/adopt.js';
import type { InstallerAccountKeeper } from '../installer/account.js';
import type { VerifyReach } from './verify.js';
import type { HarborDomain } from '../domains/harborOci.js';
import type { DomainTree } from '../vfs/domains.js';
import { DOMAIN_NAME, type DomainRecord, type DomainStore } from '../domain/state.js';
import { SPEC_DEFAULT, specOptions_apply, type DomainSpec } from '../domain/spec.js';
import { cost_words, familyShape_find, specCost_of, specFit_read, type SpecCost, type ZoneFit } from '../domain/sizing.js';
import { domainSummary_read } from '../domain/readout.js';
import { BUILD_STEPS, buildJob_id, buildRun_make, FIRST_BILLING_STEP, planRun_make, stepNext_of, STEPS_SOURCE, STEPS_WRITTEN, type BuildDeps } from '../domain/steps.js';

/** What the build verbs read from the session. */
export interface BuildCommandContext {
  readonly domains: DomainTree;
  readonly store: DomainStore;
  readonly driver: CloudDriver;
  /** The session's region, or null when not connected. */
  readonly region: () => string | null;
  /** What the steps run over, or null when this cloud cannot build yet. */
  readonly deps: BuildDeps | null;
  /** The cloud's build half, for adopting and planning, or null when it has none. */
  readonly builder: CloudBuilder | null;
  /** How `verify` reaches a cluster; the network when absent. */
  readonly verifyReach?: VerifyReach;
  /** The DNS zone a new domain's names live under when `--base-domain` is not given. */
  readonly baseDomain: string | null;
  /** Where the installer's account is kept; a build asks for it when it is missing. */
  readonly account?: InstallerAccountKeeper;
  /** The folder the domains stand in (`/net/oci/<tenancy>/domains`), for the state event's paths. */
  readonly domainsPath?: () => string;
}

/**
 * Shows a domain as the host knows it, as a `stratus.domain.state` event: at
 * a build's start, on each line it logs and before each question,
 * so a surface watching (the TD controller) redraws without asking.
 *
 * @param context - The session.
 * @param name - The domain.
 * @param asking - The question about to be put, or null.
 */
export function domainState_show(context: BuildCommandContext, name: string, asking: string | null = null): void {
  const domain: HarborDomain | null = context.domains.domain_read(name);
  if (domain === null) return;
  sink_get().event_write?.(STRATUS_DOMAIN_STATE_EVENT, domainSummary_read(context.store, context.domainsPath?.() ?? '', domain, asking));
}

/** The options `domain new` takes, each with a value. */
const NEW_OPTIONS: ReadonlyArray<string> = ['--family', '--plane', '--workers', '--data', '--database', '--queue', '--base-domain', '--compartment'];

/**
 * Reads `--name value` and `--name=value` pairs.
 *
 * @param words - The words.
 * @param known - The options taken.
 * @returns The options and the other words, or the word refused.
 */
export function options_read(words: ReadonlyArray<string>, known: ReadonlyArray<string>): { options: Map<string, string>; rest: string[] } | { error: string } {
  const options: Map<string, string> = new Map();
  const rest: string[] = [];
  for (let i: number = 0; i < words.length; i++) {
    const word: string = words[i] as string;
    if (!word.startsWith('-')) { rest.push(word); continue; }
    const name: string = word.includes('=') ? word.slice(0, word.indexOf('=')) : word;
    if (!known.includes(name)) return { error: `${name}: unknown option` };
    const value: string | undefined = word.includes('=') ? word.slice(word.indexOf('=') + 1) : words[++i];
    if (value === undefined || value === '') return { error: `${name} takes a value` };
    options.set(name, value);
  }
  return { options, rest };
}

/**
 * A spec in a line.
 *
 * @param spec - The spec.
 * @returns `E5 · plane 3 × 8 vCPU 24 GiB · …`.
 */
export function spec_line(spec: DomainSpec): string {
  const workers: string = spec.workers.count === 0 ? 'workers 0 (compact)' : `workers ${spec.workers.count} × ${spec.workers.vcpu} vCPU ${spec.workers.ramGib} GiB`;
  return `${spec.family} · plane ${spec.controlPlane.count} × ${spec.controlPlane.vcpu} vCPU ${spec.controlPlane.ramGib} GiB · ${workers} · ChRIS data ${spec.chris.dataGib} GiB`;
}

/**
 * The DNS zones the tenancy holds, by name; none when the cloud cannot say.
 *
 * @param context - The session.
 * @param region - The region the calls go through.
 * @returns The zones' names.
 */
export async function dnsZones_read(context: BuildCommandContext, region: string): Promise<string[]> {
  if (context.builder?.zones_list === undefined) return [];
  try {
    return await context.builder.zones_list(region);
  } catch {
    return [];
  }
}

/**
 * The zone a new domain's names live under when none is named: the session's,
 * else the tenancy's only one; null when there is none, or several to choose
 * between.
 *
 * @param context - The session.
 * @param zones - The tenancy's zones.
 * @returns The zone, or null.
 */
export function baseDomain_default(context: BuildCommandContext, zones: ReadonlyArray<string>): string | null {
  return context.baseDomain ?? (zones.length === 1 ? zones[0] as string : null);
}

/**
 * `domain new <name> [options]`.
 *
 * @param context - The session.
 * @param args - The words after `new`.
 * @returns The envelope.
 */
export async function domainNew_run(context: BuildCommandContext, args: ReadonlyArray<string>): Promise<CommandEnvelope> {
  const read = options_read(args, NEW_OPTIONS);
  if ('error' in read) return envelope_error('', undefined, `domain new: ${read.error} (${NEW_OPTIONS.join(', ')})\n`);
  const [name, ...extra] = read.rest;
  if (name === undefined || extra.length > 0) return envelope_error('', undefined, 'domain new: usage: domain new <name> [--family E5] [--plane 3x8/24] [--workers 2x8/32] [--data GiB] [--base-domain zone] [--compartment ocid]\n');
  if (!DOMAIN_NAME.test(name)) return envelope_error('', undefined, `domain new: ${name}: a domain's name is a DNS label: lower-case letters, digits and '-', starting with a letter, at most 54\n`);
  if (context.domains.domain_read(name) !== null) return envelope_error('', undefined, `domain new: ${name}: File exists\n`);
  const region: string | null = context.region();
  if (region === null) return envelope_error('', undefined, 'domain new: not connected\n');
  // The zone is found where it lives (D14): named, it must be one the tenancy holds; unnamed, the tenancy's only one.
  const zones: string[] = await dnsZones_read(context, region);
  const named: string | undefined = read.options.get('--base-domain');
  if (named !== undefined && zones.length > 0 && !zones.includes(named)) return envelope_error('', undefined, `domain new: --base-domain ${named}: no such zone in the tenancy (${zones.join(', ')})\n`);
  const baseDomain: string | null = named ?? baseDomain_default(context, zones);
  if (baseDomain === null) {
    const why: string = zones.length === 0 ? 'the tenancy holds no DNS zone to find' : `the tenancy holds ${zones.length}: ${zones.join(', ')}`;
    return envelope_error('', undefined, `domain new: --base-domain <zone> is needed: the DNS zone the cluster's names live under (${why})\n`);
  }
  const sized = specOptions_apply(SPEC_DEFAULT, new Map([...read.options].filter(([option]: [string, string]): boolean => option !== '--base-domain' && option !== '--compartment')));
  const compartmentId: string | undefined = read.options.get('--compartment');
  if ('error' in sized) return envelope_error('', undefined, `domain new: ${sized.error}\n`);
  const record: DomainRecord = { name, created: new Date().toISOString(), region, baseDomain, steps: {}, ids: {}, protected: true, ...(compartmentId !== undefined ? { compartmentId } : {}) };
  context.store.create(record, sized.spec);
  const lines: string[] = [
    `${chalk.bold(name)}  ${name}.${baseDomain}  spec written: ${context.store.folder_of(name)}/spec.yaml`,
    `  ${spec_line(sized.spec)}`,
    chalk.gray(`Nothing is made in the tenancy until domain build ${name}; domain plan ${name} says what it takes and costs.`),
  ];
  return envelope_ok(`${lines.join('\n')}\n`);
}

/**
 * A built domain and its spec, or why the verb refuses it.
 *
 * @param context - The session.
 * @param verb - The verb, for the refusal.
 * @param name - The domain's name, or undefined for the only one.
 * @returns The domain, its record and its spec, or the refusal.
 */
function builtDomain_need(context: BuildCommandContext, verb: string, name: string | undefined): { domain: HarborDomain; record: DomainRecord; spec: DomainSpec } | { error: string } {
  const built: string[] = context.store.names_list();
  const chosen: string | undefined = name ?? (built.length === 1 ? built[0] : undefined);
  if (chosen === undefined) return { error: `domain ${verb}: which domain? (${built.join(', ') || 'none built here; domain new <name>'})` };
  const domain: HarborDomain | null = context.domains.domain_read(chosen);
  if (domain === null) return { error: `domain ${verb}: ${chosen}: no such domain` };
  if (domain.origin !== 'built') return { error: `domain ${verb}: ${chosen}: read from a harbor-oci checkout, not built here; adopting it comes with domain adopt` };
  const record: DomainRecord | null = context.store.record_read(chosen);
  const spec = context.store.spec_read(chosen);
  if (record === null || spec === null || spec.spec === null) return { error: `domain ${verb}: ${chosen}: its spec.yaml does not read${spec?.error !== undefined ? ` (${spec.error})` : ''}` };
  return { domain, record, spec: spec.spec };
}

/**
 * What a spec costs in this region, read now.
 *
 * @param context - The session.
 * @param region - The region.
 * @param spec - The spec.
 * @returns The cost, or null when the family is not priced.
 */
async function cost_read(context: BuildCommandContext, region: string, spec: DomainSpec): Promise<SpecCost | null> {
  const shape: CloudShape | undefined = familyShape_find(await context.driver.shapes_list(region), spec.family);
  const prices: CloudPrice[] = await context.driver.prices_list();
  return specCost_of(spec, shape, prices);
}

/**
 * Whether the session may start jobs: the `tasks` tier.
 *
 * @returns True when granted.
 */
function tasks_granted(): boolean {
  return surface_get().capabilities.tasks === true;
}

/**
 * `domain plan [<name>]`: the fit, the cost and the steps, read; the plan itself with the tier.
 *
 * @param context - The session.
 * @param args - The words after `plan`.
 * @returns The envelope.
 */
export async function domainPlan_run(context: BuildCommandContext, args: ReadonlyArray<string>): Promise<CommandEnvelope> {
  if (args.length > 1 || args.some((word: string): boolean => word.startsWith('-'))) return envelope_error('', undefined, 'domain plan: usage: domain plan [<name>]\n');
  const need = builtDomain_need(context, 'plan', args[0]);
  if ('error' in need) return envelope_error('', undefined, `${need.error}\n`);
  const { domain, record, spec } = need;
  const fits: ZoneFit[] = await specFit_read(context.driver, record.region, domain.name, spec);
  const cost: SpecCost | null = await cost_read(context, record.region, spec);
  const lines: string[] = [`${chalk.bold(domain.name)}  ${domain.cluster ?? ''}`, `  ${spec_line(spec)}`, `fit, ${spec.family} per availability domain (${record.region}):`];
  for (const fit of fits) {
    const room = (needed: number, free: number | null, unit: string): string => `${needed} of ${free ?? '?'} ${unit}`;
    const verdict: string = fit.fits === null ? chalk.gray('not said') : fit.fits ? chalk.cyan('fits') : chalk.red('does not fit');
    lines.push(`  ${fit.zone.padEnd(24)} ${fit.nodes.join(' ').padEnd(28)} ${room(fit.coresNeeded, fit.coresFree, 'cores')}, ${room(fit.memoryNeeded, fit.memoryFree, 'GiB')}  ${verdict}`);
  }
  lines.push(`cost  ${cost === null ? chalk.gray(`${spec.family} is not in the price list`) : chalk.yellow(cost_words(cost))}`);
  const next: string | null = stepNext_of(record);
  lines.push(`steps ${next === null ? 'every step done' : `next: ${next}`}`);
  if (record.ids['stackRef'] !== undefined && tasks_granted() && context.builder !== null) {
    const ran = await job_runFollowed(`${domain.name}-plan`, `plan ${domain.name}`, planRun_make(domain.name, context.builder, context.store));
    if ('error' in ran) return envelope_error('', undefined, `domain plan: ${ran.error}\n`);
  } else if (record.adopted !== undefined && record.ids['stackRef'] === undefined) {
    lines.push(chalk.gray(`plan  ${domain.name} is not in Resource Manager yet: domain adopt ${domain.name} --from ${record.adopted.from} with the tasks tier puts it there`));
  }
  const planText: string | null = context.store.file_read(domain.name, 'plan.json');
  if (planText !== null) {
    const counts = planCounts_of(JSON.parse(planText) as InfraPlan);
    lines.push(`plan  ${planCounts_words(counts)}${planCounts_alter(counts) ? chalk.red(' · an apply would touch what exists: refused unless allowed by name') : ''}`);
    if (record.adopted !== undefined) lines.push(chalk.gray(`      adopted from ${record.adopted.from}: planned against, never built on`));
  } else if (!tasks_granted() && record.adopted === undefined) {
    lines.push(chalk.gray('plan  the infrastructure plan needs the tasks tier (stratus --host-control tasks): without it, nothing outside this host changes'));
  } else {
    lines.push(chalk.gray(`plan  not made yet: domain build ${domain.name} --through infra-plan makes it, and nothing it makes bills`));
  }
  return envelope_ok(`${lines.join('\n')}\n`);
}

/**
 * Follows a run to its end, or until the operator stops following.
 *
 * @param runner - The runner.
 * @param id - The run's job id.
 * @param shown - Called after each line, to show the domain again.
 * @returns Its record then.
 */
async function run_follow(runner: JobRunner, id: string, shown?: () => void): Promise<JobRecord | undefined> {
  commandCancellation_enable();
  const signal: AbortSignal | undefined = commandCancellation_signalGet();
  return runner.job_followAside(STEPS_SOURCE, id, (line: string): void => { sink_dataLine(line); shown?.(); }, signal);
}

/**
 * Starts a job and follows it to its end.
 *
 * @param id - Its id in the build steps' source.
 * @param label - What it is called.
 * @param run - Its work.
 * @returns Its record at the end, or why it did not start or end.
 */
export async function job_runFollowed(id: string, label: string, run: Parameters<JobRunner['job_start']>[3]): Promise<{ record: JobRecord } | { error: string }> {
  const runner: JobRunner | null = runner_get();
  if (runner === null) return { error: 'this session runs no tasks' };
  try {
    runner.job_start(STEPS_SOURCE, id, label, run);
  } catch (error: unknown) {
    return { error: error instanceof JobRefusal ? error.message : String(error) };
  }
  sink_dataLine(chalk.gray(`following /proc/${STEPS_SOURCE}/${id}; Ctrl-C stops following, not the task (wait ${id} follows it again)`));
  const ended: JobRecord | undefined = await run_follow(runner, id);
  if (ended === undefined) return { error: `/proc/${STEPS_SOURCE}/${id}: gone` };
  if (!taskState_isOver(ended.state)) return { error: `stopped following; /proc/${STEPS_SOURCE}/${id} goes on` };
  if (ended.state !== 'done') return { error: `${id}: ${ended.state}${ended.outcome !== undefined ? `: ${ended.outcome}` : ''}` };
  return { record: ended };
}

/**
 * The question before the first billing step.
 *
 * @param context - The session.
 * @param name - The domain.
 * @param record - Its state.
 * @param spec - Its spec.
 * @returns The question.
 */
async function billing_question(context: BuildCommandContext, name: string, record: DomainRecord, spec: DomainSpec): Promise<string> {
  const planText: string | null = context.store.file_read(name, 'plan.json');
  const created: number = planText === null ? 0 : planCounts_of(JSON.parse(planText) as InfraPlan).create;
  const cost: SpecCost | null = await cost_read(context, record.region, spec);
  return `${FIRST_BILLING_STEP} creates ${created} resources. Billing starts at ${cost === null ? 'an unpriced rate' : cost_words(cost)}. Continue? [y/N]`;
}

/**
 * `domain build [<name>] [--through <step>]`.
 *
 * @param context - The session.
 * @param args - The words after `build`.
 * @returns The envelope.
 */
export async function domainBuild_run(context: BuildCommandContext, args: ReadonlyArray<string>): Promise<CommandEnvelope> {
  const read = options_read(args, ['--through']);
  if ('error' in read) return envelope_error('', undefined, `domain build: ${read.error} (--through)\n`);
  if (read.rest.length > 1) return envelope_error('', undefined, 'domain build: usage: domain build [<name>] [--through <step>]\n');
  const through: string | undefined = read.options.get('--through');
  if (through !== undefined && !BUILD_STEPS.includes(through)) return envelope_error('', undefined, `domain build: --through ${through}: no such step (${BUILD_STEPS.join(' ')})\n`);
  const need = builtDomain_need(context, 'build', read.rest[0]);
  if ('error' in need) return envelope_error('', undefined, `${need.error}\n`);
  if (need.record.adopted !== undefined) return envelope_error('', undefined, `domain build: ${need.domain.name}: adopted from ${need.record.adopted.from}: building on it is refused until it is allowed by name\n`);
  if (context.deps === null) return envelope_error('', undefined, 'domain build: this cloud\'s build steps are not written yet; stratus --fake builds over the fake cloud\n');
  const runner: JobRunner | null = runner_get();
  if (runner === null) return envelope_error('', undefined, 'domain build: this session runs no tasks\n');
  const name: string = need.domain.name;
  const asked: string | null = await account_askWhenMissing(context, need.record, through);
  if (asked !== null) return envelope_error('', undefined, `domain build: ${asked}\n`);
  const id: string = buildJob_id(name);
  for (;;) {
    const running: JobRecord | undefined = runner.job_get(STEPS_SOURCE, id);
    if (running === undefined || taskState_isOver(running.state)) {
      try {
        runner.job_start(STEPS_SOURCE, id, `build ${name}`, buildRun_make(name, through, context.deps), { domain: name, ...(through !== undefined ? { through } : {}) });
      } catch (error: unknown) {
        return envelope_error('', undefined, `domain build: ${error instanceof JobRefusal ? error.message : String(error)}\n`);
      }
    }
    sink_dataLine(chalk.gray(`following /proc/${STEPS_SOURCE}/${id}; Ctrl-C stops following, not the build (wait ${id} follows it again)`));
    domainState_show(context, name);
    // Shown again after each line; at the end, by the question that follows or by the next read.
    const ended: JobRecord | undefined = await run_follow(runner, id, (): void => domainState_show(context, name));
    if (ended === undefined) return envelope_error('', undefined, `domain build: /proc/${STEPS_SOURCE}/${id}: gone\n`);
    if (!taskState_isOver(ended.state)) return envelope_ok(`${chalk.gray(`stopped following; the build goes on (wait ${id})`)}\n`);
    if (ended.state !== 'done') return envelope_error('', undefined, `domain build: ${name}: ${ended.state}${ended.outcome !== undefined ? `: ${ended.outcome}` : ''}\n`);
    const stoppedBefore: string | undefined = ended.data['stoppedBefore'] as string | undefined;
    const record: DomainRecord = context.store.record_read(name) as DomainRecord;
    if (stoppedBefore === FIRST_BILLING_STEP && record.billingAccepted === undefined && (through === undefined || BUILD_STEPS.indexOf(through) >= BUILD_STEPS.indexOf(FIRST_BILLING_STEP))) {
      const question: string = await billing_question(context, name, record, need.spec);
      domainState_show(context, name, question);
      const yes: boolean = await repl_confirm(question);
      domainState_show(context, name);
      if (!yes) return envelope_ok(`${chalk.gray(`stopped before ${FIRST_BILLING_STEP}; nothing bills (domain build ${name} asks again)`)}\n`);
      context.store.record_update(name, (current: DomainRecord): void => { current.billingAccepted = new Date().toISOString(); });
      continue;
    }
    const next: string | null = stepNext_of(record);
    const summary: string = next === null
      ? `${name}: every step done`
      : !STEPS_WRITTEN.includes(next) ? `${name}: built through ${BUILD_STEPS[BUILD_STEPS.indexOf(next) - 1] ?? ''}; ${next} and after are not steps this session has yet`
        : `${name}: done through ${BUILD_STEPS[BUILD_STEPS.indexOf(next) - 1] ?? ''}; next: ${next}`;
    return envelope_ok(`${summary}\n`);
  }
}

/**
 * Asks for the installer's account when the build will need it and the host
 * has none: the id in the open, the secret hidden, kept on the host only.
 *
 * @param context - The session.
 * @param record - The domain's state.
 * @param through - The last step asked for, when one was.
 * @returns Why the build cannot go on, or null when it can.
 */
async function account_askWhenMissing(context: BuildCommandContext, record: DomainRecord, through: string | undefined): Promise<string | null> {
  const account: InstallerAccountKeeper | undefined = context.account;
  if (account === undefined || account.present()) return null;
  const next: string | null = stepNext_of(record);
  const needs: boolean = next !== null && BUILD_STEPS.indexOf(next) <= BUILD_STEPS.indexOf('cluster')
    && (through === undefined || BUILD_STEPS.indexOf(through) >= BUILD_STEPS.indexOf('cluster'));
  if (!needs) return null;
  sink_dataLine(chalk.yellow(`The build needs Red Hat's service account (console.redhat.com, Service Accounts); none is kept in ${account.path}.`));
  domainState_show(context, record.name, 'Red Hat service account client id:');
  const clientId: string = (await repl_question('Red Hat service account client id:')).trim();
  if (clientId === '') return 'no client id given; nothing kept, nothing started';
  const secret: string = (await repl_questionHidden('Its client secret:')).trim();
  if (secret === '') return 'no secret given; nothing kept, nothing started';
  account.keep(clientId, secret);
  sink_dataLine(chalk.gray(`kept in ${account.path}, mode 600, on this host only`));
  return null;
}

/**
 * `domain adopt <name> --from <checkout> [--stack-compartment <ocid>]`.
 *
 * @param context - The session.
 * @param args - The words after `adopt`.
 * @returns The envelope.
 */
export async function domainAdopt_run(context: BuildCommandContext, args: ReadonlyArray<string>): Promise<CommandEnvelope> {
  const read = options_read(args, ['--from', '--stack-compartment']);
  if ('error' in read) return envelope_error('', undefined, `domain adopt: ${read.error} (--from, --stack-compartment)\n`);
  const [name, ...extra] = read.rest;
  const from: string | undefined = read.options.get('--from');
  if (name === undefined || from === undefined || extra.length > 0) return envelope_error('', undefined, 'domain adopt: usage: domain adopt <name> --from <harbor-oci checkout> [--stack-compartment <ocid>]\n');
  if (!DOMAIN_NAME.test(name)) return envelope_error('', undefined, `domain adopt: ${name}: a domain's name is a DNS label\n`);
  const checkout: CheckoutRead | { error: string } = checkout_read(name, from, new Date());
  if ('error' in checkout) return envelope_error('', undefined, `domain adopt: ${checkout.error}\n`);
  const kept: DomainRecord | null = context.store.record_read(name);
  const lines: string[] = [];
  if (kept === null) {
    adoption_keep(context.store, checkout);
    lines.push(`${chalk.bold(name)}  ${name}.${checkout.record.baseDomain}  adopted from ${from}`);
    lines.push(`  kept here: its ids (${Object.keys(checkout.record.ids).join(', ')}), its spec, its settings, its secrets (${checkout.secrets.map((secret) => secret.name).join(', ') || 'none'}) in ${context.store.folder_of(name)}`);
  } else if (kept.adopted === undefined) {
    return envelope_error('', undefined, `domain adopt: ${name}: a domain of that name was built here\n`);
  } else if (kept.ids['stackRef'] !== undefined) {
    return envelope_ok(`${name}: already adopted; its stack is ${kept.ids['stackRef']}\n`);
  }
  if (!tasks_granted()) {
    lines.push(chalk.gray(`  its stack and Terraform state go to Resource Manager with the tasks tier: domain adopt ${name} --from ${from} again, under stratus --host-control tasks`));
    return envelope_ok(`${lines.join('\n')}\n`);
  }
  if (context.builder === null || context.builder.stack_adopt === undefined) return envelope_error('', undefined, `domain adopt: ${lines.join('\n')}\nthis cloud cannot take a stack in yet\n`);
  const compartment: string = read.options.get('--stack-compartment') ?? checkout.record.compartmentId ?? '';
  for (const line of lines) sink_dataLine(line);
  const ran = await job_runFollowed(`${name}-adopt`, `adopt ${name}`, adoptRun_make(context.store, context.builder, name, checkout.variables, checkout.stateFile, compartment, checkout.stackVersion));
  if ('error' in ran) return envelope_error('', undefined, `domain adopt: ${ran.error}\n`);
  return envelope_ok(`${name}: adopted; its stack is ${context.store.record_read(name)?.ids['stackRef'] ?? '?'} (domain plan ${name} plans against it)\n`);
}
