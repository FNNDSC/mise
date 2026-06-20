/**
 * @file Implements listing ChRIS plugin metas.
 * @module
 */
import { pluginMetas_list as salsaPluginMetas_list, pluginMetas_listAll as salsaPluginMetas_listAll } from '@fnndsc/salsa';
import { FilteredResourceData } from '@fnndsc/cumin';
import { CLIoptions, options_toParams } from '../../utils/cli.js';
import { list_applySort } from '../../utils/sort.js';

/**
 * Result of listing plugin-metas (table data plus selected fields).
 */
export interface PluginMetaListResult {
  pluginMetas: Record<string, unknown>[];
  selectedFields: string[];
  totalCount?: number;
}

/**
 * Fetches a list of plugin-metas.
 *
 * @param options - List and filter options.
 * @returns The plugin-metas list result.
 */
export async function pluginMetas_fetchList(options: CLIoptions): Promise<PluginMetaListResult> {
  const params = options_toParams(options);
  const result: FilteredResourceData | null = options.all
    ? await salsaPluginMetas_listAll(params)
    : await salsaPluginMetas_list(params);

  if (result && result.tableData) {
    let pluginMetas: Record<string, unknown>[] = result.tableData as Record<string, unknown>[];
    if (options.sort) pluginMetas = list_applySort(pluginMetas, options.sort, options.reverse);
    return { pluginMetas, selectedFields: result.selectedFields || [], totalCount: result.totalCount };
  }
  return { pluginMetas: [], selectedFields: [] };
}
