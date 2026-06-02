/**
 * @file PluginInstance resource operations.
 * @module
 */

import { ChRISPluginInstanceGroup, FilteredResourceData, ListOptions } from '@fnndsc/cumin';

/**
 * Lists all plugin instances / jobs across all pages.
 *
 * @param options - Search options (limit/offset managed internally).
 */
export async function pluginInstances_listAll(options: Partial<ListOptions> = {}): Promise<FilteredResourceData | null> {
  const group = new ChRISPluginInstanceGroup();
  return await group.asset.resources_getAll(options);
}

/**
 * Returns available field names for plugin instances.
 */
export async function pluginInstanceFields_get(): Promise<string[] | null> {
  const group = new ChRISPluginInstanceGroup();
  const result = await group.asset.resourceFields_get();
  return result ? result.fields : null;
}
