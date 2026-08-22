/**
 * @file Store operations.
 *
 * Logic for interacting with the peer ChRIS store (listing, searching).
 * Failures propagate as Err rather than an empty array, so a store outage is
 * distinguishable from a store with no plugins; the underlying fetch has
 * already pushed its reason onto the error stack.
 *
 * @module
 */
import { ChRISPlugin, Result, Ok, Err } from '@fnndsc/cumin';

/**
 * Lists plugins from the peer store.
 *
 * @param storeUrl - Optional URL of the peer store.
 * @returns Ok with raw plugin objects (possibly empty), or Err when the store
 *   fetch failed (reason already on the error stack).
 */
export async function store_list(storeUrl?: string): Promise<Result<Record<string, unknown>[]>> {
  const chrisPlugin: ChRISPlugin = new ChRISPlugin();
  const plugins: Record<string, unknown>[] | null = await chrisPlugin.plugin_listPeerStore(storeUrl);
  return plugins === null ? Err() : Ok(plugins);
}

/**
 * Searches plugins in the peer store.
 *
 * @param query - Search query (e.g. plugin name substring).
 * @param storeUrl - Optional URL of the peer store.
 * @returns Ok with matching raw plugin objects (possibly empty), or Err when
 *   the store fetch failed (reason already on the error stack).
 */
export async function store_search(query: string, storeUrl?: string): Promise<Result<Record<string, unknown>[]>> {
  const chrisPlugin: ChRISPlugin = new ChRISPlugin();
  // Search by name
  const plugins: Record<string, unknown>[] | null = await chrisPlugin.plugin_listPeerStore(storeUrl, { name: query });
  return plugins === null ? Err() : Ok(plugins);
}
