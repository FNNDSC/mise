/**
 * @file ChRIS PACS Management
 *
 * Provides helpers to list PACS servers that the current CUBE knows about.
 *
 * @module
 */

import { errorStack } from "../error/errorStack.js";
import { Result, Ok, Err } from "../utils/result.js";
import { retry_untilValue } from "../utils/retry.js";
import { ChRISResourceGroup } from "../resources/chrisResourceGroup.js";
import { FilteredResourceData, ListOptions } from "../resources/chrisResources.js";
import {
  listData_get,
  itemData_get,
  items_get,
  client_authGet,
  pacsRetrieve_deleteByUrl,
  type Client,
} from "../chrisapi/adapter.js";
import { chrisConnection } from "../connect/chrisConnection.js";
import zlib from "zlib";

/** Raw DICOM tag wrapper carrying a `value` field. */
interface DicomTagValue {
  value?: unknown;
}


/**
 * Minimal shape of a PACS server as returned by the ChRIS API.
 */
export interface PACSServer {
  id: number;
  identifier?: string;
  name?: string;
  description?: string;
  [key: string]: unknown;
}

/**
 * Options for listing PACS servers (passed directly to the API).
 */
export interface PACSServerListOptions {
  identifier?: string;
  limit?: number;
  offset?: number;
  [key: string]: unknown;
}

/**
 * Group handler for PACS servers.
 */
export class ChRISPACSGroup extends ChRISResourceGroup {
  constructor() {
    super("PACS", "getPACSList");
  }
}

/**
 * PACSQuery data structure from ChRIS API.
 */
interface PACSQueryData {
  result?: string;
  [key: string]: unknown;
}

/**
 * PACSQuery object from ChRIS API.
 */
interface PACSQuery {
  data: PACSQueryData;
}

/**
 * PACSRetrieve item data from collection.
 */
interface PACSRetrieveItemData {
  id: number;
  pacs_query_id: number;
  status: string;
  creation_date: string;
  [key: string]: unknown;
}

/**
 * PACSRetrieve item from collection.
 */
interface PACSRetrieveItem {
  data: PACSRetrieveItemData;
  [key: string]: unknown;
}

/**
 * Minimal shape of a PACS query record.
 */
export interface PACSQueryRecord {
  id: number;
  title?: string;
  status?: string;
  pacs_id?: number;
  result?: unknown;
  [key: string]: unknown;
}

/**
 * Options for listing PACS queries.
 */
export interface PACSQueryListOptions extends ListOptions {
  pacs_id?: number;
  pacs_identifier?: string;
}

/**
 * Group handler for PACS queries.
 */
export class ChRISPACSQueryGroup extends ChRISResourceGroup {
  constructor() {
    super("PACSQueries", "getPACSQueries");
  }
}

/**
 * Resolve a PACS server identifier or ID to an ID and identifier.
 *
 * @param pacsserver - Numeric ID or identifier string.
 * @returns Result containing { id, identifier? } or Err on failure/ambiguity.
 */
export async function pacsServer_resolve(
  pacsserver: string
): Promise<Result<{ id: number; identifier?: string }>> {
  const client: Client | null = await chrisConnection.client_get();
  if (!client) {
    errorStack.stack_push("error", "Not connected to ChRIS. Please log in.");
    return Err();
  }

  if (/^\d+$/.test(pacsserver)) {
    const id: number = Number(pacsserver);
    return Ok({ id, identifier: undefined });
  }

  try {
    const list: Awaited<ReturnType<typeof client.getPACSList>> = await client.getPACSList({
      identifier: pacsserver,
      limit: 5,
    });
    const matches: PACSServer[] = listData_get<PACSServer>(list);
    if (matches.length === 1) {
      const match: PACSServer = matches[0];
      return Ok({ id: match.id, identifier: match.identifier });
    }
    if (matches.length === 0) {
      errorStack.stack_push("error", `No PACS server found for "${pacsserver}".`);
      return Err();
    }
    errorStack.stack_push(
      "error",
      `Multiple PACS servers matched "${pacsserver}". Please specify an ID or unique identifier.`
    );
    return Err();
  } catch (error: unknown) {
    const errorMessage: string =
      error instanceof Error ? error.message : String(error);
    errorStack.stack_push(
      "error",
      `Failed to resolve PACS server "${pacsserver}": ${errorMessage}`
    );
    return Err();
  }
}

/**
 * Fetch all PACS servers visible to the current ChRIS connection.
 *
 * @param options - Optional search/pagination parameters (identifier, limit, offset).
 * @returns Result containing an array of PACS server records, or Err on failure.
 */
export async function pacsServers_list(
  options: PACSServerListOptions = {}
): Promise<Result<PACSServer[]>> {
  try {
    const group: ChRISPACSGroup = new ChRISPACSGroup();
    const clientAvailable: unknown = await group.client_get();
    if (!clientAvailable) {
      errorStack.stack_push("error", "Not connected to ChRIS. Please log in.");
      return Err();
    }

    const listOptions: ListOptions = options as ListOptions;
    const filtered: FilteredResourceData | null = await group.asset.resources_getAll(
      listOptions
    );

    if (!filtered || !filtered.tableData) {
      return Ok([]);
    }

    const servers: PACSServer[] = filtered.tableData.map(
      (row: Record<string, unknown>): PACSServer => ({
        id: typeof row.id === "number" ? row.id : Number(row.id),
        identifier: (row.identifier as string) || (row.name as string) || undefined,
        name: (row.name as string) || undefined,
        description: (row.description as string) || undefined,
      })
    );
    return Ok(servers);
  } catch (error: unknown) {
    const errorMessage: string = error instanceof Error ? error.message : String(error);
    errorStack.stack_push("error", `Failed to list PACS servers: ${errorMessage}`);
    return Err();
  }
}

/**
 * List PACS queries with optional filtering.
 *
 * @param options - Search/pagination options (pacs_id, pacs_identifier, limit, offset, etc.).
 * @returns Result containing filtered resource data or Err.
 */
export async function pacsQueries_list(
  options: PACSQueryListOptions = {}
): Promise<Result<FilteredResourceData | null>> {
  try {
    const group: ChRISPACSQueryGroup = new ChRISPACSQueryGroup();
    const filtered: FilteredResourceData | null =
      await group.asset.resources_listAndFilterByOptions(options);
    return Ok(filtered);
  } catch (error: unknown) {
    const errorMessage: string = error instanceof Error ? error.message : String(error);
    errorStack.stack_push("error", `Failed to list PACS queries: ${errorMessage}`);
    return Err();
  }
}

/**
 * Data needed to create a PACS query.
 */
export interface PACSQueryCreateData {
  title: string;
  query: string;
  description?: string;
  execute?: boolean;
}

/**
 * Create a PACS query against a specific PACS server.
 *
 * @param pacsserver - PACS server ID or identifier.
 * @param data - Query creation data (title, query JSON string, optional description).
 * @returns Result containing a PACSQueryRecord or Err.
 */
export async function pacsQueries_create(
  pacsserver: string,
  data: PACSQueryCreateData
): Promise<Result<PACSQueryRecord>> {
  const resolved: Result<{ id: number; identifier?: string }> = await pacsServer_resolve(pacsserver);
  if (!resolved.ok) {
    return Err();
  }
  const { id } = resolved.value;

  try {
    const client: Client | null = await chrisConnection.client_get();
    if (!client) {
      errorStack.stack_push("error", "Not connected to ChRIS. Please log in.");
      return Err();
    }
    const query: Awaited<ReturnType<typeof client.createPACSQuery>> = await client.createPACSQuery(id, data);
    const queryData: PACSQueryRecord | null = itemData_get<PACSQueryRecord>(query);
    const record: PACSQueryRecord = {
      id: queryData?.id as number,
      title: queryData?.title as string,
      status: queryData?.status as string,
      pacs_id: queryData?.pacs_id as number,
      result: queryData?.result,
    };
    return Ok(record);
  } catch (error: unknown) {
    const errorMessage: string = error instanceof Error ? error.message : String(error);
    errorStack.stack_push("error", `Failed to create PACS query: ${errorMessage}`);
    return Err();
  }
}

/**
 * Decoded PACS query result payload.
 */
export interface PACSQueryDecodedResult {
  raw: string;
  base64Decoded?: Buffer;
  zlibDecoded?: Buffer;
  gzipDecoded?: Buffer;
  text?: string;
  json?: unknown;
}

/**
 * Attempt to decode a PACS query result payload.
 *
 * @param queryId - PACS query ID.
 * @returns Result containing decoded forms (raw, decoded buffers, text, optional JSON) or Err on failure.
 */
export async function pacsQuery_resultDecode(
  queryId: number
): Promise<Result<PACSQueryDecodedResult>> {
  try {
    const client: Client | null = await chrisConnection.client_get();
    if (!client) {
      errorStack.stack_push("error", "Not connected to ChRIS. Please log in.");
      return Err();
    }

    const query: Awaited<ReturnType<typeof client.getPACSQuery>> = await client.getPACSQuery(queryId);
    if (!query || !query.data) {
      errorStack.stack_push("error", `PACS query ${queryId} not found.`);
      return Err();
    }

    const queryData: PACSQueryData | null = itemData_get<PACSQueryData>(query);
    const raw: string | undefined = queryData?.result;
    if (!raw || typeof raw !== "string") {
      errorStack.stack_push("error", `PACS query ${queryId} has no result payload.`);
      return Err();
    }

    const decoded: PACSQueryDecodedResult = { raw };

    let b64: Buffer | null = null;
    try {
      b64 = Buffer.from(raw, "base64");
      decoded.base64Decoded = b64;
    } catch (e: unknown) {
      errorStack.stack_push("warning", `Base64 decode failed for query ${queryId}: ${e}`);
    }

    if (b64) {
      try {
        decoded.zlibDecoded = Buffer.from(zlib.inflateSync(b64));
      } catch (e: unknown) {
        // Ignore; maybe not zlib
      }
      try {
        decoded.gzipDecoded = Buffer.from(zlib.gunzipSync(b64));
      } catch (e: unknown) {
        // Ignore; maybe not gzip
      }

      const textCandidate: Buffer | undefined =
        decoded.zlibDecoded || decoded.gzipDecoded || decoded.base64Decoded;
      if (textCandidate) {
        decoded.text = textCandidate.toString("utf-8");
        try {
          decoded.json = JSON.parse(decoded.text);
        } catch {
          // Not JSON; leave as text
        }
      }
    }

    return Ok(decoded);
  } catch (error: unknown) {
    const errorMessage: string = error instanceof Error ? error.message : String(error);
    errorStack.stack_push(
      "error",
      `Failed to decode PACS query result for ${queryId}: ${errorMessage}`
    );
    return Err();
  }
}

/**
 * Fetch a single PACS query record by ID.
 *
 * @param queryId - PACS query ID.
 * @returns Result containing a PACSQueryRecord (with current status/result) or Err.
 */
export async function pacsQuery_get(queryId: number): Promise<Result<PACSQueryRecord>> {
  try {
    const client: Client | null = await chrisConnection.client_get();
    if (!client) {
      errorStack.stack_push("error", "Not connected to ChRIS. Please log in.");
      return Err();
    }
    const query: Awaited<ReturnType<typeof client.getPACSQuery>> = await client.getPACSQuery(queryId);
    if (!query || !query.data) {
      errorStack.stack_push("error", `PACS query ${queryId} not found.`);
      return Err();
    }
    const qData: PACSQueryRecord | null = itemData_get<PACSQueryRecord>(query);
    return Ok({
      id: queryId,
      title: qData?.title as string | undefined,
      status: qData?.status as string | undefined,
      pacs_id: qData?.pacs_id as number | undefined,
      result: qData?.result,
    });
  } catch (error: unknown) {
    const msg: string = error instanceof Error ? error.message : String(error);
    errorStack.stack_push("error", `Failed to get PACS query ${queryId}: ${msg}`);
    return Err();
  }
}

/**
 * Minimal shape of a PACS retrieve record.
 */
export interface PACSRetrieveRecord {
  id: number;
  pacs_query_id?: number;
  status?: string;
  creation_date?: string;
  [key: string]: unknown;
}

/**
 * Group handler for PACS retrieves.
 */
export class ChRISPACSRetrieveGroup extends ChRISResourceGroup {
  constructor() {
    super("PACSRetrieves", "getPACSRetrieves");
  }
}

/**
 * Create a PACS retrieve for a given query.
 * This triggers the external service to pull DICOM data from PACS to ChRIS.
 *
 * @param queryId - PACS query ID to retrieve data for.
 * @returns Result containing a PACSRetrieveRecord or Err.
 */
export async function pacsRetrieve_create(
  queryId: number
): Promise<Result<PACSRetrieveRecord>> {
  try {
    const client: Client | null = await chrisConnection.client_get();
    if (!client) {
      errorStack.stack_push("error", "Not connected to ChRIS. Please log in.");
      return Err();
    }

    const retrieve: Awaited<ReturnType<typeof client.createPACSRetrieve>> = await client.createPACSRetrieve(queryId);
    const retrieveData: PACSRetrieveItemData | null = itemData_get<PACSRetrieveItemData>(retrieve);
    const record: PACSRetrieveRecord = {
      id: retrieveData?.id as number,
      pacs_query_id: queryId,
      status: retrieveData?.status as string,
      creation_date: retrieveData?.creation_date as string,
    };
    return Ok(record);
  } catch (error: unknown) {
    const errorMessage: string = error instanceof Error ? error.message : String(error);
    errorStack.stack_push("error", `Failed to create PACS retrieve for query ${queryId}: ${errorMessage}`);
    return Err();
  }
}

/**
 * List all retrieves for a given PACS query.
 *
 * @param queryId - PACS query ID.
 * @param options - Optional list options.
 * @returns Result containing an array of PACSRetrieveRecord or Err.
 */
export async function pacsRetrieves_list(
  queryId: number,
  options: ListOptions = {}
): Promise<Result<PACSRetrieveRecord[]>> {
  try {
    const client: Client | null = await chrisConnection.client_get();
    if (!client) {
      errorStack.stack_push("error", "Not connected to ChRIS. Please log in.");
      return Err();
    }

    const query: Awaited<ReturnType<typeof client.getPACSQuery>> = await client.getPACSQuery(queryId);
    if (!query || !query.data) {
      errorStack.stack_push("error", `PACS query ${queryId} not found.`);
      return Err();
    }

    const retrieveList: Awaited<ReturnType<NonNullable<typeof query>["getRetrieves"]>> = await query.getRetrieves(options);
    const items: PACSRetrieveItem[] = items_get<PACSRetrieveItem>(retrieveList);

    const records: PACSRetrieveRecord[] = items.map((item: PACSRetrieveItem): PACSRetrieveRecord => ({
      id: item.data.id,
      pacs_query_id: item.data.pacs_query_id,
      status: item.data.status,
      creation_date: item.data.creation_date,
    }));

    return Ok(records);
  } catch (error: unknown) {
    const errorMessage: string = error instanceof Error ? error.message : String(error);
    errorStack.stack_push("error", `Failed to list PACS retrieves for query ${queryId}: ${errorMessage}`);
    return Err();
  }
}

/**
 * Delete (cancel) a PACS retrieve.
 *
 * @param retrieveId - PACS retrieve ID to delete.
 * @returns Result containing void or Err.
 */
export async function pacsRetrieve_delete(
  retrieveId: number
): Promise<Result<void>> {
  try {
    const client: Client | null = await chrisConnection.client_get();
    if (!client) {
      errorStack.stack_push("error", "Not connected to ChRIS. Please log in.");
      return Err();
    }

    // The API typically has endpoints like /api/v1/pacsfiles/retrieves/{id}/
    // We need to construct the URL and make a DELETE request
    // For now, use a simple approach: we know retrieves exist, so direct delete via constructed object

    // Note: This is a simplified implementation
    // In a production system, you'd want to verify the retrieve exists first
    const baseUrl: string = client_authGet(client)?.cubeUrl || "";
    if (!baseUrl) {
      errorStack.stack_push("error", "Could not determine CUBE URL for delete operation.");
      return Err();
    }

    const retrieveUrl: string = `${baseUrl}api/v1/pacsfiles/retrieves/${retrieveId}/`;
    await pacsRetrieve_deleteByUrl(retrieveUrl, client_authGet(client));
    return Ok(undefined);
  } catch (error: unknown) {
    const errorMessage: string = error instanceof Error ? error.message : String(error);
    errorStack.stack_push("error", `Failed to delete PACS retrieve ${retrieveId}: ${errorMessage}`);
    return Err();
  }
}

/**
 * Status of a single series in the retrieve process.
 */
export interface SeriesRetrieveStatus {
  seriesInfo: Record<string, unknown>;
  seriesInstanceUID: string;
  seriesDescription?: string;
  expectedFiles: number;
  actualFiles: number;
  status: "pending" | "pulling" | "pulled" | "error";
  /** CUBE storage folder the series landed in, or null when nothing arrived. */
  folderPath: string | null;
}

/**
 * Study with series status information.
 */
export interface StudyRetrieveStatus {
  studyInfo: Record<string, unknown>;
  studyInstanceUID?: string;
  studyDescription?: string;
  series: SeriesRetrieveStatus[];
}

/**
 * Complete retrieve status report for a query.
 */
export interface PACSQueryStatusReport {
  queryId: number;
  retrieveStatus?: string;
  retrieveId?: number;
  studies: StudyRetrieveStatus[];
}

/** A series' presence in CUBE storage: registered file count and folder. */
export interface SeriesStorageState {
  /** Number of PACSFiles registered for the series. */
  fileCount: number;
  /** Display folder path (leading slash), or null when nothing arrived. */
  folderPath: string | null;
}

/**
 * Resolves a series' CUBE storage state: its registered file count and the
 * folder it landed in.
 *
 * With `retry` options, re-probes across the registration lag between a PACS
 * push completing and the PACSSeries record becoming queryable, returning the
 * first state that carries a folder. This is the one series-storage resolver;
 * the per-package copies it replaces are gone.
 *
 * @param seriesInstanceUID - The series instance UID to inspect.
 * @param retry - Optional bounded re-probing: total attempts and the delay
 *   between them.
 * @returns Result containing the storage state; failures resolve to an empty
 *   state (count 0, no folder) rather than failing the whole report.
 */
export async function seriesStorage_resolve(
  seriesInstanceUID: string,
  retry?: { attempts: number; delayMs: number }
): Promise<Result<SeriesStorageState>> {
  if (retry && retry.attempts > 1) {
    const landed: SeriesStorageState | null = await retry_untilValue<SeriesStorageState>(
      retry.attempts,
      [retry.delayMs],
      async (): Promise<SeriesStorageState | null> => {
        const probe: Result<SeriesStorageState> = await seriesStorage_resolve(seriesInstanceUID);
        return probe.ok && probe.value.folderPath !== null ? probe.value : null;
      },
    );
    return Ok(landed ?? { fileCount: 0, folderPath: null });
  }
  const empty: SeriesStorageState = { fileCount: 0, folderPath: null };
  try {
    const client: Client | null = await chrisConnection.client_get();
    if (!client) {
      return Ok(empty);
    }

    // First get the PACSSeries record to find the folder_path
    const seriesList: Awaited<ReturnType<typeof client.getPACSSeriesList>> = await client.getPACSSeriesList({
      SeriesInstanceUID: seriesInstanceUID,
      limit: 1,
    });

    const seriesItems: ReturnType<typeof seriesList.getItems> = seriesList.getItems();
    if (!seriesItems || seriesItems.length === 0) {
      return Ok(empty);
    }

    const seriesData: { folder_path?: string } | null =
      itemData_get<{ folder_path?: string }>(seriesItems[0]);
    const rawFolder: string | undefined = seriesData?.folder_path;
    if (!rawFolder) {
      return Ok(empty);
    }
    const folderPath: string = rawFolder.startsWith("/") ? rawFolder : `/${rawFolder}`;

    // Count PACSFiles in that folder (API stores fname without leading slash)
    const filesList: Awaited<ReturnType<typeof client.getPACSFiles>> = await client.getPACSFiles({
      fname: rawFolder.startsWith("/") ? rawFolder.slice(1) : rawFolder,
      limit: 1000,
    });

    const items: ReturnType<typeof filesList.getItems> = filesList.getItems();
    const fileCount: number = filesList.totalCount || (items ? items.length : 0);
    return Ok({ fileCount, folderPath });
  } catch (error: unknown) {
    errorStack.stack_push("warning", `Failed to resolve storage for series ${seriesInstanceUID}: ${error}`);
    return Ok(empty); // Return the empty state rather than failing the whole operation
  }
}

/**
 * Extract value from a DICOM tag object or return as-is.
 *
 * @param val - Potentially a tag object with {label, value} or a primitive.
 * @returns The extracted value.
 */
function tag_extractValue(val: unknown): unknown {
  if (val && typeof val === "object" && "value" in (val as Record<string, unknown>)) {
    const tagObj: DicomTagValue = val as DicomTagValue;
    return tagObj.value;
  }
  return val;
}

/**
 * Determine series status based on file counts.
 *
 * @param expected - Expected number of files.
 * @param actual - Actual number of files pulled.
 * @returns Status string.
 */
function series_determineStatus(
  expected: number,
  actual: number
): "pending" | "pulling" | "pulled" | "error" {
  if (actual === 0) {
    return "pending";
  }
  if (actual < expected) {
    return "pulling";
  }
  if (actual === expected) {
    return "pulled";
  }
  return "error"; // More files than expected
}

async function retrieve_latestFromQuery(
  queryId: number
): Promise<{ retrieveStatus?: string; retrieveId?: number }> {
  const retrievesResult: Result<PACSRetrieveRecord[]> = await pacsRetrieves_list(queryId);
  if (!retrievesResult.ok || retrievesResult.value.length === 0) return {};
  const latest: PACSRetrieveRecord = retrievesResult.value[retrievesResult.value.length - 1];
  return { retrieveStatus: latest.status, retrieveId: latest.id };
}

async function studySeries_buildStatus(
  study: Record<string, unknown>
): Promise<StudyRetrieveStatus> {
  const studyStatus: StudyRetrieveStatus = {
    studyInfo: study,
    studyInstanceUID: tag_extractValue(study.StudyInstanceUID) as string | undefined,
    studyDescription: tag_extractValue(study.StudyDescription) as string | undefined,
    series: [],
  };

  const seriesArray: unknown[] =
    Array.isArray(study.series) ? study.series :
    Array.isArray(study.Series) ? study.Series :
    Array.isArray(study.results) ? study.results :
    [];

  for (const seriesObj of seriesArray) {
    if (!seriesObj || typeof seriesObj !== "object") continue;

    const series: Record<string, unknown> = seriesObj as Record<string, unknown>;
    const seriesUID: string | undefined = tag_extractValue(series.SeriesInstanceUID) as string | undefined;
    if (!seriesUID) continue;

    const expectedFiles: number = Number(tag_extractValue(series.NumberOfSeriesRelatedInstances)) || 0;
    const storageResult: Result<SeriesStorageState> = await seriesStorage_resolve(seriesUID);
    const storage: SeriesStorageState = storageResult.ok ? storageResult.value : { fileCount: 0, folderPath: null };
    const status: "pending" | "pulling" | "pulled" | "error" = series_determineStatus(expectedFiles, storage.fileCount);

    studyStatus.series.push({
      seriesInfo: series,
      seriesInstanceUID: seriesUID,
      seriesDescription: tag_extractValue(series.SeriesDescription) as string | undefined,
      expectedFiles,
      actualFiles: storage.fileCount,
      status,
      folderPath: storage.folderPath,
    });
  }

  return studyStatus;
}

/**
 * Reports the retrieve status for a PACS query.
 *
 * @param queryId - ID of the PACS query to inspect.
 * @returns Result wrapping the status report, or Err on failure.
 */
export async function pacsRetrieve_statusForQuery(
  queryId: number
): Promise<Result<PACSQueryStatusReport>> {
  try {
    const decodedResult: Result<PACSQueryDecodedResult> = await pacsQuery_resultDecode(queryId);
    if (!decodedResult.ok) return Err();

    const decoded: PACSQueryDecodedResult = decodedResult.value;
    if (!decoded.json) {
      errorStack.stack_push("error", `Query ${queryId} has no decoded JSON result.`);
      return Err();
    }

    const { retrieveStatus, retrieveId } = await retrieve_latestFromQuery(queryId);
    const payloadArray: unknown[] = Array.isArray(decoded.json) ? decoded.json : [decoded.json];
    const studies: StudyRetrieveStatus[] = [];

    for (const obj of payloadArray) {
      if (!obj || typeof obj !== "object") continue;
      studies.push(await studySeries_buildStatus(obj as Record<string, unknown>));
    }

    return Ok({ queryId, retrieveStatus, retrieveId, studies });
  } catch (error: unknown) {
    const errorMessage: string = error instanceof Error ? error.message : String(error);
    errorStack.stack_push("error", `Failed to generate status report for query ${queryId}: ${errorMessage}`);
    return Err();
  }
}
