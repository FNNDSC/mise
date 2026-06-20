/**
 * @file Fetches available fields for plugin instance resources.
 * @module
 */
import { pluginInstanceFields_get } from '@fnndsc/salsa';

/**
 * Fetches the available plugin-instance field names.
 *
 * @returns The plugin-instance field names, or null on failure.
 */
export async function pluginInstanceFields_fetch(): Promise<string[] | null> {
  return await pluginInstanceFields_get();
}
