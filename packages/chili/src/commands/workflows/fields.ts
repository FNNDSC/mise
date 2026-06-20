/**
 * @file Fetches available fields for workflow resources.
 * @module
 */
import { workflowFields_get } from '@fnndsc/salsa';

/**
 * Fetches the available workflow field names.
 *
 * @returns The workflow field names, or null on failure.
 */
export async function workflowFields_fetch(): Promise<string[] | null> {
  return await workflowFields_get();
}
