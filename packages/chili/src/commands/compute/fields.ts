/**
 * @file Fetches available fields for compute resources.
 * @module
 */
import { computeResourceFields_get } from '@fnndsc/salsa';

/**
 * Fetches the available compute resource field names.
 *
 * @returns The compute resource field names, or null on failure.
 */
export async function computeFields_fetch(): Promise<string[] | null> {
  return await computeResourceFields_get();
}
