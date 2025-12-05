/**
 * @file Peer Store Plugin Search
 *
 * This module provides functionality to search for plugins in peer ChRIS stores
 * (public plugin repositories). Used during plugin registration to check if a
 * plugin already exists in public stores before attempting Docker extraction.
 *
 * @module
 */

import { ChRISPlugin } from '@fnndsc/cumin';

/**
 * Interface representing a plugin found in a peer store.
 */
export interface PeerStorePlugin {
  plugin: Record<string, unknown>;
  storeUrl: string;
  storeName: string;
}

/**
 * Searches for a plugin across multiple peer ChRIS stores.
 *
 * Queries each peer store in order until a match is found. Returns the first
 * matching plugin along with its store URL.
 *
 * @param pluginName - Name of the plugin to search for.
 * @param version - Optional version of the plugin to search for.
 * @param peerStoreUrls - Array of peer store URLs to search (default: cube.chrisproject.org).
 * @returns Promise resolving to plugin data and store URL, or null if not found.
 *
 * @example
 * ```typescript
 * const result = await plugins_searchPeers('pl-dircopy');
 * if (result) {
 *   console.log(`Found plugin at ${result.storeUrl}`);
 * }
 * ```
 */
export async function plugins_searchPeers(
  pluginName: string,
  version?: string,
  peerStoreUrls: string[] = ['https://cube.chrisproject.org/api/v1/']
): Promise<PeerStorePlugin | null> {
  const chrisPlugin = new ChRISPlugin();

  for (const peerStoreUrl of peerStoreUrls) {
    const result = await chrisPlugin.plugin_searchPeerStore(pluginName, version, peerStoreUrl);
    if (result) {
      return {
        plugin: result.plugin,
        storeUrl: result.storeUrl,
        storeName: storeName_extractFromUrl(peerStoreUrl)
      };
    }
  }

  return null;
}

/**
 * Extracts a human-readable store name from a store URL.
 *
 * @param url - The peer store URL.
 * @returns A short name for the store.
 *
 * @example
 * ```typescript
 * storeName_extractFromUrl('https://cube.chrisproject.org/api/v1/')
 * // Returns: 'cube.chrisproject.org'
 * ```
 */
function storeName_extractFromUrl(url: string): string {
  try {
    const urlObj: URL = new URL(url);
    return urlObj.hostname;
  } catch {
    return url;
  }
}

/**
 * Searches for a plugin by Docker image name in peer stores.
 *
 * Extracts the plugin name from the Docker image and searches peer stores.
 *
 * @param dockerImage - Docker image string (e.g., 'fnndsc/pl-dircopy:2.1.1').
 * @param peerStoreUrls - Array of peer store URLs to search.
 * @returns Promise resolving to plugin data or null if not found.
 *
 * @example
 * ```typescript
 * const result = await plugin_searchPeersByImage('fnndsc/pl-dircopy:2.1.1');
 * ```
 */
export async function plugin_searchPeersByImage(
  dockerImage: string,
  peerStoreUrls?: string[]
): Promise<PeerStorePlugin | null> {
  // Extract plugin name from docker image
  // Examples:
  //   'fnndsc/pl-dircopy:2.1.1' -> 'pl-dircopy'
  //   'pl-dircopy:latest' -> 'pl-dircopy'
  //   'localhost:5000/pl-custom' -> 'pl-custom'
  const imageParts: string[] = dockerImage.split('/');
  const lastPart: string = imageParts[imageParts.length - 1];
  const pluginName: string = lastPart.split(':')[0];

  return await plugins_searchPeers(pluginName, undefined, peerStoreUrls);
}
