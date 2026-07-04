/**
 * @file PACS helpers shared by the Q/R exemplars.
 *
 * A retrieval is three moves, each a small Result-returning function:
 * run a query and wait for its decoded result; locate a series inside
 * that result; pull one series and wait until its files register in CUBE
 * storage. All waiting goes through the harness `poll_until`.
 *
 * @module
 */

import {
  pacsQueries_create,
  pacsQuery_resultDecode,
  pacsRetrieve_create,
  Result,
  Ok,
  Err,
  PACSQueryRecord,
  PACSQueryDecodedResult,
  PACSRetrieveRecord,
  Client,
} from '@fnndsc/cumin';
import { connection_active, poll_until } from './harness.js';

/**
 * A completed PACS query: its CUBE id and the decoded result payload.
 *
 * @property queryId - The PACSQuery id (delete it during cleanup).
 * @property decoded - Decoded study/series payload.
 */
export interface QueryOutcome {
  queryId: number;
  decoded: PACSQueryDecodedResult;
}

/**
 * The identifying coordinates of one series inside a query result.
 *
 * @property seriesUID - DICOM SeriesInstanceUID.
 * @property studyUID - DICOM StudyInstanceUID.
 * @property description - SeriesDescription (display).
 * @property fileCount - NumberOfSeriesRelatedInstances from the query.
 */
export interface SeriesTarget {
  seriesUID: string;
  studyUID: string;
  description: string;
  fileCount: number;
}

/**
 * Where a pulled series lives in CUBE storage.
 *
 * @property folderPath - CUBE path (no leading slash) of the series folder.
 * @property fileCount - Number of registered files.
 */
export interface SeriesLocation {
  folderPath: string;
  fileCount: number;
}

/** Unwraps a DICOM tag that may arrive as `{ value: ... }` or a scalar. */
function tag_extract(value: unknown): string {
  if (value && typeof value === 'object' && 'value' in (value as Record<string, unknown>)) {
    return String((value as Record<string, unknown>).value ?? '');
  }
  return String(value ?? '');
}

/**
 * Creates a PACS query and polls until its result payload decodes.
 *
 * Blocking by design: a PACSQuery executes on the PACS asynchronously and
 * CUBE stores the (compressed) result when it lands, typically within a
 * few seconds.
 *
 * @param pacs - PACS server id or identifier.
 * @param query - DICOM matching keys (e.g. `{ AccessionNumber: '...' }`).
 * @param title - Query title (tag it with the run id for later cleanup).
 * @param timeoutMs - Give-up horizon.
 * @returns The query id and decoded result.
 */
export async function query_createAndWait(
  pacs: string,
  query: Record<string, string>,
  title: string,
  timeoutMs: number = 60_000,
): Promise<Result<QueryOutcome>> {
  const created: Result<PACSQueryRecord> = await pacsQueries_create(pacs, {
    title,
    query: JSON.stringify(query),
  });
  if (!created.ok) return Err();

  const queryId: number = created.value.id;
  const decoded: Result<PACSQueryDecodedResult> = await poll_until<PACSQueryDecodedResult>(
    () => decodedResult_probe(queryId),
    timeoutMs,
    2_000,
  );
  if (!decoded.ok) return Err();

  return Ok({ queryId, decoded: decoded.value });
}

/** One decode attempt: the payload, or null while the PACS is still working. */
async function decodedResult_probe(queryId: number): Promise<PACSQueryDecodedResult | null> {
  const decoded: Result<PACSQueryDecodedResult> = await pacsQuery_resultDecode(queryId);
  if (decoded.ok && decoded.value.json !== undefined) return decoded.value;
  return null;
}

/**
 * Finds the first series in a decoded query result whose description
 * satisfies the matcher.
 *
 * @param decoded - Decoded query result.
 * @param matcher - Predicate over the SeriesDescription.
 * @returns The series coordinates.
 */
export function series_findInDecode(
  decoded: PACSQueryDecodedResult,
  matcher: (description: string) => boolean,
): Result<SeriesTarget> {
  for (const study of studies_ofDecode(decoded)) {
    const found: SeriesTarget | null = series_findInStudy(study, matcher);
    if (found) return Ok(found);
  }
  return Err();
}

/** Normalizes the decode payload to a study array (key spelling varies). */
function studies_ofDecode(decoded: PACSQueryDecodedResult): Record<string, unknown>[] {
  const payload: unknown = decoded.json;
  const root: Record<string, unknown> =
    payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
  const studiesRaw: unknown = root.studies ?? root.Studies ?? root.results ?? payload;
  const studies: unknown[] = Array.isArray(studiesRaw) ? studiesRaw : [studiesRaw];
  return studies.filter((s: unknown) => s && typeof s === 'object') as Record<string, unknown>[];
}

/** Scans one study's series array for a description match. */
function series_findInStudy(
  study: Record<string, unknown>,
  matcher: (description: string) => boolean,
): SeriesTarget | null {
  const studyUID: string = tag_extract(study.StudyInstanceUID ?? study.uid);
  const seriesRaw: unknown = study.series ?? study.Series ?? study.results ?? [];
  const seriesList: Record<string, unknown>[] =
    (Array.isArray(seriesRaw) ? seriesRaw : []) as Record<string, unknown>[];

  for (const series of seriesList) {
    const description: string = tag_extract(series.SeriesDescription);
    if (!matcher(description)) continue;
    return {
      seriesUID: tag_extract(series.SeriesInstanceUID ?? series.uid),
      studyUID,
      description,
      fileCount: Number(tag_extract(series.NumberOfSeriesRelatedInstances)) || 0,
    };
  }
  return null;
}

/**
 * Looks a series up in CUBE storage (registered files, not the PACS).
 *
 * Absence is an expected state here — callers use it to decide between
 * "already staged" and "needs a pull" — hence `null`, not `Err`.
 *
 * @param seriesUID - DICOM SeriesInstanceUID.
 * @returns The series folder and file count, or null when not in CUBE.
 */
export async function series_locateInCube(seriesUID: string): Promise<SeriesLocation | null> {
  const client: Client | null = await connection_active().client_get();
  if (!client) return null;

  const seriesList = await client.getPACSSeriesList({ SeriesInstanceUID: seriesUID, limit: 1 });
  const items: unknown[] = seriesList.getItems() ?? [];
  if (items.length === 0) return null;

  const data: { folder_path?: string } | undefined =
    (items[0] as { data?: { folder_path?: string } }).data;
  if (!data?.folder_path) return null;

  const files = await client.getPACSFiles({ fname: data.folder_path, limit: 1 });
  return { folderPath: data.folder_path, fileCount: files.totalCount };
}

/**
 * Fires a retrieve for one series and waits until its files register.
 *
 * Creates a non-executing per-series PACSQuery (so the retrieve has a
 * precise target) and reports its id through `queryId_register` before
 * anything can fail — the caller's cleanup plan owns it from that moment.
 * Then a PACSRetrieve is created and CUBE polled until the series folder
 * appears with the expected file count. Transfers routinely take minutes.
 *
 * @param pacs - PACS server id or identifier.
 * @param target - The series coordinates from `series_findInDecode`.
 * @param title - Per-series query title (tag with the run id).
 * @param queryId_register - Receives the synthetic query id immediately.
 * @param timeoutMs - Give-up horizon.
 * @returns The series location once registered.
 */
export async function series_pull(
  pacs: string,
  target: SeriesTarget,
  title: string,
  queryId_register: (queryId: number) => void,
  timeoutMs: number = 600_000,
): Promise<Result<SeriesLocation>> {
  const created: Result<PACSQueryRecord> = await pacsQueries_create(pacs, {
    title,
    query: JSON.stringify({
      SeriesInstanceUID: target.seriesUID,
      StudyInstanceUID: target.studyUID,
    }),
    execute: false,
  });
  if (!created.ok) return Err();
  queryId_register(created.value.id);

  const retrieve: Result<PACSRetrieveRecord> = await pacsRetrieve_create(created.value.id);
  if (!retrieve.ok) return Err();

  return seriesArrival_await(target, timeoutMs);
}

/**
 * Waits until a series is registered in CUBE with its full file count.
 *
 * @param target - The awaited series.
 * @param timeoutMs - Give-up horizon.
 * @returns The series location.
 */
export async function seriesArrival_await(
  target: SeriesTarget,
  timeoutMs: number = 600_000,
): Promise<Result<SeriesLocation>> {
  const expected: number = Math.max(target.fileCount, 1);
  return poll_until<SeriesLocation>(async () => {
    const location: SeriesLocation | null = await series_locateInCube(target.seriesUID);
    return location && location.fileCount >= expected ? location : null;
  }, timeoutMs, 3_000);
}
