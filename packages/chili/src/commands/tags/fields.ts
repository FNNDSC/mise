/**
 * @file Fetches available fields for tag resources.
 * @module
 */
import { tagFields_get } from '@fnndsc/salsa';

/**
 * Fetches the available tag field names.
 *
 * @returns The tag field names, or null on failure.
 */
export async function tagFields_fetch(): Promise<string[] | null> {
  return await tagFields_get();
}
