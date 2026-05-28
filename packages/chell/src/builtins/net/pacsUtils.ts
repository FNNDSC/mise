/**
 * @file Shared PACS utilities for VFS path traversal and CUBE FS resolution.
 *
 * Used by `pull` and `cubepath` builtins.
 *
 * @module
 */

import { errorStack, pacsQuery_resultDecode, pacsServers_list, chrisContext, Context } from '@fnndsc/cumin';

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
 * Minimal ChRIS API client slice for PACS series and file queries.
 */
export interface ChRISPACSClient {
  getPACSSeriesList(
    params: { SeriesInstanceUID: string; limit: number },
    timeout?: number,
  ): Promise<{ getItems(): Array<unknown>; totalCount: number }>;
  getPACSFiles(
    params: { fname: string; limit: number },
    timeout?: number,
  ): Promise<{ getItems(): Array<unknown>; totalCount: number }>;
}

/**
 * Safely unwraps a DICOM tag value (may be `{value: ...}` wrapper or plain string/number).
 */
export function pacs_tagValueExtract(val: unknown): string {
  if (val && typeof val === 'object') {
    const r: Record<string, unknown> = val as Record<string, unknown>;
    if ('value' in r) return String(r.value ?? '');
    if ('Value' in r && Array.isArray(r.Value) && r.Value.length > 0) return String(r.Value[0] ?? '');
  }
  return String(val ?? '');
}

/**
 * Extracts the UID portion of a VFS folder name (`<prefix>_<uid>_<label>`).
 */
export function folderUID_get(folder: string, prefix: string): string {
  const withoutPrefix: string = folder.replace(new RegExp(`^${prefix}_`), '');
  return withoutPrefix.split('_')[0];
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
  const qidMatch: RegExpExecArray | null = /_qid:(\d+)/.exec(queryFolder);
  const queryId: number = qidMatch ? Number(qidMatch[1]) : NaN;
  if (Number.isNaN(queryId)) {
    errorStack.stack_push('error', `${callerTag}: Cannot parse query ID from: ${queryFolder}`);
    return [];
  }
  const queryLabel: string = queryFolder.replace(/_qid:\d+.*$/, '');

  const decodedResult = await pacsQuery_resultDecode(queryId);
  if (!decodedResult.ok || !decodedResult.value.json) {
    errorStack.stack_push('error', `${callerTag}: Failed to decode results for query ${queryId}`);
    return [];
  }

  const raw: unknown = decodedResult.value.json;
  let studiesSource: unknown;
  if (raw && typeof raw === 'object') {
    const r: Record<string, unknown> = raw as Record<string, unknown>;
    studiesSource =
      'studies' in r ? r.studies :
      'Studies' in r ? r.Studies :
      'results' in r ? r.results :
      raw;
  } else {
    studiesSource = raw;
  }
  const studies: Record<string, unknown>[] =
    (Array.isArray(studiesSource) ? studiesSource : [studiesSource]) as Record<string, unknown>[];

  const targetStudyUID: string | null = parts.length >= 5
    ? folderUID_get(parts[4], 'Study')
    : null;
  const targetSeriesUID: string | null = parts.length >= 6
    ? folderUID_get(parts[5], 'Series')
    : null;

  const infos: PACSSeriesInfo[] = [];

  for (const studyObj of studies) {
    if (!studyObj || typeof studyObj !== 'object') continue;

    const studyUID: string = pacs_tagValueExtract(studyObj.StudyInstanceUID ?? studyObj.uid);
    if (targetStudyUID && studyUID !== targetStudyUID) continue;

    const studyLabel: string = pacs_tagValueExtract(studyObj.StudyDescription ?? 'Study').replace(/[\s/]/g, '_');
    const retrieveAETitle: string = pacs_tagValueExtract(studyObj.RetrieveAETitle ?? '');
    const pacsName: string = retrieveAETitle || fallbackPacsName;

    const seriesArr: Record<string, unknown>[] = (
      Array.isArray(studyObj.series) ? studyObj.series :
      Array.isArray(studyObj.Series) ? studyObj.Series :
      Array.isArray(studyObj.results) ? studyObj.results :
      []
    ) as Record<string, unknown>[];

    for (const seriesObj of seriesArr) {
      if (!seriesObj || typeof seriesObj !== 'object') continue;

      const seriesUID: string = pacs_tagValueExtract(seriesObj.SeriesInstanceUID ?? seriesObj.uid);
      if (!seriesUID) continue;
      if (targetSeriesUID && seriesUID !== targetSeriesUID) continue;

      const seriesLabel: string = pacs_tagValueExtract(seriesObj.SeriesDescription ?? 'Series').replace(/[\s/]/g, '_');
      const expectedFiles: number = Number(pacs_tagValueExtract(seriesObj.NumberOfSeriesRelatedInstances ?? '0')) || 0;

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
 * Retries up to `maxAttempts` times with `retryDelayMs` between attempts
 * to handle the timing gap between LONK completion and pacsseries DB indexing.
 *
 * @param seriesUID - DICOM SeriesInstanceUID.
 * @param pacsClient - ChRIS API client with getPACSSeriesList and getPACSFiles.
 * @param maxAttempts - Number of attempts before giving up (default 4).
 * @param retryDelayMs - Delay between attempts in ms (default 2000).
 * @returns SeriesCubePath on success, or null if not found.
 */
export async function series_cubePathGet(
  seriesUID: string,
  pacsClient: ChRISPACSClient,
  maxAttempts: number = 4,
  retryDelayMs: number = 2_000,
): Promise<SeriesCubePath | null> {
  const sleep = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms));

  for (let attempt: number = 0; attempt < maxAttempts; attempt++) {
    try {
      if (attempt > 0) await sleep(retryDelayMs);

      const seriesList = await pacsClient.getPACSSeriesList({ SeriesInstanceUID: seriesUID, limit: 1 });
      const items: Array<unknown> = seriesList.getItems();
      if (items.length === 0) continue;

      const series = items[0] as { data?: { folder_path?: string } };
      const raw: string | undefined = series?.data?.folder_path;
      if (!raw) continue;
      // Display path has leading slash; fname query uses raw (API stores without leading slash)
      const folderPath: string = raw.startsWith('/') ? raw : `/${raw}`;
      const fnameQuery: string = raw.startsWith('/') ? raw.slice(1) : raw;

      const fileList = await pacsClient.getPACSFiles({ fname: fnameQuery, limit: 1 });
      const fileCount: number = Math.max(0, fileList.totalCount);

      return { folderPath, fileCount };
    } catch {
      // retry
    }
  }

  return null;
}
