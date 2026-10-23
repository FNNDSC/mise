/**
 * @file `domain verify [<name>]`: the ten checks against a domain's cluster
 * (docs/stratus.adoc, D7), through its kubeconfig on the host, which never
 * leaves it. The result is kept as the domain's verify step, so `domain
 * status` and the DOMAINS tile show it.
 *
 * @module
 */
import { promises as dns } from 'node:dns';
import { readFileSync } from 'node:fs';
import chalk from 'chalk';
import { envelope_error, envelope_ok, type CommandEnvelope } from '@fnndsc/menu';
import { commandCancellation_enable, commandCancellation_signalGet, surface_get } from '@fnndsc/brasa/core';
import { kubeconfig_read, type KubeApi } from '../cluster/kube.js';
import { httpsStatus_get, kubeApi_make } from '../cluster/kubeHttp.js';
import type { HarborDomain } from '../domains/harborOci.js';
import type { DomainRecord } from '../domain/state.js';
import { VERIFY_FILE, type VerifyKept } from '../domain/readout.js';
import { familyShape_find } from '../domain/sizing.js';
import { verify_run, type VerifyCheck } from '../domain/verify.js';
import type { BuildCommandContext } from './build.js';

/** The resolver `verify` asks, as `harbor-oci` did: one outside the tenancy. */
export const PUBLIC_RESOLVER: string = '8.8.8.8';

/** What `verify` reaches the cluster and the world with; a test hands in its own. */
export interface VerifyReach {
  readonly kube_make: (kubeconfig: string) => KubeApi;
  readonly resolve: (name: string) => Promise<string[]>;
  readonly https_status: (url: string, ca: string | null) => Promise<number>;
  readonly probeTimeoutMs: number;
  readonly pollMs: number;
}

/**
 * The reach over the network: the Kubernetes API, a public resolver, HTTPS.
 *
 * @returns The reach.
 */
export function verifyReach_default(): VerifyReach {
  const resolver: dns.Resolver = new dns.Resolver();
  resolver.setServers([PUBLIC_RESOLVER]);
  return {
    kube_make: (kubeconfig: string): KubeApi => kubeApi_make(kubeconfig_read(kubeconfig)),
    resolve: (name: string): Promise<string[]> => resolver.resolve4(name),
    https_status: httpsStatus_get,
    probeTimeoutMs: 300_000,
    pollMs: 5_000,
  };
}

/**
 * A check as a line.
 *
 * @param check - The check.
 * @returns The line.
 */
function check_line(check: VerifyCheck): string {
  const mark: string = check.ok === null ? chalk.gray('·') : check.ok ? chalk.cyan('✓') : chalk.red('✗');
  return `  ${mark} ${check.name.padEnd(16)} ${check.ok === false ? chalk.red(check.detail) : check.detail}${check.how === 'writes' ? chalk.yellow('  (writes)') : ''}`;
}

/**
 * `domain verify [<name>]`.
 *
 * @param context - The session.
 * @param reach - How the checks reach the cluster.
 * @param args - The words after `verify`.
 * @returns The envelope: failed when a check failed.
 */
export async function domainVerify_run(context: BuildCommandContext, reach: VerifyReach, args: ReadonlyArray<string>): Promise<CommandEnvelope> {
  if (args.length > 1 || args.some((word: string): boolean => word.startsWith('-'))) return envelope_error('', undefined, 'domain verify: usage: domain verify [<name>]\n');
  const kept: string[] = context.store.names_list();
  const name: string | undefined = args[0] ?? (kept.length === 1 ? kept[0] : undefined);
  if (name === undefined) return envelope_error('', undefined, `domain verify: which domain? (${kept.join(', ') || 'none kept here'})\n`);
  const domain: HarborDomain | null = context.domains.domain_read(name);
  if (domain === null) return envelope_error('', undefined, `domain verify: ${name}: no such domain\n`);
  const record: DomainRecord | null = context.store.record_read(name);
  if (domain.origin !== 'built' || record === null) return envelope_error('', undefined, `domain verify: ${name}: read from a harbor-oci checkout; domain adopt ${name} --from ${domain.root} keeps it here first\n`);
  const kubeconfig = domain.secrets.find((secret): boolean => secret.name === 'kubeconfig');
  if (kubeconfig === undefined) return envelope_error('', undefined, `domain verify: ${name}: no kubeconfig yet: its cluster is not installed\n`);
  const spec = context.store.spec_read(name)?.spec ?? null;
  const shapes = context.region() === null ? [] : await context.driver.shapes_list(record.region).catch(() => []);
  commandCancellation_enable();
  const checks: VerifyCheck[] = await verify_run({
    kube: reach.kube_make(readFileSync(kubeconfig.hostPath, 'utf-8')),
    resolve: reach.resolve,
    https_status: reach.https_status,
    domain: name,
    baseDomain: record.baseDomain,
    shape: spec === null ? null : familyShape_find(shapes, spec.family)?.name ?? null,
    expectedNodes: spec === null ? 0 : spec.controlPlane.count + spec.workers.count,
    addresses: { api: record.ids['apiIp'], apiInt: record.ids['apiIntIp'], apps: record.ids['appsIp'] },
    probe: surface_get().capabilities.tasks === true,
    probeTimeoutMs: reach.probeTimeoutMs,
    pollMs: reach.pollMs,
    ...(commandCancellation_signalGet() !== undefined ? { signal: commandCancellation_signalGet() } : {}),
  });
  const ran: VerifyCheck[] = checks.filter((check: VerifyCheck): boolean => check.ok !== null);
  const passed: number = ran.filter((check: VerifyCheck): boolean => check.ok === true).length;
  const failed: number = ran.length - passed;
  const skipped: number = checks.length - ran.length;
  const summary: string = `${passed} of ${checks.length} pass${failed > 0 ? `, ${failed} fail` : ''}${skipped > 0 ? `, ${skipped} not run (needs the tasks tier)` : ''}`;
  const at: string = new Date().toISOString();
  context.store.record_update(name, (current: DomainRecord): void => {
    current.steps['verify'] = { state: failed > 0 ? 'failed' : 'done', ended: at, note: summary };
  });
  const verified: VerifyKept = { at, checks: checks.map((check: VerifyCheck) => ({ name: check.name, ok: check.ok, detail: check.detail, how: check.how })) };
  context.store.file_write(name, VERIFY_FILE, `${JSON.stringify(verified, null, 2)}\n`);
  const text: string = [`${chalk.bold(name)}  ${name}.${record.baseDomain}`, ...checks.map(check_line), `verify: ${summary}`].join('\n');
  return failed > 0 ? { ...envelope_error(`${text}\n`), renderedErr: '' } : envelope_ok(`${text}\n`);
}
