/**
 * @file PACS VFS Provider.
 *
 * Implements virtual file browser directories and sequential synthetic PACS retrieves.
 *
 * @module
 */

import { Result, Ok, Err, errorStack, chrisConnection, chrisContext, Context, PACSQueryCreateData, PACSQueryDecodedResult, PACSQueryRecord, PACSRetrieveRecord, PACSQueryStatusReport, FilteredResourceData, PACSServer } from "@fnndsc/cumin";
import { VFSProvider, VFSItem, CpOptions } from "../provider.js";
import { vfsItems_sort } from "../sort.js";
import {
  tag_extractValue,
  path_normalize,
  queryId_extractFromFolder,
  studies_extractFromDecoded,
  series_extractFromStudy,
  study_findByUID,
  series_findByUID,
  cpSrc_parse,
} from "./pacsHelpers.js";

import {
  pacsServers_list,
  pacsQueries_list,
  pacsQueries_create,
  pacsRetrieve_create,
  pacsRetrieve_statusForQuery,
  pacsQuery_resultDecode,
} from "../../pacs/index.js";
import { files_copyRecursively } from "../../files/index.js";
import path from "path";
import chalk from "chalk";
import { pacsVfs_read, pacsVfs_readBinary } from "./pacs_content.js";


/**
 * Resolves the folder path on ChRIS storage for a retrieved series.
 *
 * @param seriesInstanceUID - The Series Instance UID to resolve.
 * @returns Promise resolving to the folder path string or null on failure.
 */
async function series_getFolderPath(seriesInstanceUID: string): Promise<string | null> {
  const client: Awaited<ReturnType<typeof chrisConnection.client_get>> = await chrisConnection.client_get();
  if (!client) {
    return null;
  }
  const seriesList: Awaited<ReturnType<typeof client.getPACSSeriesList>> = await client.getPACSSeriesList({
    SeriesInstanceUID: seriesInstanceUID,
    limit: 1,
  });
  const seriesItems: ReturnType<typeof seriesList.getItems> = seriesList.getItems();
  if (!seriesItems || seriesItems.length === 0) {
    return null;
  }
  const series: { data?: { folder_path?: string } } = seriesItems[0] as unknown as { data?: { folder_path?: string } };
  return series?.data?.folder_path || null;
}

type SortOptions = { sort?: "name" | "size" | "date" | "owner"; reverse?: boolean };













function pacsRoot_list(): Result<VFSItem[]> {
  return Ok([{ name: "queries", type: "vfs", size: 0, owner: "root", date: new Date().toISOString() }]);
}

async function queries_list(options?: SortOptions): Promise<Result<VFSItem[]>> {
  const queriesResult: Result<FilteredResourceData | null> = await pacsQueries_list({ limit: 100 });
  if (!queriesResult || !queriesResult.ok || !queriesResult.value) return Ok([]);
  const items: VFSItem[] = queriesResult.value.tableData.map((row: Record<string, unknown>): VFSItem => {
    const queryId: string = String(row.id);
    const title: string = typeof row.title === "string" ? row.title : "query";
    const queryStr: string = typeof row.query === "string" ? row.query : "";
    let queryObj: Record<string, unknown> = {};
    try { if (queryStr) queryObj = JSON.parse(queryStr); } catch { /* ignore */ }
    const queryParts: string[] = [];
    for (const [k, v] of Object.entries(queryObj)) {
      if (v !== undefined && v !== null && String(v).trim().length > 0) queryParts.push(`${k}:${v}`);
    }
    let queryDesc: string = queryParts.join("_");
    if (!queryDesc) queryDesc = title.replace(/^pacs_query_\d+_\d+$/, "query").replace(/^pacs_query_/, "");
    const hasResult: boolean = typeof row.result === "string" && row.result.trim().length > 0;
    const noHitsSuffix: string = hasResult ? "" : "_no-hits";
    const ownerUsername: string = typeof row.owner_username === "string" ? row.owner_username : "";
    const userSuffix: string = ownerUsername ? `_${ownerUsername}` : "";
    const creationDate: string = typeof row.creation_date === "string" ? row.creation_date : new Date().toISOString();
    return {
      name: `${queryDesc}_qid:${queryId}${userSuffix}${noHitsSuffix}`,
      type: "dir",
      size: 0,
      owner: ownerUsername || "system",
      date: creationDate,
    };
  });
  return Ok(vfsItems_sort(items, options?.sort, options?.reverse));
}

function studies_list(studies: Record<string, unknown>[], options?: SortOptions): Result<VFSItem[]> {
  const items: VFSItem[] = studies.map((studyObj: Record<string, unknown>, idx: number): VFSItem => {
    const rawUID: unknown = studyObj.StudyInstanceUID || studyObj.uid;
    const studyUID: string = tag_extractValue(rawUID || `study_${idx}`);
    const studyDesc: string = tag_extractValue(studyObj.StudyDescription || "NoDescription");
    return {
      name: `Study_${studyUID}_${studyDesc.replace(/[\s/]/g, "_")}`,
      type: "dir",
      size: 0,
      owner: "system",
      date: "",
    };
  });
  return Ok(vfsItems_sort(items, options?.sort, options?.reverse));
}

function series_list(seriesArr: Record<string, unknown>[], options?: SortOptions): Result<VFSItem[]> {
  const items: VFSItem[] = seriesArr.map((seriesObj: Record<string, unknown>, idx: number): VFSItem => {
    const rawUID: unknown = seriesObj.SeriesInstanceUID || seriesObj.uid;
    const seriesUID: string = tag_extractValue(rawUID || `series_${idx}`);
    const seriesDesc: string = tag_extractValue(seriesObj.SeriesDescription || "NoDescription");
    return {
      name: `Series_${seriesUID}_${seriesDesc.replace(/[\s/]/g, "_")}`,
      type: "dir",
      size: 0,
      owner: "system",
      date: "",
    };
  });
  return Ok(vfsItems_sort(items, options?.sort, options?.reverse));
}

function seriesFiles_list(seriesObj: Record<string, unknown>): Result<VFSItem[]> {
  return Ok([
    { name: "metadata.json", type: "file", size: JSON.stringify(seriesObj).length, owner: "system", date: "" },
    { name: "image_slices.dcm", type: "file", size: 0, owner: "system", date: "" },
  ]);
}


function seriesToRetrieve_build(
  decoded: PACSQueryDecodedResult,
  studyUID: string,
  seriesUID: string | undefined,
  src: string
): Result<{ uid: string; description: string }[]> {
  const studies: Record<string, unknown>[] = studies_extractFromDecoded(decoded.json);
  const studyObj: Record<string, unknown> | undefined = study_findByUID(studies, studyUID);
  if (!studyObj) {
    errorStack.stack_push("error", `cp: Study with UID ${studyUID} not found in query results.`);
    return Err();
  }

  const seriesArray: Record<string, unknown>[] = series_extractFromStudy(studyObj);
  const seriesToRetrieve: { uid: string; description: string }[] = [];

  if (seriesUID) {
    const seriesObj: Record<string, unknown> | undefined = series_findByUID(seriesArray, seriesUID);
    const desc: string = seriesObj ? tag_extractValue(seriesObj.SeriesDescription || "Series") : "Series";
    seriesToRetrieve.push({ uid: seriesUID, description: desc });
  } else {
    for (const s of seriesArray) {
      const sUID: string = tag_extractValue(s.SeriesInstanceUID || s.uid);
      if (sUID) {
        seriesToRetrieve.push({ uid: sUID, description: tag_extractValue(s.SeriesDescription || "Series") });
      }
    }
  }

  if (seriesToRetrieve.length === 0) {
    errorStack.stack_push("error", `cp: No series found to retrieve from '${src}'`);
    return Err();
  }

  return Ok(seriesToRetrieve);
}

async function pacsServer_resolve(): Promise<Result<string>> {
  const fromContext: string | null = await chrisContext.current_get(Context.PACSserver);
  if (fromContext) return Ok(fromContext);

  const serversResult: Result<PACSServer[]> = await pacsServers_list();
  if (serversResult.ok && serversResult.value.length > 0) {
    return Ok(String(serversResult.value[0].id));
  }
  errorStack.stack_push("error", "cp: No PACS server available or configured in context.");
  return Err();
}

async function retrieve_pollUntilComplete(
  syntheticQueryId: number,
  seriesUID: string,
  maxAttempts: number
): Promise<boolean> {
  let attempts: number = 0;
  while (attempts < maxAttempts) {
    attempts++;
    await new Promise<void>((resolve) => setTimeout(resolve, 5000));

    const statusResult: Result<PACSQueryStatusReport> = await pacsRetrieve_statusForQuery(syntheticQueryId);
    if (!statusResult.ok || !statusResult.value) {
      console.log(chalk.yellow(`     [Attempt ${attempts}/${maxAttempts}] Failed to fetch status report, retrying...`));
      continue;
    }

    const statusReport: PACSQueryStatusReport = statusResult.value;
    let totalExpected: number = 0;
    let totalActual: number = 0;
    let anyPulling: boolean = false;
    let allPulled: boolean = true;
    let anyError: boolean = false;

    if (statusReport.studies) {
      for (const s of statusReport.studies) {
        if (s.series) {
          for (const ser of s.series) {
            if (String(ser.seriesInstanceUID) === String(seriesUID)) {
              totalExpected = Number(ser.expectedFiles) || 0;
              totalActual = Number(ser.actualFiles) || 0;
              if (ser.status === "pulling") anyPulling = true;
              if (ser.status !== "pulled") allPulled = false;
              if (ser.status === "error") anyError = true;
            }
          }
        }
      }
    }

    const overallStatus: string = statusReport.retrieveStatus || "pending";
    console.log(chalk.gray(`     [Attempt ${attempts}/${maxAttempts}] CUBE Status: ${overallStatus} | Files: ${totalActual}/${totalExpected}`));

    if (allPulled && totalExpected > 0 && totalActual === totalExpected) {
      console.log(chalk.green(`  ✓ Pull complete: ${totalActual}/${totalExpected} files retrieved.`));
      return true;
    }
    if (overallStatus === "succeeded" || overallStatus === "completed") {
      console.log(chalk.green(`  ✓ Pull complete (Status: ${overallStatus}).`));
      return true;
    }
    if (anyError || overallStatus === "error" || overallStatus === "failed") {
      console.error(chalk.red("  ✗ PACS retrieve reported error status."));
      return false;
    }
  }

  console.error(chalk.red("  ✗ PACS retrieve timed out."));
  return false;
}

async function series_retrieveAndCopy(
  seriesItem: { uid: string; description: string },
  studyUID: string,
  pacsserver: string,
  dest: string,
  idx: number,
  total: number
): Promise<boolean> {
  console.log(chalk.cyan(`\n[PACS Retrieve ${idx + 1}/${total}] Processing series: ${seriesItem.description} (${seriesItem.uid})...`));

  const queryPayload: PACSQueryCreateData = {
    title: `Synthetic cp Query ${seriesItem.uid}`,
    query: JSON.stringify({ SeriesInstanceUID: seriesItem.uid, StudyInstanceUID: studyUID }),
    execute: false,
  };

  console.log(chalk.gray("  -> Registering synthetic query on CUBE..."));
  const queryResult: Result<PACSQueryRecord> = await pacsQueries_create(pacsserver, queryPayload);
  if (!queryResult.ok) {
    console.error(chalk.red(`  ✗ Failed to create synthetic query for series ${seriesItem.uid}`));
    return false;
  }

  const syntheticQueryId: number = queryResult.value.id;
  console.log(chalk.gray(`  -> Triggering PACS retrieve (Query ID: ${syntheticQueryId})...`));
  const retrieveResult: Result<PACSRetrieveRecord> = await pacsRetrieve_create(syntheticQueryId);
  if (!retrieveResult.ok) {
    console.error(chalk.red(`  ✗ Failed to create PACS retrieve for query ${syntheticQueryId}`));
    return false;
  }

  console.log(chalk.gray("  -> Pulling series data sequentially, polling progress..."));
  const finished: boolean = await retrieve_pollUntilComplete(syntheticQueryId, seriesItem.uid, 60);
  if (!finished) return false;

  console.log(chalk.gray("  -> Finding folder path on ChRIS storage..."));
  const folderPath: string | null = await series_getFolderPath(seriesItem.uid);
  if (!folderPath) {
    console.error(chalk.red(`  ✗ No registered folder path found for series UID ${seriesItem.uid}`));
    return false;
  }

  const absoluteFolderPath: string = folderPath.startsWith("/") ? folderPath : "/" + folderPath;
  const cleanDesc: string = seriesItem.description.replace(/[\s/]/g, "_");
  const targetSeriesFolder: string = path.posix.join(dest, `Series_${seriesItem.uid}_${cleanDesc}`);

  console.log(chalk.gray(`  -> Copying series files to '${targetSeriesFolder}'...`));
  const copySuccess: boolean = await files_copyRecursively(absoluteFolderPath, targetSeriesFolder);
  if (!copySuccess) {
    console.error(chalk.red(`  ✗ Recursive copy failed from '${absoluteFolderPath}' to '${targetSeriesFolder}'`));
    return false;
  }

  console.log(chalk.green(`  ✓ Series '${seriesItem.description}' copied successfully.`));
  return true;
}

/**
 * Virtual PACS Search results VFS provider.
 */
export class PacsVfsProvider implements VFSProvider {
  /** Prefix matches /net/pacs and subdirectories. */
  prefix = "/net/pacs";

  /** Cache for decoded PACS query results to avoid redundant API hits. */
  private _queryCache: Map<number, PACSQueryDecodedResult> = new Map<number, PACSQueryDecodedResult>();

  /**
   * Fetches the decoded query result, leveraging a cache to prevent redundant API calls.
   *
   * @param queryId - The ID of the PACS query to decode.
   * @returns Promise resolving to the decoded PACS query result, or null if fetch fails.
   */
  private async queryResult_fetch(queryId: number): Promise<PACSQueryDecodedResult | null> {
    const cached: PACSQueryDecodedResult | undefined = this._queryCache.get(queryId);
    if (cached) {
      return cached;
    }

    const decodedResult: Result<PACSQueryDecodedResult> = await pacsQuery_resultDecode(queryId);
    if (!decodedResult.ok || !decodedResult.value) {
      return null;
    }

    this._queryCache.set(queryId, decodedResult.value);
    return decodedResult.value;
  }

  /**
   * Lazily lists virtual directory contents under `/net/pacs`.
   */
  async list(
    pathStr: string,
    options?: SortOptions
  ): Promise<Result<VFSItem[]>> {
    try {
      const effectivePath: string = path_normalize(pathStr);

      if (effectivePath === "/net/pacs") return pacsRoot_list();
      if (effectivePath === "/net/pacs/queries") return queries_list(options);

      const parts: string[] = effectivePath.split("/").filter(Boolean);

      if (parts.length >= 3 && parts[2] !== "queries") {
        errorStack.stack_push("error", `'${effectivePath}': No such virtual directory. Valid paths under /net/pacs: /net/pacs/queries`);
        return Err();
      }

      const queryFolder: string = parts[3];
      if (!queryFolder) return Ok([]);

      const queryId: number = queryId_extractFromFolder(queryFolder);
      if (Number.isNaN(queryId)) {
        errorStack.stack_push("error", `'${effectivePath}': No such virtual directory. Use 'ls /net/pacs/queries' to see available queries.`);
        return Err();
      }

      const decoded: PACSQueryDecodedResult | null = await this.queryResult_fetch(queryId);
      if (!decoded?.json) {
        errorStack.stack_push("error", `PACS query ${queryId} has no structured study/series result payload.`);
        return Err();
      }

      const studies: Record<string, unknown>[] = studies_extractFromDecoded(decoded.json);

      if (parts.length === 4) return studies_list(studies, options);

      const studyUID: string = parts[4].replace(/^Study_/, "").split("_")[0];
      const studyObj: Record<string, unknown> | undefined = study_findByUID(studies, studyUID);
      if (!studyObj) return Ok([]);

      const seriesArr: Record<string, unknown>[] = series_extractFromStudy(studyObj);

      if (parts.length === 5) return series_list(seriesArr, options);

      if (parts.length === 6) {
        const seriesUID: string = parts[5].replace(/^Series_/, "").split("_")[0];
        const seriesObj: Record<string, unknown> | undefined = series_findByUID(seriesArr, seriesUID);
        if (!seriesObj) return Ok([]);
        return seriesFiles_list(seriesObj);
      }

      return Ok([]);
    } catch (error: unknown) {
      const msg: string = error instanceof Error ? error.message : String(error);
      errorStack.stack_push("error", `PACS VFS list failed: ${msg}`);
      return Err();
    }
  }

  /**
   * Triggers sequential synthetic PACS pulls and link-copies results to feed destination.
   *
   * @param src - Source PACS absolute virtual path.
   * @param dest - Destination native feed folder.
   * @param options - Copy options like recursive.
   */
  async cp(src: string, dest: string, _options: CpOptions): Promise<boolean> {
    try {
      const parsedResult: Result<{ studyUID: string; seriesUID?: string; queryId: number }> = cpSrc_parse(src);
      if (!parsedResult.ok) return false;
      const { studyUID, seriesUID, queryId } = parsedResult.value;

      const decoded: PACSQueryDecodedResult | null = await this.queryResult_fetch(queryId);
      if (!decoded?.json) {
        errorStack.stack_push("error", `cp: Failed to decode query results for query ID ${queryId}`);
        return false;
      }

      const seriesResult: Result<{ uid: string; description: string }[]> = seriesToRetrieve_build(decoded, studyUID, seriesUID, src);
      if (!seriesResult.ok) return false;
      const seriesToRetrieve: { uid: string; description: string }[] = seriesResult.value;

      const serverResult: Result<string> = await pacsServer_resolve();
      if (!serverResult.ok) return false;
      const pacsserver: string = serverResult.value;

      console.log(chalk.cyan(`[PACS Retrieve] Initiating sequential gather of ${seriesToRetrieve.length} series...`));

      let overallSuccess: boolean = true;
      for (let i: number = 0; i < seriesToRetrieve.length; i++) {
        const ok: boolean = await series_retrieveAndCopy(seriesToRetrieve[i], studyUID, pacsserver, dest, i, seriesToRetrieve.length);
        if (!ok) overallSuccess = false;
      }
      return overallSuccess;
    } catch (error: unknown) {
      const msg: string = error instanceof Error ? error.message : String(error);
      errorStack.stack_push("error", `PACS cp failed: ${msg}`);
      return false;
    }
  }

  /**
   * Reads virtual file content under '/net/pacs'.
   *
   * @param pathStr - The absolute virtual path of the file to read.
   * @returns Promise resolving to a Result containing the file contents as a string.
   */
  async read(pathStr: string): Promise<Result<string>> {
    return pacsVfs_read(pathStr, (queryId: number) => this.queryResult_fetch(queryId));
  }

  /**
   * Reads virtual file binary content under '/net/pacs'.
   *
   * @param pathStr - The absolute virtual path of the file to read.
   * @returns Promise resolving to a Result containing the file contents as a Buffer.
   */
  async readBinary(pathStr: string): Promise<Result<Buffer>> {
    return pacsVfs_readBinary(pathStr, (queryId: number) => this.queryResult_fetch(queryId));
  }
}
