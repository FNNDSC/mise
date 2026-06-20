/**
 * @file Implements listing ChRIS plugin instances (jobs).
 * @module
 */
import { pluginInstances_list as salsaPluginInstances_list, pluginInstances_listAll as salsaPluginInstances_listAll } from '@fnndsc/salsa';
import { FilteredResourceData } from '@fnndsc/cumin';
import { CLIoptions, options_toParams } from '../../utils/cli.js';
import { list_applySort } from '../../utils/sort.js';

/**
 * Result of listing plugin-instances (table data plus selected fields).
 */
export interface PluginInstanceListResult {
  pluginInstances: Record<string, unknown>[];
  selectedFields: string[];
  totalCount?: number;
}

/**
 * Fetches a list of plugin-instances.
 *
 * @param options - List and filter options.
 * @returns The plugin-instances list result.
 */
export async function pluginInstances_fetchList(options: CLIoptions): Promise<PluginInstanceListResult> {
  const params = options_toParams(options);
  const result: FilteredResourceData | null = options.all
    ? await salsaPluginInstances_listAll(params)
    : await salsaPluginInstances_list(params);

  if (result && result.tableData) {
    let pluginInstances: Record<string, unknown>[] = result.tableData as Record<string, unknown>[];
    if (options.sort) pluginInstances = list_applySort(pluginInstances, options.sort, options.reverse);
    return { pluginInstances, selectedFields: result.selectedFields || [], totalCount: result.totalCount };
  }
  return { pluginInstances: [], selectedFields: [] };
}
