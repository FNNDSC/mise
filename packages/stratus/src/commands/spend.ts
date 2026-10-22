/**
 * @file `spend [<name>…]`: what each domain costs, resource by resource, at
 * list price: an hour, and since each resource was made (docs/stratus.adoc,
 * D7; `harbor-oci`'s `burn`).
 *
 * @module
 */
import chalk from 'chalk';
import { envelope_error, envelope_ok, type CommandEnvelope } from '@fnndsc/menu';
import type { CommandHelp } from '@fnndsc/brasa/core';
import type { HarborDomain } from '../domains/harborOci.js';
import { money_words, spend_line, spend_read, type Spend, type SpendItem } from '../domain/spend.js';
import type { DomainCommandContext } from './domain.js';

/** `spend`'s help. */
export const SPEND_HELP: CommandHelp = {
  usage: 'spend [<name>…]',
  summary: 'What each Trusted Domain costs, an hour and so far',
  category: 'Resources',
  description: 'Prices every live resource in each domain\'s compartment at list price: machines by vCPU and memory while they run, volumes by size and performance, load balancers by the hour and their minimum bandwidth. Prints each with its rate an hour and what it has come to since it was made, then the domain\'s total. An estimate, not the bill: discounts, free tiers and traffic are not in it. Bare, every domain.',
  examples: ['spend', 'spend harbor'],
};

/**
 * One domain's spend as lines.
 *
 * @param name - The domain.
 * @param spend - Its spend.
 * @returns The lines.
 */
export function spend_lines(name: string, spend: Spend): string[] {
  const nameWidth: number = Math.max(4, ...spend.items.map((item: SpendItem): number => item.name.length));
  const rate = (amount: number | null, unit: string = ''): string => (amount === null ? 'not priced' : `${money_words(amount, spend.currency)}${unit}`);
  return [
    chalk.bold(name),
    ...spend.items.map((item: SpendItem): string => `  ${item.kind.padEnd(15)} ${item.name.padEnd(nameWidth)}  ${rate(item.hourly, '/h').padStart(10)}  ${rate(item.soFar, ' so far').padStart(17)}  ${chalk.gray(item.detail)}`),
    `  ${chalk.yellow(spend_line(spend))}`,
  ];
}

/**
 * Runs `spend`.
 *
 * @param context - The session.
 * @param args - The domains' names.
 * @returns The envelope.
 */
export async function spend_run(context: DomainCommandContext, args: ReadonlyArray<string>): Promise<CommandEnvelope> {
  const flag: string | undefined = args.find((word: string): boolean => word.startsWith('-'));
  if (flag !== undefined) return envelope_error('', undefined, `spend: ${flag}: unknown option\n`);
  const all: HarborDomain[] = context.domains.domains_read();
  const missing: string[] = args.filter((name: string): boolean => !all.some((domain: HarborDomain): boolean => domain.name === name));
  if (missing.length > 0) return envelope_error('', undefined, `spend: ${missing.join(', ')}: no such domain\n`);
  const chosen: HarborDomain[] = args.length === 0 ? all : all.filter((domain: HarborDomain): boolean => args.includes(domain.name));
  if (chosen.length === 0) return envelope_ok('no domains\n');
  const blocks: string[] = [];
  for (const domain of chosen) {
    const compartmentId: string | undefined = domain.settings['OCI_COMPARTMENT_OCID'];
    const region: string | null = domain.settings['OCI_REGION'] ?? context.region();
    if (compartmentId === undefined || region === null) { blocks.push(`${chalk.bold(domain.name)}\n  ${chalk.gray('not priced: no compartment known')}`); continue; }
    blocks.push(spend_lines(domain.name, await spend_read(context.driver, compartmentId, region, new Date())).join('\n'));
  }
  return envelope_ok(`${blocks.join('\n\n')}\n${chalk.gray('List prices: an estimate, not the bill.')}\n`);
}
