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

import { ChRISPlugin, Client } from '@fnndsc/cumin';
import { errorStack } from '@fnndsc/cumin';

/**
 * Credentials for admin authentication.
 */
export interface AdminCredentials {
  username?: string;
  password?: string;
}

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
 * Whitelist of fields to keep from peer store plugin data.
 * Removes read-only fields like id, creation_date, stars, etc.
 */
const PLUGIN_FIELD_WHITELIST = [
  'name', 'dock_image', 'public_repo', 'version',
  'title', 'category', 'description', 'documentation', 'license', 'icon',
  'execshell', 'selfpath', 'selfexec',
  'min_number_of_workers', 'max_number_of_workers',
  'min_cpu_limit', 'max_cpu_limit',
  'min_memory_limit', 'max_memory_limit',
  'min_gpu_limit', 'max_gpu_limit',
  'type', 'authors', 'parameters'
];

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
 * @param adminCreds - Optional admin credentials for registration.
 * @returns Promise resolving to import result.
 *
 * @example
 * ```typescript
 * const result = await plugin_importFromStore(
 *   'https://cube.chrisproject.org/api/v1/plugins/96/',
 *   pluginData,
 *   ['host', 'gpu'],
 *   { username: 'admin', password: 'password' }
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
  computeResources: string[] = ['host'],
  adminCreds?: AdminCredentials
): Promise<PluginImportResult> {
  const chrisPlugin = new ChRISPlugin();

  // Fetch parameters if not present but link exists
  if (!pluginData.parameters && pluginData.links) {
    const links = pluginData.links as Array<{ rel: string; href: string }>;
    const paramsLink = links.find(l => l.rel === 'parameters');
    if (paramsLink) {
      try {
        const parameters = await fetchParameters_fromUrl(paramsLink.href);
        if (parameters.length > 0) {
          pluginData.parameters = parameters;
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.log(`Warning: Failed to fetch parameters: ${msg}`);
        // Continue, maybe it has no parameters?
      }
    }
  }

  // Sanitize plugin data to remove read-only fields
  const sanitizedData: Record<string, unknown> = {};
  PLUGIN_FIELD_WHITELIST.forEach(field => {
    if (Object.prototype.hasOwnProperty.call(pluginData, field)) {
      sanitizedData[field] = pluginData[field];
    }
  });

  let adminToken: string | undefined;

  if (adminCreds && adminCreds.username && adminCreds.password) {
    // Fetch token for admin user
    const client = await chrisPlugin.client_get();
    if (client) {
      const authUrl = client.url + 'auth-token/';
      try {
        const token = await Client.getAuthToken(
          authUrl,
          adminCreds.username,
          adminCreds.password
        );
        if (token) {
          adminToken = token;
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        errorStack.stack_push('warning', `Failed to get admin token: ${msg}`);
      }
    }
  }

  const registeredPlugin = await chrisPlugin.plugin_registerWithAdmin(
    sanitizedData,
    computeResources,
    adminToken
  );

  if (registeredPlugin) {
    return {
      success: true,
      plugin: registeredPlugin
    };
  }

  // Check if failure was due to authentication
  const errors: string[] = errorStack.allOfType_get('error');
  const authError: boolean = errors.some((e: string) => {
    const lowerE = e.toLowerCase();
    return lowerE.includes('unauthorized') ||
           lowerE.includes('forbidden') ||
           lowerE.includes('permission denied') ||
           lowerE.includes('401') ||
           lowerE.includes('403') ||
           lowerE.includes('admin credentials required');
  });

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
 * Maps API parameter types to descriptor types.
 */
const TYPE_MAPPING: Record<string, string> = {
  'string': 'str',
  'integer': 'int',
  'float': 'float',
  'boolean': 'bool',
  'path': 'path',
  'unextpath': 'unextpath'
};

/**
 * Interface for Collection+JSON data item.
 */
interface CollectionData {
  name: string;
  value: unknown;
  prompt?: string;
}

/**
 * Interface for Collection+JSON item.
 */
interface CollectionItem {
  href: string;
  data?: CollectionData[];
  links?: Array<{ rel: string; href: string }>;
}

/**
 * Interface for Collection+JSON response.
 */
interface CollectionJson {
  collection: {
    version: string;
    href: string;
    items?: CollectionItem[];
    links?: Array<{ rel: string; href: string }>;
    error?: { message: string };
  };
}

/**
 * Fetches parameters from a peer store URL and transforms them for registration.
 *
 * @param url - The parameters URL (Collection+JSON).
 * @returns Promise resolving to array of parameter objects.
 */
async function fetchParameters_fromUrl(url: string): Promise<Array<Record<string, unknown>>> {
  const response: Response = await fetch(url, {
    headers: { 'Accept': 'application/vnd.collection+json' }
  });

  if (!response.ok) {
    throw new Error(`HTTP error ${response.status}`);
  }

  const data: unknown = await response.json();
  const params: Array<Record<string, unknown>> = [];

  if (isCollectionJson(data) && data.collection.items) {
    data.collection.items.forEach((item: CollectionItem) => {
      const paramObj: Record<string, unknown> = {};
      if (item.data) {
        item.data.forEach((datum: CollectionData) => {
          paramObj[datum.name] = datum.value;
        });
      }
      // Clean up parameter object (remove id, plugin_id, etc if necessary)
      delete paramObj['id'];
      delete paramObj['plugin'];

      // Map type if necessary
      if (paramObj['type'] && typeof paramObj['type'] === 'string') {
        const typeStr: string = paramObj['type'] as string;
        if (TYPE_MAPPING[typeStr]) {
          paramObj['type'] = TYPE_MAPPING[typeStr];
        }
      }

      params.push(paramObj);
    });
  }

  return params;
}

/**
 * Type guard for CollectionJson.
 */
function isCollectionJson(data: unknown): data is CollectionJson {
  return (
    typeof data === 'object' &&
    data !== null &&
    'collection' in data &&
    typeof (data as any).collection === 'object'
  );
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
  return false;
}