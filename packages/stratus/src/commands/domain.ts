/**
 * @file `domain`: where each Trusted Domain's build stands (docs/stratus.adoc, D7).
 *
 * `domain status [<name>]` prints, per domain, its cluster, its checkout,
 * each step with its state and the evidence for it, and how many live
 * resources its compartment holds in the session's region. A bare `domain`
 * is `domain status` for every domain. The verbs that check or build
 * (`verify`, `plan`, `build`) are the driver's steps (D3, D10), not yet
 * written; each is refused by name.
 *
 * @module
 */
import chalk from 'chalk';
import { envelope_error, envelope_ok, STRATUS_DOMAINS_MODEL_KIND, type CommandEnvelope, type DomainSummary, type DomainsModel } from '@fnndsc/menu';
import type { CommandGroup, CommandHelp } from '@fnndsc/brasa/core';
import type { CloudDriver, ResourceCounts } from '../cloud/driver.js';
import type { HarborDomain, StepState } from '../domains/harborOci.js';
import type { DomainTree } from '../vfs/domains.js';
import { stateTone_paint } from '../vfs/look.js';
import { lastDone_of } from '../domains/harborOci.js';
import { capacity_run, CAPACITY_HELP } from './capacity.js';

/** What `domain` reads from the session. */
export interface DomainCommandContext {
  readonly domains: DomainTree;
  readonly driver: CloudDriver;
  /** The session's region, or null when not connected. */
  readonly region: () => string | null;
  /** The folder the domains stand in (`/net/oci/<tenancy>/domains`). */
  readonly domainsPath: () => string;
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
 * One domain's status: its lines, and its summary for the model.
 *
 * @param context - The session.
 * @param domain - The domain.
 * @returns The lines and the summary.
 */
export async function domainStatus_read(context: DomainCommandContext, domain: HarborDomain): Promise<{ lines: string[]; summary: DomainSummary }> {
  const width: number = Math.max(...domain.steps.map((step: StepState): number => step.folder.length));
  const compartment = await compartment_count(context, domain.settings['OCI_COMPARTMENT_OCID']);
  const lines: string[] = [
    `${chalk.bold(domain.name)}  ${domain.cluster ?? '(no cluster name in its settings)'}`,
    `checkout     ${domain.root}`,
    ...domain.steps.map((step: StepState): string => `  ${step.folder.padEnd(width)}  ${stateTone_paint(step.state, step.state.padEnd(8))}  ${chalk.gray(step.evidence)}`),
    compartment.line,
  ];
  const summary: DomainSummary = {
    name: domain.name,
    path: `${context.domainsPath()}/${domain.name}`,
    cluster: domain.cluster,
    lastDone: lastDone_of(domain)?.folder ?? null,
    steps: domain.steps.map((step: StepState): { folder: string; state: string } => ({ folder: step.folder, state: step.state })),
    resources: compartment.counts === null ? null : { ...compartment.counts },
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
  if (verb !== 'status') return envelope_error('', undefined, `domain: ${verb}: not a verb this session has yet (domain status)\n`);
  const all: HarborDomain[] = context.domains.domains_read();
  if (all.length === 0) return envelope_ok('no domains: start stratus with --domain <name>=<harbor-oci checkout>\n', { kind: STRATUS_DOMAINS_MODEL_KIND, data: { domains: [] } });
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
  return envelope_ok(`${blocks.join('\n\n')}\n`, { kind: STRATUS_DOMAINS_MODEL_KIND, data: model });
}

/** `domain`'s help. */
export const DOMAIN_HELP: CommandHelp = {
  usage: 'domain [status [<name>…]]',
  summary: 'Where each Trusted Domain\'s build stands',
  category: 'Resources',
  description: 'Prints each domain the daemon was given (stratus --domain <name>=<harbor-oci checkout>): its cluster, its checkout, each build step with its state and the evidence for it (unknown where the host keeps none), and its compartment\'s live resources in the session\'s region. A bare domain is domain status for every domain. The domain\'s files are under ~ (domains/<name>/); its credentials stay on the host.',
  examples: ['domain', 'domain status harbor', 'cat ~/harbor/steps/05-infra-apply/evidence'],
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
    },
    help: { domain: DOMAIN_HELP, capacity: CAPACITY_HELP },
  };
}
