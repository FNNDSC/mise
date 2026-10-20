/**
 * @file How a stratus listing shows: its item kinds and the colour of a name.
 *
 * Every row is a folder or a file to the shell (docs/stratus.adoc, D5); the
 * kind is how `ls -l` draws it: the container nouns, the resource kinds, the
 * facts under `regions/`. A name is coloured by its kind and, where the item
 * carries one, its lifecycle state: running green, stopped dim, provisioning
 * amber, failed red, as jobs are by status.
 *
 * @module
 */
import chalk from 'chalk';
import { LISTING_CORE_KINDS, type ItemKindLook, type ListingLook, type VFSItem } from '@fnndsc/fond';

/** The container nouns every cloud maps onto (docs/stratus.adoc, D4). */
export const CONTAINER_TYPES: ReadonlyArray<string> = ['tenancy', 'compartment', 'account', 'organization', 'project', 'folder', 'subscription', 'resourcegroup', 'managementgroup'];

/** The kinds stratus lists beside the core's. */
export const STRATUS_ITEM_KINDS: ReadonlyArray<ItemKindLook> = [
  ...CONTAINER_TYPES.map((type: string): ItemKindLook => ({ type, mark: 'c', container: true, sizeColumn: state_column })),
  { type: 'region', mark: 'r', container: true },
  { type: 'zone', mark: 'z', container: true },
  { type: 'service', mark: 'd', container: true },
  { type: 'limit', mark: 'L', container: true },
  { type: 'shape', mark: 's', container: true },
  { type: 'price', mark: '$', container: true },
  { type: 'domain', mark: 'D', container: true, sizeColumn: state_column },
];

/** The long view's size column for an item with a state: the state. */
function state_column(item: VFSItem): string | null {
  return item.status !== undefined && item.status !== '' ? item.status : null;
}

/** States and the tone each is drawn in. */
const STATE_TONES: ReadonlyArray<{ readonly matches: RegExp; readonly paint: (text: string) => string }> = [
  { matches: /^(running|active|available|attached|ready|done)$/, paint: chalk.green },
  { matches: /^(stopped|inactive|terminated|deleted|detached)$/, paint: chalk.dim },
  { matches: /^(provisioning|creating|starting|stopping|updating|deleting|terminating|moving|queued|pending)$/, paint: chalk.yellow },
  { matches: /^(failed|faulted|error|unknown_value)$/, paint: chalk.red },
];

/** Colours a name by the item's kind and state. */
export function stratusName_colorize(name: string, type: string, status?: string): string {
  if (status !== undefined) {
    const tone = STATE_TONES.find((entry): boolean => entry.matches.test(status.toLowerCase()));
    if (tone !== undefined) return tone.paint(name);
  }
  if (CONTAINER_TYPES.includes(type) || type === 'dir') return chalk.blue(name);
  if (type === 'region' || type === 'zone') return chalk.cyan(name);
  if (type === 'domain') return chalk.magenta(name);
  if (type === 'shape' || type === 'price' || type === 'limit' || type === 'service') return chalk.white(name);
  return name;
}

/** The look of a stratus listing. */
export const stratusListingLook: ListingLook = {
  kinds: [...LISTING_CORE_KINDS, ...STRATUS_ITEM_KINDS],
  name_colorize: (name: string, type: string): string => stratusName_colorize(name, type),
};
