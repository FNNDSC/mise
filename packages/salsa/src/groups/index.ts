/**
 * @file Group resource operations.
 * @module
 */

import { ChRISGroupGroup, FilteredResourceData, ListOptions } from '@fnndsc/cumin';

/**
 * Lists groups (single page).
 *
 * @param options - Search and pagination options.
 */
export async function groups_list(options: ListOptions): Promise<FilteredResourceData | null> {
  const group = new ChRISGroupGroup();
  return await group.asset.resources_listAndFilterByOptions(options);
}

/**
 * Lists all groups across all pages.
 *
 * @param options - Search options (limit/offset managed internally).
 */
export async function groups_listAll(options: Partial<ListOptions> = {}): Promise<FilteredResourceData | null> {
  const group = new ChRISGroupGroup();
  return await group.asset.resources_getAll(options);
}

/**
 * Returns available field names for groups.
 */
export async function groupFields_get(): Promise<string[] | null> {
  const group = new ChRISGroupGroup();
  const result = await group.asset.resourceFields_get();
  return result ? result.fields : null;
}
