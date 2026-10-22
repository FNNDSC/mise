/**
 * @file `domain protect <name> on|off`: whether a domain may be torn down.
 *
 * A domain is born protected (docs/stratus.adoc, D14). Lifting it is a line
 * of its own, so tearing a tenant down takes two deliberate acts: this, and
 * teardown's name typed back. It changes only the domain's state on this
 * host, never the cloud, so it needs no tier. Bare, it says how the domain
 * stands.
 *
 * @module
 */
import chalk from 'chalk';
import { envelope_error, envelope_ok, type CommandEnvelope } from '@fnndsc/menu';
import type { DomainRecord } from '../domain/state.js';
import type { BuildCommandContext } from './build.js';

/**
 * `domain protect <name> [on|off]`.
 *
 * @param context - The session.
 * @param args - The words after `protect`.
 * @returns The envelope.
 */
export async function domainProtect_run(context: BuildCommandContext, args: ReadonlyArray<string>): Promise<CommandEnvelope> {
  const [name, setting, ...extra] = args;
  if (name === undefined || extra.length > 0 || (setting !== undefined && setting !== 'on' && setting !== 'off')) {
    return envelope_error('', undefined, 'domain protect: usage: domain protect <name> [on|off]\n');
  }
  const record: DomainRecord | null = context.store.record_read(name);
  if (record === null) return envelope_error('', undefined, `domain protect: ${name}: no such domain kept here\n`);
  if (setting === undefined) {
    return envelope_ok(`${name}: ${record.protected !== false ? 'protected (teardown refused)' : 'not protected (teardown asks for its name)'}\n`);
  }
  context.store.record_update(name, (current: DomainRecord): void => { current.protected = setting === 'on'; });
  return envelope_ok(setting === 'on'
    ? `${name}: protected; teardown is refused\n`
    : `${chalk.yellow(name)}: no longer protected; domain teardown ${name} will ask for its name\n`);
}
