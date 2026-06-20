/**
 * @file Fetches available fields for pipeline resources.
 * @module
 */
import { pipelineFields_get } from '@fnndsc/salsa';

/**
 * Fetches the available pipeline field names.
 *
 * @returns The pipeline field names, or null on failure.
 */
export async function pipelineFields_fetch(): Promise<string[] | null> {
  return await pipelineFields_get();
}
