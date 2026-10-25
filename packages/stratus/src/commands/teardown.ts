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
  const domain: HarborDomain | null = context.domains.domain_read(name);
  const record: DomainRecord | null = context.store.record_read(name);
  if (domain === null) return envelope_error('', undefined, `domain teardown: ${name}: no such domain\n`);
  if (domain.origin !== 'built' || record === null) return envelope_error('', undefined, `domain teardown: ${name}: Operation not permitted: read from a harbor-oci checkout, not built here\n`);
  if (record.adopted !== undefined) return envelope_error('', undefined, `domain teardown: ${name}: Operation not permitted: adopted, not built here\n`);
  if (record.gone !== undefined) return envelope_ok(`${name}: already torn down (${record.gone.slice(0, 16)})\n`);
  if (record.protected !== false) return envelope_error('', undefined, `domain teardown: ${name}: Operation not permitted: protected (domain protect ${name} off lifts it, as its own line)\n`);
  const builder = context.builder;
  if (builder === null || builder.teardown_run === undefined) return envelope_error('', undefined, 'domain teardown: this cloud cannot tear a domain down yet\n');
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
    `${chalk.bold(name)}  ${name}.${record.baseDomain}  teardown`,
    `  ${chalk.red('−')} ${stackRef === undefined ? 'no stack: nothing was applied' : stackEmpty ? 'nothing in the stack: an earlier pass destroyed it' : `the stack's ${inStack ?? '?'} resources, by a destroy job`}`,
    `  ${chalk.red('−')} the DNS records api, api-int and *.apps`,
    ...(record.ids['isoObject'] !== undefined ? [`  ${chalk.red('−')} the image ${record.ids['isoObject']} and its link`] : []),
    `  ${chalk.red('−')} ${volumeIds.length} volume${volumeIds.length === 1 ? '' : 's'} the cluster made for its claims${kubeconfig === undefined ? ' (no cluster to ask)' : stackEmpty ? ' (the cluster is gone; an earlier pass removed the ones it named)' : ''}`,
    ...(record.ids['clusterId'] !== undefined ? [`  ${chalk.red('−')} the installer's cluster and infra-env`] : []),
    chalk.gray('  Nothing else in the compartment is touched.'),
  ];
  for (const line of lines) sink_dataLine(line);
  const answer: string = (await repl_question(`Destroy what ${name} built? Its data goes with it; billing stops. Type the domain's name to go on:`)).trim();
  if (answer !== name) return envelope_ok(`${chalk.gray(`not torn down: '${answer}' is not ${name}`)}\n`);
  const ran = await job_runFollowed(`${name}-teardown`, `teardown ${name}`, teardownRun_make(context.store, builder, context.deps?.installer ?? null, name, volumeIds, stackEmpty));
  if ('error' in ran) return envelope_error('', undefined, `domain teardown: ${ran.error}\n`);
  return envelope_ok(`${name}: torn down\n`);
}
