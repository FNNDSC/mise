/**
 * @file Host-driven, scoped CUBE elevation.
 * @module
 */

import { elevation_do, type ElevationCredentials as SalsaElevationCredentials } from '@fnndsc/salsa';

/** Credentials for one temporary, elevated CUBE operation. */
export type ElevationCredentials = SalsaElevationCredentials;

/**
 * Runs an operation with a temporary elevated CUBE identity.
 *
 * @param credentials - Elevated credentials obtained by the host surface.
 * @param operation - Work to run while the temporary identity is active.
 * @returns The operation result.
 */
export async function elevation_run<T>(
  credentials: ElevationCredentials,
  operation: () => Promise<T>,
): Promise<T> {
  return await elevation_do(credentials, operation);
}
