/**
 * @file Plugin Import from Store
 *
 * This module provides functionality to import plugins from peer ChRIS stores
 * directly, without needing to extract from Docker images. This is faster and
 * more reliable than Docker extraction when the plugin already exists in a
 * public store.
 *
 * @module
 */

import { ChRISPlugin } from '@fnndsc/cumin';
import { errorStack } from '@fnndsc/cumin';

/**
 * Interface for plugin import result.
 */
export interface PluginImportResult {
  success: boolean;
  plugin?: Record<string, unknown>;
  requiresAuth?: boolean;
  errorMessage?: string;
}

/**
 * Imports a plugin from a peer store URL.
 *
 * Note: ChRIS CUBE may or may not support direct import from store URLs.
 * This function attempts import and falls back to providing plugin data
 * for manual registration if direct import is not supported.
 *
 * @param storeUrl - URL of the plugin in the peer store.
 * @param pluginData - Plugin data from peer store.
 * @param computeResources - Array of compute resource names to assign plugin to.
 * @returns Promise resolving to import result.
 *
 * @example
 * ```typescript
 * const result = await plugin_importFromStore(
 *   'https://cube.chrisproject.org/api/v1/plugins/96/',
 *   pluginData,
 *   ['host', 'gpu']
 * );
 * if (result.success) {
 *   console.log('Plugin imported successfully');
 * } else if (result.requiresAuth) {
 *   // Prompt for admin credentials
 * }
 * ```
 */
export async function plugin_importFromStore(
  storeUrl: string,
  pluginData: Record<string, unknown>,
  computeResources: string[] = ['host']
): Promise<PluginImportResult> {
  // ChRIS API may support importing from store URL via admin endpoint
  // POST /chris-admin/api/v1/plugins/ with { plugin_store_url: "..." }
  // However, this is not exposed in @fnndsc/chrisapi library

  // For now, we'll use the plugin data from the peer store to register
  // This is equivalent to Docker extraction but using peer store data
  const chrisPlugin = new ChRISPlugin();

  const registeredPlugin = await chrisPlugin.plugin_registerWithAdmin(
    pluginData,
    computeResources
  );

  if (registeredPlugin) {
    return {
      success: true,
      plugin: registeredPlugin
    };
  }

  // Check if failure was due to authentication
  const errors: string[] = errorStack.allOfType_get('error');
  const authError: boolean = errors.some((e: string) =>
    e.toLowerCase().includes('admin') ||
    e.toLowerCase().includes('auth') ||
    e.toLowerCase().includes('permission')
  );

  if (authError) {
    return {
      success: false,
      requiresAuth: true,
      errorMessage: 'Admin credentials required to import plugin from store.'
    };
  }

  return {
    success: false,
    errorMessage: 'Failed to import plugin from store.'
  };
}

/**
 * Checks if plugin store URL import is supported by the current CUBE instance.
 *
 * Note: This is a placeholder for future enhancement. Currently always returns false
 * as the feature availability depends on CUBE version and configuration.
 *
 * @returns Promise resolving to true if store import is supported, false otherwise.
 */
export async function storeImport_isSupported(): Promise<boolean> {
  // TODO: Check CUBE version/capabilities to determine if store import is supported
  // For now, assume it's not directly supported and use plugin data registration
  return false;
}
