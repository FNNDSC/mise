/**
 * @file Implements listing ChRIS tags.
 * @module
 */
import { tags_list as salsaTags_list, tags_listAll as salsaTags_listAll } from '@fnndsc/salsa';
import { FilteredResourceData } from '@fnndsc/cumin';
import { CLIoptions, options_toParams } from '../../utils/cli.js';
import { list_applySort } from '../../utils/sort.js';

/**
 * Result of listing tags (table data plus selected fields).
 */
export interface TagListResult {
  tags: Record<string, unknown>[];
  selectedFields: string[];
  totalCount?: number;
}

/**
 * Fetches a list of tags.
 *
 * @param options - List and filter options.
 * @returns The tags list result.
 */
export async function tags_fetchList(options: CLIoptions): Promise<TagListResult> {
  const params = options_toParams(options);
  const result: FilteredResourceData | null = options.all
    ? await salsaTags_listAll(params)
    : await salsaTags_list(params);

  if (result && result.tableData) {
    let tags: Record<string, unknown>[] = result.tableData as Record<string, unknown>[];
    if (options.sort) tags = list_applySort(tags, options.sort, options.reverse);
    return { tags, selectedFields: result.selectedFields || [], totalCount: result.totalCount };
  }
  return { tags: [], selectedFields: [] };
}
