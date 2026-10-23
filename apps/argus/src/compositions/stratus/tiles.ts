/**
 * @file The stratus composition's dashboard tiles: DOMAINS (each Trusted
 * Domain, its last step, a step gone wrong in red; a row opens the TD
 * controller on it) and CAPACITY (what the
 * region has free for the shape families the domains' specs name)
 * (docs/stratus.adoc, D11).
 *
 * Each is asked of the session at paint time, from the commands a terminal
 * runs too: `domain status` and `capacity`, through their models.
 *
 * @module
 */
import {
  capacityModelSchema, domainsModelSchema, STRATUS_CAPACITY_MODEL_KIND, STRATUS_DOMAINS_MODEL_KIND,
  type CapacityModel, type CapacityRow, type DomainSummary, type DomainsModel,
} from '@fnndsc/menu';
import type { ExecuteOutcome } from '../../calypso/client.js';
import { TILE_ABOUT } from '../../features/launcher/about.js';
import type { LauncherRow, LauncherTile } from '../../features/launcher/panel.js';
import type { TileContribution } from '../../app/dashboardTiles.js';

/** What the stratus tiles reach. */
export interface StratusTileHooks {
  /** Asks the session a line, quietly. */
  ask: (line: string) => Promise<ExecuteOutcome>;
  /** Opens the TD controller on a domain: the line `domain <name>`. */
  domain_open: (name: string) => void;
  /** Opens home. */
  home_open: () => void;
  /** Runs a line in the console, where its answer is read whole. */
  line_run: (line: string) => void;
  /** Told the domains each paint finds, so the language claims `domain <name>` before the controller has read them. */
  names_seen?: (names: string[]) => void;
}

/** The step states a tile draws as gone wrong. */
const WRONG_STATES: ReadonlyArray<string> = ['expired', 'failed', 'error'];

/** The model of a kind an answer carries, parsed; null when it carries none. */
function model_of<T>(answer: ExecuteOutcome, kind: string, parse: (data: unknown) => { success: boolean; data?: T }): T | null {
  for (const envelope of answer.envelopes) {
    if (envelope.model?.kind !== kind) continue;
    const parsed = parse(envelope.model.data);
    if (parsed.success && parsed.data !== undefined) return parsed.data;
  }
  return null;
}

/**
 * A zone as a tile has room for: the part after the cloud's prefix
 * (`disG:US-ASHBURN-AD-1` reads `US-ASHBURN-AD-1`).
 *
 * @param zone - The zone, or null for region-wide.
 * @returns The short form.
 */
export function zoneShort_of(zone: string | null): string {
  if (zone === null) return 'REGION';
  return zone.includes(':') ? zone.slice(zone.indexOf(':') + 1) : zone;
}

/**
 * A limit as a tile has room for: its measure, the family and `count` dropped
 * (`standard-e5-core-count` reads `core`).
 *
 * @param row - The capacity row.
 * @returns The short form.
 */
export function limitShort_of(row: CapacityRow): string {
  return row.limit.replace(new RegExp(`^(standard-)?${row.family.toLowerCase()}-`), '').replace(/-count$/, '');
}

/** One capacity row as a tile row's text. */
function capacityRow_text(row: CapacityRow): string {
  const free: string = row.available === null ? `${row.value} PERMITTED` : `${row.available} / ${row.value} FREE`;
  return `${row.family.toUpperCase()}  ${zoneShort_of(row.zone)}  ${limitShort_of(row)}  ${free}`;
}

/**
 * Money on a tile: `$0.62`, or `EUR 0.62`.
 *
 * @param amount - The amount.
 * @param currency - Its currency.
 * @returns The text.
 */
export function money_text(amount: number, currency: string): string {
  return `${currency === 'USD' ? '$' : `${currency} `}${amount.toFixed(2)}`;
}

/**
 * Makes the stratus tiles' source: asked each time the dashboard paints.
 *
 * @param hooks - What the tiles reach.
 * @returns The source.
 */
export function stratusTiles_make(hooks: StratusTileHooks): () => Promise<TileContribution> {
  return async (): Promise<TileContribution> => {
    const [domainsAnswer, capacityAnswer]: [ExecuteOutcome, ExecuteOutcome] = await Promise.all([hooks.ask('domain status'), hooks.ask('capacity')]);
    const domainsModel: DomainsModel | null = model_of(domainsAnswer, STRATUS_DOMAINS_MODEL_KIND, (data) => domainsModelSchema.safeParse(data));
    const domains: DomainSummary[] = domainsModel?.domains ?? [];
    if (domainsModel !== null) hooks.names_seen?.(domains.map((domain: DomainSummary): string => domain.name));
    const wrong = (domain: DomainSummary): boolean => domain.steps.some((step): boolean => WRONG_STATES.includes(step.state));
    const wrongCount: number = domains.filter(wrong).length;
    // What the domains cost an hour together, at list price, when the daemon priced them.
    const priced: DomainSummary[] = domains.filter((domain: DomainSummary): boolean => domain.cost !== undefined && domain.cost !== null);
    const hourly: number = priced.reduce((sum: number, domain: DomainSummary): number => sum + (domain.cost?.hourly ?? 0), 0);
    const domainsTile: LauncherTile = {
      key: 'domains', name: 'DOMAINS', hue: '--october-sunset', numeral: '',
      figures: [
        { text: domains.length === 0 ? 'NONE' : `${domains.length} DOMAIN${domains.length === 1 ? '' : 'S'}` },
        ...(wrongCount > 0 ? [{ text: `${wrongCount} NEED${wrongCount === 1 ? 'S' : ''} A LOOK`, errored: true }] : []),
        ...(priced.length > 0 ? [{ text: `${money_text(hourly, priced[0]?.cost?.currency ?? 'USD')}/H` }] : []),
      ],
      rows: domains.slice(0, 6).map((domain: DomainSummary): LauncherRow => ({
        // The rate before the cluster's long name, so a narrow tile cuts the name, not the money.
        text: `${domain.name}  ${domain.lastDone ?? 'NOTHING DONE'}${domain.cost !== undefined && domain.cost !== null ? `  ${money_text(domain.cost.hourly, domain.cost.currency)}/h` : ''}  ${domain.cluster ?? ''}`.trimEnd(),
        errored: wrong(domain),
        // A row is that domain's line: the TD controller opens on it (docs/stratus.adoc, D13).
        open: (): void => hooks.domain_open(domain.name),
      })),
      verb: 'OPEN THE DOMAINS',
      about: TILE_ABOUT['domains'],
      enter: (): void => hooks.home_open(),
    };

    const capacity: CapacityModel | null = model_of(capacityAnswer, STRATUS_CAPACITY_MODEL_KIND, (data) => capacityModelSchema.safeParse(data));
    const capacityTile: LauncherTile = {
      key: 'capacity', name: 'CAPACITY', hue: '--honey', numeral: '',
      figures: capacity === null ? [{ text: 'NO FAMILY' }] : [{ text: capacity.region.toUpperCase() }],
      // With no family to read, the block teaches the line that names one.
      rows: capacity === null
        ? [{ text: 'capacity E5', open: (): void => hooks.line_run('capacity E5') }]
        : capacity.rows.slice(0, 6).map((row: CapacityRow): LauncherRow => ({
          text: capacityRow_text(row),
          errored: row.available === 0,
          open: (): void => hooks.line_run(`capacity ${row.family}`),
        })),
      verb: 'READ CAPACITY',
      about: TILE_ABOUT['capacity'],
      enter: (): void => hooks.line_run('capacity'),
    };
    return {
      lead: { tile: domainsTile, weight: domains.length },
      afterFiles: [capacityTile],
      afterPanes: [],
      about: { files: { text: 'Your home: the Trusted Domains this session knows, each a folder of its spec, settings, state and steps.' } },
    };
  };
}
