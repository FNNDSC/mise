/**
 * @file `domain teardown <name>`: removes what a domain built here, after
 * showing what goes and asking for the domain's name (docs/stratus.adoc, D6).
 *
 * @module
 */
import { readFileSync } from 'node:fs';
import chalk from 'chalk';
import { envelope_error, envelope_ok, type CommandEnvelope } from '@fnndsc/menu';
import { repl_question, sink_dataLine, surface_get } from '@fnndsc/brasa/core';
import type { HarborDomain } from '../domains/harborOci.js';
import { foundDomains_describe, foundRecord_make } from '../domain/found.js';
import { SPEC_DEFAULT } from '../domain/spec.js';
import type { DomainRecord } from '../domain/state.js';
import { clusterVolumes_read, teardownRun_make } from '../domain/teardown.js';
import { job_runFollowed, type BuildCommandContext } from './build.js';
import { verifyReach_default } from './verify.js';

/**
 * `domain teardown <name>`.
 *
 * @param context - The session.
 * @param args - The words after `teardown`.
 * @returns The envelope.
 */
export async function domainTeardown_run(context: BuildCommandContext, args: ReadonlyArray<string>): Promise<CommandEnvelope> {
  if (args.length !== 1 || (args[0] as string).startsWith('-')) return envelope_error('', undefined, 'domain teardown: usage: domain teardown <name>\n');
  const name: string = args[0] as string;
  let domain: HarborDomain | null = context.domains.domain_read(name);
  let record: DomainRecord | null = context.store.record_read(name);
  const builder = context.builder;
  if (builder === null || builder.teardown_run === undefined) return envelope_error('', undefined, 'domain teardown: this cloud cannot tear a domain down yet\n');
  if (domain === null || record === null) {
    // A domain the session keeps nothing of: found in the tenancy with nothing
    // left of it but its tag, its leftovers go without an adoption first
    // (docs/stratus.adoc, D15). Anything else of it is adopted first.
    const region: string | null = context.region();
    if (region === null) return envelope_error('', undefined, `domain teardown: ${name}: no such domain\n`);
    let found: HarborDomain | undefined;
    try {
      found = (await foundDomains_describe(context.driver, builder, region, context.store.names_list())).find((entry: HarborDomain): boolean => entry.name === name);
    } catch (error: unknown) {
      return envelope_error('', undefined, `domain teardown: ${name}: the tenancy was not searched: ${error instanceof Error ? error.message : String(error)}\n`);
    }
    if (found === undefined) return envelope_error('', undefined, `domain teardown: ${name}: no such domain\n`);
    if (found.found?.condition !== 'GONE') return envelope_error('', undefined, `domain teardown: ${name}: found in the tenancy, not adopted: domain adopt ${name} first\n`);
    if (surface_get().capabilities.tasks !== true) return envelope_error('', undefined, `domain teardown: ${name}: Operation not permitted: tearing down needs the tasks tier\n`);
    context.store.create(foundRecord_make(found, new Date().toISOString(), false), found.found.spec ?? SPEC_DEFAULT);
    domain = context.domains.domain_read(name);
    record = context.store.record_read(name);
    if (domain === null || record === null) return envelope_error('', undefined, `domain teardown: ${name}: could not be kept here\n`);
  }
  if (domain.origin !== 'built') return envelope_error('', undefined, `domain teardown: ${name}: Operation not permitted: read from a harbor-oci checkout, not built here\n`);
  if (record.gone !== undefined) return envelope_ok(`${name}: already torn down (${record.gone.slice(0, 16)})\n`);
  if (record.protected !== false) return envelope_error('', undefined, `domain teardown: ${name}: Operation not permitted: protected (domain protect ${name} off lifts it, as its own line)\n`);
  if (surface_get().capabilities.tasks !== true) return envelope_error('', undefined, `domain teardown: ${name}: Operation not permitted: tearing down needs the tasks tier\n`);
  const stackRef: string | undefined = record.ids['stackRef'];
  const inStack: number | null = stackRef !== undefined && builder.stackResources_count !== undefined ? await builder.stackResources_count({ region: record.region, stackRef }) : null;
  // A teardown that stopped part way runs again: an empty stack means an
  // earlier pass destroyed it, the cluster with it, and removed the
  // volumes it had read, so there is no destroy job and no cluster to ask.
  const stackEmpty: boolean = stackRef !== undefined && inStack === 0;
  // The cluster names its own volumes; read before the destroy takes it away.
  let volumeIds: string[] = [];
  const kubeconfig = domain.secrets.find((secret): boolean => secret.name === 'kubeconfig');
  if (kubeconfig !== undefined && !stackEmpty) {
    try {
      volumeIds = await clusterVolumes_read((context.verifyReach ?? verifyReach_default()).kube_make(readFileSync(kubeconfig.hostPath, 'utf-8')));
    } catch (error: unknown) {
      return envelope_error('', undefined, `domain teardown: ${name}: cannot read the cluster's volumes (${error instanceof Error ? error.message : String(error)}): refusing, they would be left billing\n`);
    }
  }
  const lines: string[] = [
    `${chalk.bold(name)}  ${record.baseDomain === '' ? '(no zone known)' : `${name}.${record.baseDomain}`}  teardown${record.adopted !== undefined ? chalk.gray(`  (adopted from ${record.adopted.from})`) : ''}`,
    `  ${chalk.red('−')} ${stackRef === undefined ? 'no stack: nothing was applied' : stackEmpty ? 'nothing in the stack: an earlier pass destroyed it' : `the stack's ${inStack ?? '?'} resources, by a destroy job`}`,
    ...(record.baseDomain === '' ? [] : [`  ${chalk.red('−')} the DNS records api, api-int and *.apps`]),
    ...(record.ids['isoObject'] !== undefined ? [`  ${chalk.red('−')} the image ${record.ids['isoObject']} and its link`] : []),
    `  ${chalk.red('−')} ${volumeIds.length} volume${volumeIds.length === 1 ? '' : 's'} the cluster made for its claims${kubeconfig === undefined ? ' (no cluster to ask)' : stackEmpty ? ' (the cluster is gone; an earlier pass removed the ones it named)' : ''}, and any block volume left in its compartment with the attribution tag`,
    ...(record.ids['clusterId'] !== undefined ? [`  ${chalk.red('−')} the installer's cluster and infra-env`] : []),
    ...(stackRef !== undefined ? [`  ${chalk.red('−')} the stack itself`] : []),
    `  ${chalk.red('−')} its compartment and the image bucket in it when stratus made them (domains/${name}); another's keeps itself and loses the tag`,
    chalk.gray('  Nothing else is touched: the zone, the tag namespace and what other domains made stay.'),
  ];
  for (const line of lines) sink_dataLine(line);
  const answer: string = (await repl_question(`Destroy what ${name} built? Its data goes with it; billing stops. Type the domain's name to go on:`)).trim();
  if (answer !== name) return envelope_ok(`${chalk.gray(`not torn down: '${answer}' is not ${name}`)}\n`);
  const ran = await job_runFollowed(`${name}-teardown`, `teardown ${name}`, teardownRun_make(context.store, builder, context.deps?.installer ?? null, name, volumeIds, stackEmpty));
  if ('error' in ran) return envelope_error('', undefined, `domain teardown: ${ran.error}\n`);
  return envelope_ok(`${name}: torn down\n`);
}
