/**
 * @file `capacity`: how much of each limit a shape family draws on is free,
 * per zone, in the session's region (docs/stratus.adoc, D7).
 *
 * The families are the ones named, else the ones the daemon's domains'
 * specs name (`family:`). For each, the region's shapes of that family say
 * which limits they draw on; each limit is read at every zone it is kept in,
 * with what is used and left when the cloud says. The answer carries the
 * `stratus.capacity` model the CAPACITY tile draws.
 *
 * @module
 */
import chalk from 'chalk';
import { envelope_error, envelope_ok, STRATUS_CAPACITY_MODEL_KIND, type CapacityModel, type CapacityRow, type CommandEnvelope } from '@fnndsc/menu';
import type { CommandHelp } from '@fnndsc/brasa/core';
import type { CloudAvailability, CloudDriver, CloudLimit, CloudShape } from '../cloud/driver.js';
import type { HarborDomain } from '../domains/harborOci.js';
import type { DomainTree } from '../vfs/domains.js';

/** What `capacity` reads from the session. */
export interface CapacityCommandContext {
  readonly domains: DomainTree;
  readonly driver: CloudDriver;
  /** The session's region, or null when not connected. */
  readonly region: () => string | null;
}

/**
 * The shape family a spec names (`family: E5`), or null.
 *
 * @param spec - The spec's text.
 * @returns The family.
 */
export function specFamily_of(spec: string | null): string | null {
  const match: RegExpMatchArray | null = spec?.match(/^family:\s*([A-Za-z0-9.]+)/m) ?? null;
  return match?.[1] ?? null;
}

/**
 * The capacity rows for families in a region.
 *
 * @param driver - The cloud.
 * @param region - The region.
 * @param families - The families.
 * @returns One row per limit and zone, family by family.
 */
export async function capacityRows_read(driver: CloudDriver, region: string, families: ReadonlyArray<string>): Promise<CapacityRow[]> {
  const shapes: CloudShape[] = await driver.shapes_list(region);
  const rows: CapacityRow[] = [];
  for (const family of families) {
    const ofFamily: CloudShape[] = shapes.filter((shape: CloudShape): boolean => shape.family.toLowerCase() === family.toLowerCase());
    const quotas: Map<string, string> = new Map();
    for (const shape of ofFamily) for (const name of shape.quotaNames) quotas.set(name, shape.limitService);
    const byService: Map<string, CloudLimit[]> = new Map();
    for (const [name, service] of quotas) {
      if (!byService.has(service)) byService.set(service, await driver.limits_list(region, service));
      const limits: CloudLimit[] = (byService.get(service) ?? []).filter((limit: CloudLimit): boolean => limit.name === name);
      for (const limit of limits) {
        const availability: CloudAvailability | null = await driver.limitAvailability_get(region, limit.service, limit.name, limit.zone);
        rows.push({ family, limit: limit.name, zone: limit.zone ?? null, value: limit.value, used: availability?.used ?? null, available: availability?.available ?? null });
      }
    }
  }
  return rows;
}

/** One row as a line. */
function row_line(row: CapacityRow, limitWidth: number, zoneWidth: number): string {
  const free: string = row.available === null ? chalk.gray(`${row.value} permitted, use not reported`) : `${row.available} of ${row.value} free`;
  return `${row.family.padEnd(4)}  ${row.limit.padEnd(limitWidth)}  ${(row.zone ?? 'region').padEnd(zoneWidth)}  ${free}`;
}

/**
 * Runs `capacity`.
 *
 * @param context - The session.
 * @param args - Families, or none for the domains' own.
 * @returns The envelope, with the `stratus.capacity` model.
 */
export async function capacity_run(context: CapacityCommandContext, args: ReadonlyArray<string>): Promise<CommandEnvelope> {
  const region: string | null = context.region();
  if (region === null) return envelope_error('', undefined, 'capacity: not connected\n');
  const families: string[] = args.length > 0
    ? [...args]
    : [...new Set(context.domains.domains_read().map((domain: HarborDomain): string | null => specFamily_of(domain.spec)).filter((family: string | null): family is string => family !== null))];
  if (families.length === 0) return envelope_error('', undefined, 'capacity: name a shape family (capacity E5); no domain\'s spec names one\n');
  const rows: CapacityRow[] = await capacityRows_read(context.driver, region, families);
  const model: CapacityModel = { region, rows };
  if (rows.length === 0) return envelope_ok(`capacity in ${region}: no limits for ${families.join(', ')}\n`, { kind: STRATUS_CAPACITY_MODEL_KIND, data: model });
  const limitWidth: number = Math.max(...rows.map((row: CapacityRow): number => row.limit.length));
  const zoneWidth: number = Math.max(...rows.map((row: CapacityRow): number => (row.zone ?? 'region').length));
  const text: string = [`capacity in ${region}`, ...rows.map((row: CapacityRow): string => row_line(row, limitWidth, zoneWidth))].join('\n');
  return envelope_ok(`${text}\n`, { kind: STRATUS_CAPACITY_MODEL_KIND, data: model });
}

/** `capacity`'s help. */
export const CAPACITY_HELP: CommandHelp = {
  usage: 'capacity [<family>…]',
  summary: 'What the region has free for a shape family, per zone',
  category: 'Resources',
  description: 'For each shape family named (or, with none, each family a domain\'s spec names), the limits its shapes draw on in the session\'s region, at every zone they are kept in: what is permitted and, when the cloud says, how much is free. The same facts are under regions/<region>/limits.',
  examples: ['capacity', 'capacity E5 A1'],
};
