/**
 * @file Tag resource operations.
 * @module
 */

import { ChRISTagGroup, FilteredResourceData, ListOptions } from '@fnndsc/cumin';

/**
 * Lists tags (single page).
 *
 * @param options - Search and pagination options.
 */
export async function tags_list(options: ListOptions): Promise<FilteredResourceData | null> {
  const group: ChRISTagGroup = new ChRISTagGroup();
  return await group.asset.resources_listAndFilterByOptions(options);
}

/**
 * Lists all tags across all pages.
 *
 * @param options - Search options (limit/offset managed internally).
 */
export async function tags_listAll(options: Partial<ListOptions> = {}): Promise<FilteredResourceData | null> {
  const group: ChRISTagGroup = new ChRISTagGroup();
  return await group.asset.resources_getAll(options);
}

/**
 * Returns available field names for tags.
 */
export async function tagFields_get(): Promise<string[] | null> {
  const group: ChRISTagGroup = new ChRISTagGroup();
  const result = await group.asset.resourceFields_get();
  return result ? result.fields : null;
}
