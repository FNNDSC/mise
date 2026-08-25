/**
 * @file Shared PACS utilities for VFS path traversal and CUBE FS resolution.
 *
 * Used by `pull` and `cubepath` builtins.
 *
 * @module
 */

import {
  errorStack,
  pacsQuery_resultDecode,
  pacsServers_list,
  chrisContext,
  Context,
  seriesStorage_resolve,
  tag_extractValue,
  studies_extractFromDecoded,
  series_extractFromStudy,
} from '@fnndsc/cumin';
import { queryId_extractFromFolder, queryLabel_extractFromFolder, folderUID_get } from '@fnndsc/salsa';

export { folderUID_get };

/** Compatibility alias for cumin's tag_extractValue, the one tag unwrapper. */
export const pacs_tagValueExtract: (val: unknown) => string = tag_extractValue;

/**
 * Minimal series info collected from a decoded PACS query result.
 */
export interface PACSSeriesInfo {
  label: string;
  seriesLabel: string;
  studyLabel: string;
  queryLabel: string;
  seriesUID: string;
  studyUID: string;
  pacsName: string;
  expectedFiles: number;
}

/**
 * CUBE FS resolution result for a single series.
 */
export interface SeriesCubePath {
  folderPath: string;
  fileCount: number;
}

/**
 * Resolves a PACS server identifier string from a numeric ID or context.
 *
 * @param override - Optional numeric-string PACS server ID from flags.
 * @returns Resolved identifier string, or null if unavailable.
 */
export async function pacsServer_resolve(override?: string | null): Promise<string | null> {
  const raw: string | null = override ?? await chrisContext.current_get(Context.PACSserver);
  if (!raw) {
    const serversResult = await pacsServers_list();
    if (serversResult.ok && serversResult.value.length > 0) {
      return String(serversResult.value[0].id);
    }
    return null;
  }

  if (/^\d+$/.test(raw)) {
    const allServers = await pacsServers_list();
    if (allServers.ok) {
      const srv = allServers.value.find(s => s.id === Number(raw));
      if (srv?.identifier) return srv.identifier;
    }
  }

  return raw;
}

/**
 * Walks a `/net/pacs/queries/...` VFS path and collects series info.
 *
 * Supports query-level, study-level, and series-level paths.
 *
 * @param pathStr - Absolute VFS path to a query, study, or series directory.
 * @param fallbackPacsName - PACS identifier used when RetrieveAETitle is absent.
 * @param callerTag - Command name for error messages (e.g. 'pull', 'cubepath').
 * @returns Array of PACSSeriesInfo for all matched series.
 */
export async function pacs_seriesCollect(
  pathStr: string,
  fallbackPacsName: string,
  callerTag: string = 'pacs',
): Promise<PACSSeriesInfo[]> {
  const effective: string = pathStr.startsWith('/') ? pathStr : '/' + pathStr;
  const parts: string[] = effective.split('/').filter(Boolean);

  if (
    parts.length < 4 ||
    parts[0] !== 'net' ||
    parts[1] !== 'pacs' ||
    parts[2] !== 'queries'
  ) {
    errorStack.stack_push('error', `${callerTag}: Not a PACS query path: ${pathStr}`);
    return [];
  }

  const queryFolder: string = parts[3];
  const queryId: number = queryId_extractFromFolder(queryFolder);
  if (Number.isNaN(queryId)) {
    errorStack.stack_push('error', `${callerTag}: Cannot parse query ID from: ${queryFolder}`);
    return [];
  }
  const queryLabel: string = queryLabel_extractFromFolder(queryFolder);

  const decodedResult = await pacsQuery_resultDecode(queryId);
  if (!decodedResult.ok || !decodedResult.value.json) {
    errorStack.stack_push('error', `${callerTag}: Failed to decode results for query ${queryId}`);
    return [];
  }

  const studies: Record<string, unknown>[] = studies_extractFromDecoded(decodedResult.value.json);

  const targetStudyUID: string | null = parts.length >= 5
    ? folderUID_get(parts[4], 'Study')
    : null;
  const targetSeriesUID: string | null = parts.length >= 6
    ? folderUID_get(parts[5], 'Series')
    : null;

  const infos: PACSSeriesInfo[] = [];

  for (const studyObj of studies) {
    if (!studyObj || typeof studyObj !== 'object') continue;

    const studyUID: string = tag_extractValue(studyObj.StudyInstanceUID ?? studyObj.uid);
    if (targetStudyUID && studyUID !== targetStudyUID) continue;

    const studyLabel: string = tag_extractValue(studyObj.StudyDescription ?? 'Study').replace(/[\s/]/g, '_');
    const retrieveAETitle: string = tag_extractValue(studyObj.RetrieveAETitle ?? '');
    const pacsName: string = retrieveAETitle || fallbackPacsName;

    const seriesArr: Record<string, unknown>[] = series_extractFromStudy(studyObj);

    for (const seriesObj of seriesArr) {
      if (!seriesObj || typeof seriesObj !== 'object') continue;

      const seriesUID: string = tag_extractValue(seriesObj.SeriesInstanceUID ?? seriesObj.uid);
      if (!seriesUID) continue;
      if (targetSeriesUID && seriesUID !== targetSeriesUID) continue;

      const seriesLabel: string = tag_extractValue(seriesObj.SeriesDescription ?? 'Series').replace(/[\s/]/g, '_');
      const expectedFiles: number = Number(tag_extractValue(seriesObj.NumberOfSeriesRelatedInstances ?? '0')) || 0;

      infos.push({
        label: `${queryLabel}|${studyLabel}|${seriesLabel}`,
        seriesLabel,
        studyLabel,
        queryLabel,
        seriesUID,
        studyUID,
        pacsName,
        expectedFiles,
      });
    }
  }

  return infos;
}

/**
 * Resolves the CUBE FS folder path and actual file count for a series.
 *
 * Thin compatibility wrapper over cumin's `seriesStorage_resolve`, the one
 * series-storage resolver; the client parameter is retained for signature
 * stability but unused, since the resolver holds its own connection.
 *
 * @param seriesUID - DICOM SeriesInstanceUID.
 * @param maxAttempts - Number of attempts before giving up (default 4).
 * @param retryDelayMs - Delay between attempts in ms (default 2000).
 * @returns SeriesCubePath on success, or null if not found.
 */
export async function series_cubePathGet(
  seriesUID: string,
  maxAttempts: number = 4,
  retryDelayMs: number = 2_000,
): Promise<SeriesCubePath | null> {
  const stateResult = await seriesStorage_resolve(seriesUID, { attempts: maxAttempts, delayMs: retryDelayMs });
  if (!stateResult.ok || stateResult.value.folderPath === null) return null;
  return { folderPath: stateResult.value.folderPath, fileCount: stateResult.value.fileCount };
}
