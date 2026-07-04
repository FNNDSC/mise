/**
 * @file PACS helpers shared by the Q/R exemplars.
 *
 * Wraps the cumin PACS API into the three moves every retrieval needs:
 * run a query and wait for its decoded result, locate a series inside that
 * result, and pull one series while polling until its files are registered
 * in CUBE storage.
 *
 * @module
 */

import {
  pacsQueries_create,
  pacsQuery_resultDecode,
  pacsRetrieve_create,
  Result,
  PACSQueryRecord,
  PACSQueryDecodedResult,
  PACSRetrieveRecord,
  Client,
} from '@fnndsc/cumin';
import { sleep, connection_active } from './harness.js';

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
 * @param pacs - PACS server id or identifier.
 * @param query - DICOM matching keys (e.g. `{ AccessionNumber: '...' }`).
 * @param title - Query title (tag it with the run id for later cleanup).
 * @param timeoutMs - Give-up horizon.
 * @returns The query id and decoded result, or null on failure/timeout.
 */
export async function query_createAndWait(
  pacs: string,
  query: Record<string, string>,
  title: string,
  timeoutMs: number = 60_000,
): Promise<{ queryId: number; decoded: PACSQueryDecodedResult } | null> {
  const created: Result<PACSQueryRecord> = await pacsQueries_create(pacs, {
    title,
    query: JSON.stringify(query),
  });
  if (!created.ok) return null;

  const queryId: number = created.value.id;
  const deadline: number = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const decoded: Result<PACSQueryDecodedResult> = await pacsQuery_resultDecode(queryId);
    if (decoded.ok && decoded.value.json !== undefined) {
      return { queryId, decoded: decoded.value };
    }
    await sleep(2_000);
  }
  return null;
}

/**
 * Finds the first series in a decoded query result whose description
 * satisfies the matcher.
 *
 * @param decoded - Decoded query result.
 * @param matcher - Predicate over the SeriesDescription.
 * @returns The series coordinates, or null when nothing matches.
 */
export function series_findInDecode(
  decoded: PACSQueryDecodedResult,
  matcher: (description: string) => boolean,
): SeriesTarget | null {
  const payload: unknown = decoded.json;
  const root: Record<string, unknown> =
    payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
  const studiesRaw: unknown = root.studies ?? root.Studies ?? root.results ?? payload;
  const studies: Record<string, unknown>[] =
    (Array.isArray(studiesRaw) ? studiesRaw : [studiesRaw]) as Record<string, unknown>[];

  for (const study of studies) {
    if (!study || typeof study !== 'object') continue;
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
  }
  return null;
}

/**
 * Looks a series up in CUBE storage (registered files, not PACS).
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
 * Fires a retrieve for one series and polls until its files are registered.
 *
 * Creates a non-executing per-series PACSQuery (so the retrieve has a
 * precise target), then a PACSRetrieve, then polls CUBE until the series
 * folder appears with at least one file.
 *
 * The synthetic query id is reported even when the transfer times out, so
 * callers can always clean it up.
 *
 * @param pacs - PACS server id or identifier.
 * @param target - The series coordinates from `series_findInDecode`.
 * @param title - Per-series query title (tag with the run id).
 * @param timeoutMs - Give-up horizon (registration can take minutes).
 * @returns The synthetic query id and the location (null on timeout), or
 *   null when the query itself could not be created.
 */
export async function series_pull(
  pacs: string,
  target: SeriesTarget,
  title: string,
  timeoutMs: number = 600_000,
): Promise<{ queryId: number; location: SeriesLocation | null } | null> {
  const created: Result<PACSQueryRecord> = await pacsQueries_create(pacs, {
    title,
    query: JSON.stringify({
      SeriesInstanceUID: target.seriesUID,
      StudyInstanceUID: target.studyUID,
    }),
    execute: false,
  });
  if (!created.ok) return null;
  const queryId: number = created.value.id;

  const retrieve: Result<PACSRetrieveRecord> = await pacsRetrieve_create(queryId);
  if (!retrieve.ok) return { queryId, location: null };

  const deadline: number = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const location: SeriesLocation | null = await series_locateInCube(target.seriesUID);
    if (location && location.fileCount >= Math.max(target.fileCount, 1)) {
      return { queryId, location };
    }
    await sleep(3_000);
  }
  return { queryId, location: null };
}
