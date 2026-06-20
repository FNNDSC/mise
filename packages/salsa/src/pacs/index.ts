/**
 * @file PACS operations.
 * @module
 */

import {
  pacsServers_list as cumin_pacsServers_list,
  pacsQueries_list as cumin_pacsQueries_list,
  pacsQueries_create as cumin_pacsQueries_create,
  pacsQuery_resultDecode as cumin_pacsQuery_resultDecode,
  pacsRetrieve_create as cumin_pacsRetrieve_create,
  pacsRetrieves_list as cumin_pacsRetrieves_list,
  pacsRetrieve_delete as cumin_pacsRetrieve_delete,
  pacsRetrieve_statusForQuery as cumin_pacsRetrieve_statusForQuery,
  PACSServer,
  PACSServerListOptions,
  PACSQueryListOptions,
  PACSQueryCreateData,
  PACSRetrieveRecord,
  PACSQueryStatusReport,
  Result,
  FilteredResourceData,
  PACSQueryRecord,
  PACSQueryDecodedResult,
  ListOptions,
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

/**
 * Create a PACS retrieve to pull DICOM data from PACS to ChRIS.
 *
 * @param queryId - PACS query ID to retrieve data for.
 * @returns Result containing PACSRetrieveRecord.
 */
export async function pacsRetrieve_create(
  queryId: number
): Promise<Result<PACSRetrieveRecord>> {
  return cumin_pacsRetrieve_create(queryId);
}

/**
 * List all retrieves for a given PACS query.
 *
 * @param queryId - PACS query ID.
 * @param options - Optional list options.
 * @returns Result containing array of PACSRetrieveRecord.
 */
export async function pacsRetrieves_list(
  queryId: number,
  options?: ListOptions
): Promise<Result<PACSRetrieveRecord[]>> {
  return cumin_pacsRetrieves_list(queryId, options);
}

/**
 * Delete (cancel) a PACS retrieve.
 *
 * @param retrieveId - PACS retrieve ID to delete.
 * @returns Result containing void.
 */
export async function pacsRetrieve_delete(
  retrieveId: number
): Promise<Result<void>> {
  return cumin_pacsRetrieve_delete(retrieveId);
}

/**
 * Generate a complete status report for a PACS query retrieve.
 * Combines query decode results with actual file counts to show progress.
 *
 * @param queryId - PACS query ID.
 * @returns Result containing PACSQueryStatusReport with series-level status.
 */
export async function pacsRetrieve_statusForQuery(
  queryId: number
): Promise<Result<PACSQueryStatusReport>> {
  return cumin_pacsRetrieve_statusForQuery(queryId);
}
