/**
 * @file Compute resource operations.
 * @module
 */

import { ChRISComputeResourceGroup, FilteredResourceData, ListOptions } from '@fnndsc/cumin';

/**
 * Lists compute resources (single page).
 */
export async function computeResources_list(options: ListOptions): Promise<FilteredResourceData | null> {
  const group = new ChRISComputeResourceGroup();
  return await group.asset.resources_listAndFilterByOptions(options);
}

/**
 * Lists all compute resources across all pages.
 */
export async function computeResources_listAll(options: Partial<ListOptions> = {}): Promise<FilteredResourceData | null> {
  const group = new ChRISComputeResourceGroup();
  return await group.asset.resources_getAll(options);
}

/**
 * Returns available field names for compute resources.
 */
export async function computeResourceFields_get(): Promise<string[] | null> {
  const group = new ChRISComputeResourceGroup();
  const result = await group.asset.resourceFields_get();
  return result ? result.fields : null;
}
