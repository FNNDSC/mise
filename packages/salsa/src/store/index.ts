/**
 * @file Store operations.
 *
 * Logic for interacting with the peer ChRIS store (listing, searching).
 *
 * @module
 */
import { ChRISPlugin } from '@fnndsc/cumin';

/**
 * Lists plugins from the peer store.
 *
 * @param storeUrl - Optional URL of the peer store.
 * @returns Promise resolving to array of raw plugin objects.
 */
export async function store_list(storeUrl?: string): Promise<Record<string, unknown>[]> {
  const chrisPlugin = new ChRISPlugin();
  const plugins = await chrisPlugin.plugin_listPeerStore(storeUrl);
  return plugins || [];
}

/**
 * Searches plugins in the peer store.
 *
 * @param query - Search query (e.g. plugin name substring).
 * @param storeUrl - Optional URL of the peer store.
 * @returns Promise resolving to array of raw plugin objects.
 */
export async function store_search(query: string, storeUrl?: string): Promise<Record<string, unknown>[]> {
  const chrisPlugin = new ChRISPlugin();
  // Search by name
  const plugins = await chrisPlugin.plugin_listPeerStore(storeUrl, { name: query });
  return plugins || [];
}
