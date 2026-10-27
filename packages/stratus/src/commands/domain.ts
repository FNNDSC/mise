/**
 * @file `domain`: where each Trusted Domain's build stands (docs/stratus.adoc, D7).
 *
 * `domain status [<name>]` prints, per domain, its cluster, its checkout,
 * each step with its state and the evidence for it, and how many live
 * resources its compartment holds in the session's region. A bare `domain`
 * is `domain status` for every domain. `new`, `plan`, `build` and `adopt`
 * are in `build.ts`, `verify` in `verify.ts`; any other verb is refused by name.
 *
 * @module
 */
import chalk from 'chalk';
import { envelope_error, envelope_ok, STRATUS_DOMAINS_MODEL_KIND, type CommandEnvelope, type DomainSummary, type DomainsModel } from '@fnndsc/menu';
import type { CommandGroup, CommandHelp } from '@fnndsc/brasa/core';
import type { CloudDriver, FoundDomain, ResourceCounts } from '../cloud/driver.js';
import { DOMAIN_TAG } from '../domain/state.js';
import type { HarborDomain, StepState } from '../domains/harborOci.js';
import type { DomainTree } from '../vfs/domains.js';
import { stateTone_paint } from '../vfs/look.js';
import { lastDone_find } from '../domains/harborOci.js';
import { capacity_run, CAPACITY_HELP } from './capacity.js';
import { spend_line, spend_read, type Spend } from '../domain/spend.js';
import { spend_run, SPEND_HELP } from './spend.js';
import { domainAdopt_run, domainBuild_run, domainNew_run, domainPlan_run, type BuildCommandContext } from './build.js';
import { domainVerify_run, verifyReach_default } from './verify.js';
import { domainTeardown_run } from './teardown.js';
import { domainProtect_run } from './protect.js';
import { domainSize_run } from './size.js';
import { domainSummary_read } from '../domain/readout.js';
import type { AnswerCache } from '../cache.js';

/** What `domain` reads from the session. */
export interface DomainCommandContext {
  readonly domains: DomainTree;
  readonly driver: CloudDriver;
  /** The session's region, or null when not connected. */
  readonly region: () => string | null;
  /** The folder the domains stand in (`/net/oci/<tenancy>/domains`). */
  readonly domainsPath: () => string;
  /** What the build verbs run over; absent, `new`, `plan` and `build` refuse. */
  readonly build?: BuildCommandContext;
  /** Where `capacity` keeps the limits it read; absent, every ask reads the cloud. */
  readonly cache?: AnswerCache;
}

/** The order the counted kinds are said in. */
const COUNT_ORDER: ReadonlyArray<keyof ResourceCounts> = ['instances', 'networks', 'subnets', 'securitygroups', 'loadbalancers', 'volumes', 'buckets', 'dns'];

/**
 * A compartment's live resources, and the line that says them or why they
 * could not be counted.
 *
 * @param context - The session.
 * @param compartmentId - The compartment, from the domain's settings.
 * @returns The counts (null when not counted) and the line.
 */
async function compartment_count(context: DomainCommandContext, compartmentId: string | undefined): Promise<{ counts: ResourceCounts | null; line: string }> {
  const region: string | null = context.region();
  if (compartmentId === undefined) return { counts: null, line: 'compartment  not in the domain\'s settings' };
  if (region === null) return { counts: null, line: 'compartment  not counted: not connected' };
  try {
    const counts: ResourceCounts = await context.driver.resources_search(compartmentId, region);
    const said: string[] = COUNT_ORDER.filter((kind): boolean => (counts[kind] ?? 0) > 0).map((kind): string => `${counts[kind]} ${kind}`);
    return { counts, line: `compartment  ${said.length > 0 ? said.join(', ') : 'nothing live'} (${region})` };
  } catch (error: unknown) {
    return { counts: null, line: `compartment  not counted: ${error instanceof Error ? error.message : String(error)}` };
  }
}

/**
 * What a domain costs, and the line that says it or why it is not priced.
 *
 * @param context - The session.
 * @param domain - The domain.
 * @returns The spend (null when not priced) and the line.
 */
async function domainCost_read(context: DomainCommandContext, domain: HarborDomain): Promise<{ spend: Spend | null; line: string }> {
  const compartmentId: string | undefined = domain.settings['OCI_COMPARTMENT_OCID'];
  const region: string | null = domain.settings['OCI_REGION'] ?? context.region();
  if (compartmentId === undefined || region === null) return { spend: null, line: 'cost         not priced: no compartment known' };
  try {
    const spend: Spend = await spend_read(context.driver, compartmentId, region, new Date());
    return { spend, line: `cost         ${spend_line(spend)}` };
  } catch (error: unknown) {
    return { spend: null, line: `cost         not priced: ${error instanceof Error ? error.message : String(error)}` };
  }
}


/**
 * A domain found in the tenancy by its tag and not kept here, as the verbs
 * read one: no spec, no steps, no secrets; its compartment the tagged one,
 * else the stack's.
 *
 * @param found - What the search found.
 * @returns The domain.
 */
export function foundDomain_make(found: FoundDomain): HarborDomain {
  const compartmentId: string | null = found.compartmentId ?? found.stack?.compartmentId ?? null;
  return {
    name: found.name,
    root: found.stack?.id ?? compartmentId ?? '',
    spec: null,
    settings: { CLUSTER_NAME: found.name, OCI_REGION: found.region, ...(compartmentId !== null ? { OCI_COMPARTMENT_OCID: compartmentId } : {}) },
    state: null,
    steps: [],
    secrets: [],
    cluster: null,
    origin: 'found',
    found: { stack: found.stack, compartmentId: found.compartmentId },
  };
}

/**
 * The domains the tenancy holds that this session keeps nothing of: found by
 * the tag on their stacks and compartments (docs/stratus.adoc, D15). The
 * tenancy is the truth about its domains; the folder is what this host
 * knows of each.
 *
 * @param context - The session.
 * @param kept - The domains read from checkouts and the folder.
 * @returns The found domains, and why the tenancy was not searched when it was not.
 */
async function foundDomains_read(context: DomainCommandContext, kept: ReadonlyArray<HarborDomain>): Promise<{ domains: HarborDomain[]; unsearched: string | null }> {
  const region: string | null = context.region();
  if (region === null) return { domains: [], unsearched: 'not connected' };
  try {
    const found: FoundDomain[] = await context.driver.domains_find(DOMAIN_TAG, region);
    return { domains: found.filter((entry: FoundDomain): boolean => !kept.some((domain: HarborDomain): boolean => domain.name === entry.name)).map(foundDomain_make), unsearched: null };
  } catch (error: unknown) {
    return { domains: [], unsearched: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * One domain's status: its lines, and its summary for the model.
 *
 * @param context - The session.
 * @param domain - The domain.
 * @returns The lines and the summary.
 */
export async function domainStatus_read(context: DomainCommandContext, domain: HarborDomain): Promise<{ lines: string[]; summary: DomainSummary }> {
  const width: number = Math.max(0, ...domain.steps.map((step: StepState): number => step.folder.length));
  const [compartment, cost] = await Promise.all([compartment_count(context, domain.settings['OCI_COMPARTMENT_OCID']), domainCost_read(context, domain)]);
  const lines: string[] = [
    `${chalk.bold(domain.name)}  ${domain.cluster ?? '(no cluster name in its settings)'}`,
    domain.origin === 'found'
      ? `found        ${domain.found?.stack !== null && domain.found?.stack !== undefined ? `stack ${domain.found.stack.id} (${domain.found.stack.state})` : 'no stack'}${domain.found?.compartmentId !== null && domain.found?.compartmentId !== undefined ? `, compartment ${domain.found.compartmentId}` : ''}; not adopted: domain adopt ${domain.name} keeps it here`
      : `${domain.origin !== 'built' ? 'checkout   ' : (domain.state as { adopted?: unknown } | null)?.adopted !== undefined ? 'adopted    ' : (domain.state as { gone?: unknown } | null)?.gone !== undefined ? 'torn down  ' : 'built here '}  ${domain.root}`,
    ...domain.steps.map((step: StepState): string => `  ${step.folder.padEnd(width)}  ${stateTone_paint(step.state, step.state.padEnd(8))}  ${chalk.gray(step.evidence)}`),
    compartment.line,
    cost.line,
  ];
  // A found domain keeps no steps here: what lives in its compartment says whether it is up.
  const live: boolean = (compartment.counts?.instances ?? 0) > 0;
  const summary: DomainSummary = {
    ...domainSummary_read(context.build?.store ?? null, context.domainsPath(), domain),
    resources: compartment.counts === null ? null : { ...compartment.counts },
    cost: cost.spend === null ? null : { hourly: cost.spend.hourly, soFar: cost.spend.soFar, currency: cost.spend.currency },
    ...(domain.origin === 'found' ? { condition: live ? 'UP' as const : 'STOPPED' as const, billing: live } : {}),
  };
  return { lines, summary };
}

/**
 * Runs `domain`.
 *
 * @param context - The session.
 * @param args - The words after `domain`.
 * @returns The envelope.
 */
export async function domain_run(context: DomainCommandContext, args: ReadonlyArray<string>): Promise<CommandEnvelope> {
  const [verb = 'status', ...rest] = args;
  const builds: Readonly<Record<string, (context: BuildCommandContext, args: ReadonlyArray<string>) => Promise<CommandEnvelope>>> = { new: domainNew_run, plan: domainPlan_run, build: domainBuild_run, adopt: domainAdopt_run, teardown: domainTeardown_run, protect: domainProtect_run, size: domainSize_run, verify: (build: BuildCommandContext, words: ReadonlyArray<string>) => domainVerify_run(build, build.verifyReach ?? verifyReach_default(), words) };
  const build = builds[verb];
  const kept: HarborDomain[] = context.domains.domains_read();
  if (build !== undefined) {
    if (context.build === undefined) return envelope_error('', undefined, `domain: ${verb}: this session builds no domains\n`);
    // A domain found in the tenancy and not adopted answers reads and `adopt` only.
    const named: string | undefined = rest.find((word: string): boolean => !word.startsWith('--'));
    if (verb !== 'adopt' && named !== undefined && !kept.some((domain: HarborDomain): boolean => domain.name === named)) {
      const found = await foundDomains_read(context, kept);
      if (found.domains.some((domain: HarborDomain): boolean => domain.name === named)) return envelope_error('', undefined, `domain ${verb}: ${named}: found in the tenancy, not adopted: domain adopt ${named} first\n`);
    }
    return build(context.build, rest);
  }
  const found = await foundDomains_read(context, kept);
  const all: HarborDomain[] = [...kept, ...found.domains];
  // `domain <name>` is that domain's status: the line the TD controller opens on, and the same line as text in chell.
  if (verb !== 'status' && rest.length === 0 && all.some((domain: HarborDomain): boolean => domain.name === verb)) return domain_run(context, ['status', verb]);
  if (verb !== 'status') return envelope_error('', undefined, `domain: ${verb}: not a verb this session has yet (domain status, new, size, plan, build, adopt, verify, protect, teardown)\n`);
  if (all.length === 0) return envelope_ok(`no domains${found.unsearched === null ? ' here or in the tenancy' : ` here (the tenancy was not searched: ${found.unsearched})`}: domain new <name> makes one; stratus --domain <name>=<harbor-oci checkout> reads one\n`, { kind: STRATUS_DOMAINS_MODEL_KIND, data: { domains: [] } });
  const chosen: HarborDomain[] = rest.length === 0 ? all : all.filter((domain: HarborDomain): boolean => rest.includes(domain.name));
  const missing: string[] = rest.filter((name: string): boolean => !all.some((domain: HarborDomain): boolean => domain.name === name));
  if (missing.length > 0) return envelope_error('', undefined, `domain: ${missing.join(', ')}: no such domain (${all.map((domain: HarborDomain): string => domain.name).join(', ')})\n`);
  const blocks: string[] = [];
  const model: DomainsModel = { domains: [] };
  for (const domain of chosen) {
    const read = await domainStatus_read(context, domain);
    blocks.push(read.lines.join('\n'));
    model.domains.push(read.summary);
  }
  if (found.unsearched !== null && rest.length === 0) blocks.push(chalk.gray(`the tenancy was not searched for domains: ${found.unsearched}`));
  return envelope_ok(`${blocks.join('\n\n')}\n`, { kind: STRATUS_DOMAINS_MODEL_KIND, data: model });
}

/** `domain`'s help. */
export const DOMAIN_HELP: CommandHelp = {
  usage: 'domain [status [<name>…]] | domain <name> | domain new <name> [options] | domain size [--family <family>] | domain plan [<name>] | domain build [<name>] [--through <step>] | domain adopt <name> --from <checkout> | domain verify [<name>] | domain protect <name> [on|off] | domain teardown <name>',
  summary: 'Make, plan, build, and see where each Trusted Domain stands',
  category: 'Resources',
  description: 'domain status prints each domain: those this daemon builds, and those read from a harbor-oci checkout (stratus --domain <name>=<checkout>), with its cluster, each build step with its state and the evidence for it, and its compartment\'s live resources in the session\'s region. A bare domain is domain status for every domain, and domain <name> is that one\'s. domain new writes a domain\'s spec and nothing else (--family E5, --plane 3x8/24, --workers 2x8/32 as count x vCPU / GiB, --data, --database, --queue in GiB, --base-domain zone). domain size reads what a new domain is sized against in the region: each availability domain\'s free cores and memory for the family, its price, and the spec a new domain starts from. domain plan reads only: whether the spec fits each availability domain, what it costs an hour, where the steps stand; the infrastructure plan needs the tasks tier. domain build runs the steps from the first not done as a task (/proc/steps/<name>-build) and follows it; before the first step that bills it asks, with the plan\'s counts and the cost. Ctrl-C stops following, not the build: wait <name>-build follows it again, kill <name>-build asks it to stop. domain adopt keeps a domain harbor-oci built and, with the tasks tier, takes its stack and state into the cloud\'s Resource Manager; an adopted domain is planned against, never built on. A domain is born protected: domain teardown refuses it until domain protect <name> off, a line of its own, and then still asks for its name typed back. domain verify runs ten checks against the cluster through its kubeconfig, which stays on the host: nine read, and the block-volume probe, which makes a claim and a pod, runs only with the tasks tier. The domain\'s files are under ~ (domains/<name>/); its credentials stay on the host.',
  examples: ['domain', 'domain size', 'domain new trial --workers 2x8/32 --data 100', 'domain plan trial', 'domain build trial --through infra-plan', 'domain build trial', 'domain adopt harbor --from ~/src/harbor-oci', 'domain verify harbor', 'domain protect quay off', 'cat ~/harbor/steps/05-infra-apply/evidence'],
};

/**
 * The stratus backend's commands: `domain` and `capacity`.
 *
 * @param context - The session.
 * @returns The group to register as the backend's.
 */
export function stratusCommands_make(context: DomainCommandContext): CommandGroup {
  return {
    envelope: {
      domain: (args: string[]): Promise<CommandEnvelope> => domain_run(context, args),
      capacity: (args: string[]): Promise<CommandEnvelope> => capacity_run(context, args),
      spend: (args: string[]): Promise<CommandEnvelope> => spend_run(context, args),
    },
    help: { domain: DOMAIN_HELP, capacity: CAPACITY_HELP, spend: SPEND_HELP },
    // `capacity` and `spend` read the cloud and change nothing of the session,
    // so they run beside any other line; `domain` writes a domain's folder
    // and so, unnamed here, holds the whole session.
    holds: { capacity: [], spend: [] },
  };
}
