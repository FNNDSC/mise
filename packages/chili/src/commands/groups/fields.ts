/**
 * @file Fetches available fields for group resources.
 * @module
 */
import { groupFields_get } from '@fnndsc/salsa';

/**
 * Fetches the available group field names.
 *
 * @returns The group field names, or null on failure.
 */
export async function groupFields_fetch(): Promise<string[] | null> {
  return await groupFields_get();
}
