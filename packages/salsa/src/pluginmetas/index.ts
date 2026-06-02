/**
 * @file PluginMeta resource operations.
 * @module
 */

import { ChRISPluginMetaGroup, FilteredResourceData, ListOptions } from '@fnndsc/cumin';

/**
 * Lists plugin metas (single page).
 *
 * @param options - Search and pagination options.
 */
export async function pluginMetas_list(options: ListOptions): Promise<FilteredResourceData | null> {
  const group = new ChRISPluginMetaGroup();
  return await group.asset.resources_listAndFilterByOptions(options);
}

/**
 * Lists all plugin metas across all pages.
 *
 * @param options - Search options (limit/offset managed internally).
 */
export async function pluginMetas_listAll(options: Partial<ListOptions> = {}): Promise<FilteredResourceData | null> {
  const group = new ChRISPluginMetaGroup();
  return await group.asset.resources_getAll(options);
}

/**
 * Returns available field names for plugin metas.
 */
export async function pluginMetaFields_get(): Promise<string[] | null> {
  const group = new ChRISPluginMetaGroup();
  const result = await group.asset.resourceFields_get();
  return result ? result.fields : null;
}
