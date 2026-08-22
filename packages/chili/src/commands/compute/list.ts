/**
 * @file Implements compute resource listing for ChRIS CUBE.
 *
 * @module
 */
import { computeResources_getAll, ComputeResource, Result, Ok, Err } from '@fnndsc/cumin';

/**
 * Result structure for compute resource listing.
 */
export interface ComputeListResult {
  resources: ComputeResource[];
  selectedFields: string[];
}

/**
 * Fetches all available compute resources from ChRIS CUBE.
 *
 * @returns Ok with the compute listing (possibly empty), or Err when the
 *   fetch failed (reason already on the error stack).
 */
export async function computeResources_fetchList(): Promise<Result<ComputeListResult>> {
  const result = await computeResources_getAll();
  if (!result.ok) return Err();
  return Ok({
    resources: result.value,
    selectedFields: ['id', 'name', 'compute_url', 'description'],
  });
}
