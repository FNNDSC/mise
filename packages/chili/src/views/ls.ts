/**
 * @file View layer for the `ls` command.
 *
 * A listing renders through fond's listing views with the ChRIS look: the
 * core's kinds plus plugins, pipelines and jobs, and names coloured by the
 * colour configuration. This module keeps the shapes its callers have
 * always used.
 *
 * - Grid: Multi-column standard view.
 * - Long: Detailed list with metadata (-l).
 * - JSON: Raw structured data.
 *
 * @module
 */
import chalk from 'chalk';
import {
  grid_render as listingGrid_render,
  long_render as listingLong_render,
  listingItems_sort,
  size_format as listingSize_format,
  LISTING_CORE_KINDS,
  type ItemKindLook,
  type ListingLook,
  type VFSItem,
} from '@fnndsc/fond';
import { ListingItem } from '../models/listing.js';
import { fileSystemItem_colorize } from '../config/colorConfig.js';

/**
 * Options for the view renderers.
 */
export interface ViewOptions {
  human?: boolean; // Human-readable sizes
  oneColumn?: boolean; // Force single-column output (like ls -1)
  // Note: sort and reverse are now handled at the command layer
  // These are kept for backwards compatibility but should not be used
  sort?: 'name' | 'size' | 'date' | 'owner'; // DEPRECATED: Sort at command layer instead
  reverse?: boolean; // DEPRECATED: Sort at command layer instead
}

/**
 * A job's status as the long view shows it in the size column, coloured by
 * how the job stands.
 *
 * @param item - The job.
 * @returns The status, or null for a job with none (its size shows).
 */
function jobStatus_column(item: VFSItem): string | null {
  const s: string | undefined = item.status;
  if (!s) return null;
  const statusColoured: string =
    s === 'finishedSuccessfully' ? chalk.green(s) :
    s === 'finishedWithError'    ? chalk.red(s) :
    s === 'cancelled'            ? chalk.gray(s) :
    s === 'started' || s === 'running' ? chalk.yellow(s) :
    chalk.gray(s);
  return statusColoured.padEnd(30);
}

/** The kinds a ChRIS listing shows beside the core's. */
export const CHRIS_ITEM_KINDS: ReadonlyArray<ItemKindLook> = [
  { type: 'plugin', mark: 'p' },
  { type: 'pipeline', mark: 'P' },
  { type: 'job', mark: 'j', container: true, sizeColumn: jobStatus_column },
];

/** How a ChRIS listing shows: the core's kinds and its own, coloured by the colour configuration. */
export const chrisListingLook: ListingLook = {
  kinds: [...LISTING_CORE_KINDS, ...CHRIS_ITEM_KINDS],
  name_colorize: (name: string, type: string): string => fileSystemItem_colorize(name, type),
};

/**
 * Formats bytes into human-readable string.
 */
export function size_format(bytes: number): string {
  return listingSize_format(bytes);
}

/**
 * DEPRECATED: Sorts an array of listing items based on specified criteria.
 * @deprecated Sorting should be done at the command layer, not in views.
 * @param items - Array of items to sort.
 * @param sortBy - Field to sort by (default: 'name').
 * @param reverse - Whether to reverse the sort order.
 * @returns Sorted array of items.
 */
export function items_sort(
  items: ListingItem[],
  sortBy: 'name' | 'size' | 'date' | 'owner' = 'name',
  reverse: boolean = false
): ListingItem[] {
  return listingItems_sort(items, sortBy, reverse);
}

/**
 * The items in the order the deprecated view options ask for.
 *
 * @param items - The items.
 * @param options - The view options.
 * @returns The items, sorted when the options say so.
 */
function itemsLegacy_sort(items: ListingItem[], options: ViewOptions): ListingItem[] {
  return options.sort ? items_sort(items, options.sort, options.reverse || false) : items;
}

/**
 * Renders the items in a multi-column grid format (standard `ls`).
 * Note: Items should already be sorted at the command layer.
 */
export function grid_render(items: ListingItem[], options: ViewOptions = {}): string {
  return listingGrid_render(itemsLegacy_sort(items, options), options, chrisListingLook);
}

/**
 * Renders the items in a long list format (`ls -l`).
 * Note: Items should already be sorted at the command layer.
 */
export function long_render(items: ListingItem[], options: ViewOptions = {}): string {
  return listingLong_render(itemsLegacy_sort(items, options), options, chrisListingLook);
}

/**
 * Renders the items as a JSON string.
 */
export function json_render(items: ListingItem[]): string {
  return JSON.stringify(items, null, 2);
}
