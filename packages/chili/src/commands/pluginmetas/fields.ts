/**
 * @file Fetches available fields for plugin meta resources.
 * @module
 */
import { pluginMetaFields_get } from '@fnndsc/salsa';

/**
 * Fetches the available plugin-meta field names.
 *
 * @returns The plugin-meta field names, or null on failure.
 */
export async function pluginMetaFields_fetch(): Promise<string[] | null> {
  return await pluginMetaFields_get();
}
