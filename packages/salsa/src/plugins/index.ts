/**
 * @file Plugin management operations.
 * @module
 */

import {
  ChRISPlugin,
  QueryHits,
  Dictionary,
  ChRISPluginMetaPluginGroup, // Not directly used in functions yet, but for potential future logic
  ChRISPluginGroup,
  FilteredResourceData,
  ListOptions,
  objContext_create
} from '@fnndsc/cumin';
import axios from 'axios';

// ... existing interfaces ...

/**
 * List plugins based on options.
 *
 * @param options - Search and pagination options.
 * @returns A Promise resolving to FilteredResourceData or null.
 */
export async function plugins_list(options: ListOptions): Promise<FilteredResourceData | null> {
  const pluginGroup = (await objContext_create(
    "ChRISPluginGroup",
    "plugin"
  )) as ChRISPluginGroup;

  if (!pluginGroup) {
    return null;
  }

  return await pluginGroup.asset.resources_listAndFilterByOptions(options);
}

/**
 * Get the list of available fields for plugins.
 *
 * @returns A Promise resolving to an array of field names or null.
 */
export async function pluginFields_get(): Promise<string[] | null> {
  const pluginGroup = (await objContext_create(
    "ChRISPluginGroup",
    "plugin"
  )) as ChRISPluginGroup;

  if (!pluginGroup) {
    return null;
  }

  const results = await pluginGroup.asset.resourceFields_get();
  return results ? results.fields : null;
}

/**
 * Interface for options when searching for a plugin.
 * This should be expanded as needed to reflect actual search parameters.
 */
export interface PluginSearchOptions {
  search?: string;
  name?: string;
  id?: string;
  // Add other search parameters as they become known and needed
  [key: string]: any; // Allow for arbitrary key-value pairs initially
}

/**
 * Run a plugin instance.
 *
 * This function orchestrates the execution of a ChRIS plugin with specified parameters.
 *
 * @param searchable - A string that identifies the plugin (e.g., name, ID, or a partial match).
 * @param parameters - An object containing the parameters for the plugin execution.
 * @returns A Promise resolving to a Dictionary representing the created plugin instance, or null if execution failed.
 */
export async function plugin_run(searchable: string, parameters: Dictionary): Promise<Dictionary | null> {
  const chrisPlugin = new ChRISPlugin();
  // Ensure parameters are stringified if cumin expects a string, otherwise pass as object
  // Looking at cumin's plugin_run, it expects string for parameters.
  const paramsString = JSON.stringify(parameters); 
  return await chrisPlugin.plugin_run(searchable, paramsString);
}

/**
 * Resolve a searchable plugin string to a list of plugin IDs.
 *
 * @param searchable - A string that identifies the plugin (e.g., name, ID, or a partial match).
 * @returns A Promise resolving to an array of plugin IDs, or null if no plugins match.
 */
export async function plugins_searchableToIDs(searchable: string): Promise<string[] | null> {
  const chrisPlugin = new ChRISPlugin();
  const queryHits: QueryHits | null = await chrisPlugin.pluginIDs_resolve(searchable);
  if (!queryHits) {
    return null;
  }
  return queryHits.hits as string[];
}

/**
 * Fetch the raw README content from a plugin's repository URL.
 *
 * This function attempts to retrieve README files (Markdown or reStructuredText)
 * from common locations within a given repository URL.
 *
 * @param repoUrl - The base URL of the plugin's Git repository.
 * @returns A Promise resolving to the README content as a string, or null if no README is found or accessible.
 */
export async function pluginMeta_readmeContentFetch(repoUrl: string): Promise<string | null> {
  const readmeUrls = [
    `${repoUrl}/raw/master/README.md`,
    `${repoUrl}/raw/master/README.rst`,
    `${repoUrl}/raw/main/README.md`,
    `${repoUrl}/raw/main/README.rst`,
  ];

  for (const url of readmeUrls) {
    try {
      const response = await axios.get(url);
      if (response.status === 200) {
        return response.data;
      }
    } catch (error) {
      // Continue to next URL
    }
  }
  return null;
}

/**
 * Retrieve the documentation URL for a specific plugin ID.
 *
 * @param pluginId - The ID of the plugin.
 * @returns A Promise resolving to the documentation URL as a string, or null if not found.
 */
export async function pluginMeta_documentationUrlGet(pluginId: string): Promise<string | null> {
  const chrisPlugin = new ChRISPlugin(); // Re-instantiate as it might not be shared
  const query: QueryHits | null = await chrisPlugin.pluginData_getFromSearch(
    { search: `id: ${pluginId}` }, // Assuming cumin can parse this search string
    'documentation'
  );
  if (!query || !query.hits.length) {
    return null;
  }
  return query.hits[0] as string;
}

/**
 * Retrieve a single plugin ID based on search options.
 *
 * This function performs a search for plugins using the provided criteria and
 * returns the ID of the first matching plugin.
 *
 * @param options - An object containing search parameters (e.g., name, id).
 * @returns A Promise resolving to a plugin ID string, or null if no plugin is found or if the search is ambiguous (multiple results).
 */
export async function pluginMeta_pluginIDFromSearch(options: PluginSearchOptions): Promise<string | null> {
  const chrisPlugin = new ChRISPlugin(); // Re-instantiate
  const queryHits: QueryHits | null = await chrisPlugin.pluginData_getFromSearch(options, 'id');
  if (queryHits && queryHits.hits.length === 1) { // Assuming we want a single, unambiguous result
    return queryHits.hits[0] as string;
  } else if (queryHits && queryHits.hits.length > 1) {
    // Optionally log a warning about ambiguity, but for library, just return null or throw.
    return null; // Return null for ambiguous search results
  }
  return null;
}

/**
 * Delete a plugin by its ID.
 *
 * @param id - The ID of the plugin to delete.
 * @returns A Promise resolving to true on success, false on failure.
 */
export async function plugin_delete(id: number): Promise<boolean> {
  const pluginGroup = (await objContext_create(
    "ChRISPluginGroup",
    "plugin"
  )) as ChRISPluginGroup;

  if (!pluginGroup) {
    return false;
  }

  return await pluginGroup.asset.resourceItem_delete(id);
}

/**
 * Provides an overview of plugin operations.
 * Currently a placeholder.
 *
 * @returns A Promise resolving to void.
 */
export async function plugins_overview(): Promise<void> {
  return Promise.resolve();
}

/**
 * Fetch the README for a plugin given its ID.
 *
 * @param pluginId - The ID of the plugin.
 * @returns A Promise resolving to the README content or null.
 */
export async function plugin_readme(pluginId: string): Promise<string | null> {
  const docUrl = await pluginMeta_documentationUrlGet(pluginId);
  if (!docUrl) {
    return null;
  }
  return await pluginMeta_readmeContentFetch(docUrl);
}

// Re-export other utility functions or classes if needed, following the RPN style.
export * from './plugin_register.js';
