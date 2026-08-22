/**
 * @file Base controller: shared resource listing and presentation logic.
 *
 * @module
 */

import {
  FilteredResourceData,
  ChRISPluginGroup,
  ChRISFeedGroup,
  ChRISEmbeddedResourceGroup, // For file system groups
  ListOptions,
  QueryHits,
  record_extract,
  listParams_fromOptions,
  ResourcesByFields,
  errorStack
} from "@fnndsc/cumin";
import { CLIoptions } from "../utils/cli.js";

/**
 * Base controller for managing ChRIS resources.
 * Encapsulates business logic for fetching, filtering, and deleting resources.
 * UI-agnostic.
 */
export class BaseController {
  chrisObject:
    | ChRISPluginGroup
    | ChRISFeedGroup
    | ChRISEmbeddedResourceGroup<unknown>; // Use any for generic type for now

  constructor(
    chrisObject:
      | ChRISPluginGroup
      | ChRISFeedGroup
      | ChRISEmbeddedResourceGroup<unknown>
  ) {
    this.chrisObject = chrisObject;
  }

  /**
   * Fetches and filters resources based on provided options.
   *
   * @param options - CLI options for filtering and pagination.
   * @returns A Promise resolving to FilteredResourceData or null if no resources found.
   */
  async resources_get(options: CLIoptions): Promise<FilteredResourceData | null> {
    try {
      const params: ListOptions = listParams_fromOptions(options);
      const results: FilteredResourceData | null =
        await this.chrisObject.asset.resources_listAndFilterByOptions(params);
      return results;
    } catch (error: unknown) {
      const msg: string = error instanceof Error ? error.message : String(error);
      errorStack.stack_push("error", `Failed to list resources: ${msg}`);
      return null;
    }
  }

  /**
   * Fetches the available fields for the resource type.
   *
   * @returns A Promise resolving to ResourcesByFields or null.
   */
  async resourceFields_get(): Promise<ResourcesByFields | null> {
    return await this.chrisObject.asset.resourceFields_get();
  }

  /**
   * Deletes a resource by its ID.
   *
   * @param id - The ID of the resource to delete.
   * @returns A Promise resolving to true if successful, false otherwise.
   */
  async resource_delete(id: number): Promise<boolean> {
    return await this.chrisObject.asset.resourceItem_delete(id);
  }

  /**
   * Resolves search terms to a list of resource IDs.
   *
   * @param options - CLI options containing search terms.
   * @returns A Promise resolving to an array of IDs or null.
   */
  async resourceIDs_resolve(options: CLIoptions): Promise<number[] | null> {
    const params: ListOptions = listParams_fromOptions(options);
    const searchResults: FilteredResourceData | null =
      await this.chrisObject.asset.resources_listAndFilterByOptions(params);
    
    if (!searchResults) {
      return null;
    }
    
    const queryHits: QueryHits = record_extract(
      searchResults.tableData,
      "id"
    );
    return queryHits.hits as number[];
  }
}
