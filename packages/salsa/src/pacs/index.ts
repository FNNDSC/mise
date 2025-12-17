/**
 * @file PACS operations.
 * @module
 */

import {
  pacsServers_list as cumin_pacsServers_list,
  pacsQueries_list as cumin_pacsQueries_list,
  pacsQueries_create as cumin_pacsQueries_create,
  pacsQuery_resultDecode as cumin_pacsQuery_resultDecode,
  PACSServer,
  PACSServerListOptions,
  PACSQueryListOptions,
  PACSQueryCreateData,
  Result,
  FilteredResourceData,
  PACSQueryRecord,
  PACSQueryDecodedResult,
} from "@fnndsc/cumin";

/**
 * List PACS servers from the connected CUBE.
 *
 * @param options - Optional identifier/limit/offset filters.
 * @returns Result containing PACS servers or Err on failure.
 */
export async function pacsServers_list(
  options: PACSServerListOptions = {}
): Promise<Result<PACSServer[]>> {
  return cumin_pacsServers_list(options);
}

/**
 * List PACS queries.
 *
 * @param options - Optional filters (pacs_id, pacs_identifier, limit, offset).
 * @returns Result containing FilteredResourceData or null.
 */
export async function pacsQueries_list(
  options: PACSQueryListOptions = {}
): Promise<Result<FilteredResourceData | null>> {
  return cumin_pacsQueries_list(options);
}

/**
 * Create a PACS query against a PACS server.
 *
 * @param pacsserver - PACS server ID or identifier.
 * @param data - Query creation data.
 * @returns Result containing PACSQueryRecord.
 */
export async function pacsQueries_create(
  pacsserver: string,
  data: PACSQueryCreateData
): Promise<Result<PACSQueryRecord>> {
  return cumin_pacsQueries_create(pacsserver, data);
}

/**
 * Decode the result payload of a PACS query.
 *
 * @param queryId - PACS query ID.
 * @returns Result containing decoded payload forms.
 */
export async function pacsQuery_resultDecode(
  queryId: number
): Promise<Result<PACSQueryDecodedResult>> {
  return cumin_pacsQuery_resultDecode(queryId);
}
