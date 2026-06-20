/**
 * @file Workflow resource operations.
 * @module
 */

import { ChRISWorkflowGroup, FilteredResourceData, ListOptions } from '@fnndsc/cumin';

/**
 * Lists workflows (single page).
 *
 * @param options - Search and pagination options.
 */
export async function workflows_list(options: ListOptions): Promise<FilteredResourceData | null> {
  const group: ChRISWorkflowGroup = new ChRISWorkflowGroup();
  return await group.asset.resources_listAndFilterByOptions(options);
}

/**
 * Lists all workflows across all pages.
 *
 * @param options - Search options (limit/offset managed internally).
 */
export async function workflows_listAll(options: Partial<ListOptions> = {}): Promise<FilteredResourceData | null> {
  const group: ChRISWorkflowGroup = new ChRISWorkflowGroup();
  return await group.asset.resources_getAll(options);
}

/**
 * Returns available field names for workflows.
 */
export async function workflowFields_get(): Promise<string[] | null> {
  const group: ChRISWorkflowGroup = new ChRISWorkflowGroup();
  const result = await group.asset.resourceFields_get();
  return result ? result.fields : null;
}
