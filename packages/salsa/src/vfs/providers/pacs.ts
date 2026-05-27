/**
 * @file PACS VFS Provider.
 *
 * Implements virtual file browser directories and sequential synthetic PACS retrieves.
 *
 * @module
 */

import { Result, Ok, Err, errorStack, chrisConnection, chrisContext, Context, PACSQueryCreateData, PACSQueryDecodedResult } from "@fnndsc/cumin";
import { VFSProvider, VFSItem, CpOptions } from "../provider.js";
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

/**
 * Standard sort utility for VFS items.
 */
function vfs_sortItems(
  items: VFSItem[],
  sortField?: "name" | "size" | "date" | "owner",
  reverse?: boolean
): VFSItem[] {
  const field: keyof VFSItem = sortField || "name";
  const sorted = [...items].sort((a: VFSItem, b: VFSItem) => {
    const valA = a[field];
    const valB = b[field];
    if (typeof valA === "string" && typeof valB === "string") {
      return valA.localeCompare(valB);
    }
    if (typeof valA === "number" && typeof valB === "number") {
      return valA - valB;
    }
    return 0;
  });
  if (reverse) {
    sorted.reverse();
  }
  return sorted;
}

/**
 * Safely extracts a string value from a potentially object-wrapped DICOM tag.
 *
 * @param val - Potentially object-wrapped DICOM tag or raw string.
 * @returns The string value of the DICOM tag.
 */
function pacs_tagValueExtract(val: unknown): string {
  if (val && typeof val === "object") {
    const record = val as Record<string, unknown>;
    if ("value" in record) {
      return String(record.value ?? "");
    }
  }
  return String(val ?? "");
}

/**
 * Resolves the folder path on ChRIS storage for a retrieved series.
 *
 * @param seriesInstanceUID - The Series Instance UID to resolve.
 * @returns Promise resolving to the folder path string or null on failure.
 */
async function seriesFolderPath_get(seriesInstanceUID: string): Promise<string | null> {
  const client = await chrisConnection.client_get();
  if (!client) {
    return null;
  }
  const seriesList = await client.getPACSSeriesList({
    SeriesInstanceUID: seriesInstanceUID,
    limit: 1,
  });
  const seriesItems = seriesList.getItems();
  if (!seriesItems || seriesItems.length === 0) {
    return null;
  }
  const series = seriesItems[0] as unknown as { data?: { folder_path?: string } };
  return series?.data?.folder_path || null;
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
    const cached = this._queryCache.get(queryId);
    if (cached) {
      return cached;
    }

    const decodedResult = await pacsQuery_resultDecode(queryId);
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
    options?: { sort?: "name" | "size" | "date" | "owner"; reverse?: boolean }
  ): Promise<Result<VFSItem[]>> {
    try {
      let effectivePath = pathStr.startsWith("/") ? pathStr : "/" + pathStr;
      if (effectivePath.length > 1 && effectivePath.endsWith("/")) {
        effectivePath = effectivePath.slice(0, -1);
      }

      if (effectivePath === "/net/pacs") {
        const items: VFSItem[] = [
          {
            name: "queries",
            type: "vfs",
            size: 0,
            owner: "root",
            date: new Date().toISOString(),
          },
        ];
        return Ok(items);
      }

      if (effectivePath === "/net/pacs/queries") {
        const queriesResult = await pacsQueries_list({ limit: 100 });
        if (!queriesResult || !queriesResult.ok || !queriesResult.value) {
          return Ok([]);
        }
        const tableData = queriesResult.value.tableData;
        const items: VFSItem[] = tableData.map((row: Record<string, unknown>): VFSItem => {
          const queryId = String(row.id);
          const title = typeof row.title === "string" ? row.title : "query";
          const queryStr = typeof row.query === "string" ? row.query : "";

          let queryObj: Record<string, unknown> = {};
          try {
            if (queryStr) {
              queryObj = JSON.parse(queryStr);
            }
          } catch {
            // Ignore
          }

          const queryParts: string[] = [];
          for (const [k, v] of Object.entries(queryObj)) {
            if (v !== undefined && v !== null && String(v).trim().length > 0) {
              queryParts.push(`${k}:${v}`);
            }
          }

          let queryDesc = queryParts.join("_");
          if (!queryDesc) {
            queryDesc = title.replace(/^pacs_query_\d+_\d+$/, "query").replace(/^pacs_query_/, "");
          }

          const hasResult = typeof row.result === "string" && row.result.trim().length > 0;
          if (!hasResult) {
            queryDesc += "-no-hits";
          }

          const creationDate = typeof row.creation_date === "string" ? row.creation_date : new Date().toISOString();
          return {
            name: `${queryId}_${queryDesc}`,
            type: "dir",
            size: 0,
            owner: typeof row.owner_username === "string" ? row.owner_username : "system",
            date: creationDate,
          };
        });
        const sorted = vfs_sortItems(items, options?.sort, options?.reverse);
        return Ok(sorted);
      }

      const parts = effectivePath.split("/").filter(Boolean);

      // Validate third segment — only 'queries' is a valid subpath under /net/pacs
      if (parts.length >= 3 && parts[2] !== "queries") {
        const validPaths = ["/net/pacs/queries"];
        errorStack.stack_push(
          "error",
          `'${effectivePath}': No such virtual directory. Valid paths under /net/pacs: ${validPaths.join(", ")}`
        );
        return Err();
      }

      const queryFolder = parts[3];
      if (!queryFolder) {
        return Ok([]);
      }
      const queryId = Number(queryFolder.split("_")[0]);
      if (Number.isNaN(queryId)) {
        errorStack.stack_push(
          "error",
          `'${effectivePath}': No such virtual directory. Use 'ls /net/pacs/queries' to see available queries.`
        );
        return Err();
      }

      const decoded = await this.queryResult_fetch(queryId);
      if (!decoded || !decoded.json) {
        errorStack.stack_push(
          "error",
          `PACS query ${queryId} has no structured study/series result payload.`
        );
        return Err();
      }

      const decodedJson = decoded.json;
      let studiesObj: unknown;
      if (decodedJson && typeof decodedJson === "object") {
        const record = decodedJson as Record<string, unknown>;
        if ("studies" in record) {
          studiesObj = record.studies;
        } else if ("Studies" in record) {
          studiesObj = record.Studies;
        } else if ("results" in record) {
          studiesObj = record.results;
        } else {
          studiesObj = decodedJson;
        }
      } else {
        studiesObj = decodedJson;
      }

      const studies: unknown[] = Array.isArray(studiesObj) ? studiesObj : [studiesObj];

      if (parts.length === 4) {
        const items: VFSItem[] = (studies as Record<string, unknown>[]).map((studyObj: Record<string, unknown>, idx: number): VFSItem => {
          const rawUID = studyObj.StudyInstanceUID || studyObj.uid;
          const studyUID = pacs_tagValueExtract(rawUID || `study_${idx}`);
          const studyDesc = pacs_tagValueExtract(studyObj.StudyDescription || "NoDescription");
          const cleanDesc = studyDesc.replace(/[\s\/]/g, "_");
          return {
            name: `Study_${studyUID}_${cleanDesc}`,
            type: "dir",
            size: 0,
            owner: "system",
            date: "",
          };
        });
        const sorted = vfs_sortItems(items, options?.sort, options?.reverse);
        return Ok(sorted);
      }

      const studyFolder = parts[4];
      if (!studyFolder) {
        return Ok([]);
      }
      const studyUID = studyFolder.replace(/^Study_/, "").split("_")[0];

      const studyObj = (studies as Record<string, unknown>[]).find((s: Record<string, unknown>) => {
        const sUID = pacs_tagValueExtract(s.StudyInstanceUID || s.uid);
        return sUID === studyUID;
      });

      if (!studyObj) {
        return Ok([]);
      }

      const seriesArr: unknown[] =
        Array.isArray(studyObj.series) ? studyObj.series :
        Array.isArray(studyObj.Series) ? studyObj.Series :
        Array.isArray(studyObj.results) ? studyObj.results :
        Array.isArray(studyObj.data) ? studyObj.data :
        [];

      if (parts.length === 5) {
        const items: VFSItem[] = (seriesArr as Record<string, unknown>[]).map((seriesObj: Record<string, unknown>, idx: number): VFSItem => {
          const rawUID = seriesObj.SeriesInstanceUID || seriesObj.uid;
          const seriesUID = pacs_tagValueExtract(rawUID || `series_${idx}`);
          const seriesDesc = pacs_tagValueExtract(seriesObj.SeriesDescription || "NoDescription");
          const cleanDesc = seriesDesc.replace(/[\s\/]/g, "_");
          return {
            name: `Series_${seriesUID}_${cleanDesc}`,
            type: "dir",
            size: 0,
            owner: "system",
            date: "",
          };
        });
        const sorted = vfs_sortItems(items, options?.sort, options?.reverse);
        return Ok(sorted);
      }

      if (parts.length === 6) {
        const seriesFolder = parts[5];
        const seriesUID = seriesFolder.replace(/^Series_/, "").split("_")[0];

        const seriesObj = (seriesArr as Record<string, unknown>[]).find((s: Record<string, unknown>) => {
          const sUID = pacs_tagValueExtract(s.SeriesInstanceUID || s.uid);
          return sUID === seriesUID;
        });

        if (!seriesObj) {
          return Ok([]);
        }

        const items: VFSItem[] = [
          {
            name: "metadata.json",
            type: "file",
            size: JSON.stringify(seriesObj).length,
            owner: "system",
            date: "",
          },
          {
            name: "image_slices.dcm",
            type: "file",
            size: 0,
            owner: "system",
            date: "",
          },
        ];
        return Ok(items);
      }

      return Ok([]);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
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
  async cp(src: string, dest: string, options: CpOptions): Promise<boolean> {
    try {
      const absolutePath = src.startsWith("/") ? src : "/" + src;
      const parts = absolutePath.split("/").filter(Boolean);

      if (parts.length < 4) {
        errorStack.stack_push("error", `cp: Copying from '${src}' is not supported. Please specify a Study or Series directory.`);
        return false;
      }

      const studyFolder = parts[3];
      if (!studyFolder.startsWith("Study_")) {
        errorStack.stack_push("error", `cp: Invalid PACS Study folder format: '${studyFolder}'`);
        return false;
      }
      const studyUID = studyFolder.replace(/^Study_/, "").split("_")[0];

      let seriesUID: string | undefined;
      if (parts.length >= 5) {
        const seriesFolder = parts[4];
        if (seriesFolder.startsWith("Series_")) {
          seriesUID = seriesFolder.replace(/^Series_/, "").split("_")[0];
        }
      }

      const queryFolder = parts[2];
      const queryId = Number(queryFolder.split("_")[0]);
      if (Number.isNaN(queryId)) {
        errorStack.stack_push("error", `cp: Invalid query ID in path '${src}'`);
        return false;
      }

      const decoded = await this.queryResult_fetch(queryId);
      if (!decoded || !decoded.json) {
        errorStack.stack_push("error", `cp: Failed to decode query results for query ID ${queryId}`);
        return false;
      }

      const decodedJson = decoded.json;
      let studiesObj: unknown;
      if (decodedJson && typeof decodedJson === "object") {
        const record = decodedJson as Record<string, unknown>;
        if ("studies" in record) {
          studiesObj = record.studies;
        } else if ("Studies" in record) {
          studiesObj = record.Studies;
        } else if ("results" in record) {
          studiesObj = record.results;
        } else {
          studiesObj = decodedJson;
        }
      } else {
        studiesObj = decodedJson;
      }

      const studies: unknown[] = Array.isArray(studiesObj) ? studiesObj : [studiesObj];

      const studyObj = (studies as Record<string, unknown>[]).find((s: Record<string, unknown>) => {
        const sUID = pacs_tagValueExtract(s.StudyInstanceUID || s.uid);
        return sUID === studyUID;
      });

      if (!studyObj) {
        errorStack.stack_push("error", `cp: Study with UID ${studyUID} not found in query results.`);
        return false;
      }

      const seriesArray: unknown[] =
        Array.isArray(studyObj.series) ? studyObj.series :
        Array.isArray(studyObj.Series) ? studyObj.Series :
        Array.isArray(studyObj.results) ? studyObj.results :
        Array.isArray(studyObj.data) ? studyObj.data :
        [];

      const seriesToRetrieve: { uid: string; description: string }[] = [];
      if (seriesUID) {
        const seriesObj = (seriesArray as Record<string, unknown>[]).find((s: Record<string, unknown>) => {
          const sUID = pacs_tagValueExtract(s.SeriesInstanceUID || s.uid);
          return sUID === seriesUID;
        });
        const desc = seriesObj ? pacs_tagValueExtract(seriesObj.SeriesDescription || "Series") : "Series";
        seriesToRetrieve.push({ uid: seriesUID, description: desc });
      } else {
        (seriesArray as Record<string, unknown>[]).forEach((s: Record<string, unknown>) => {
          const sUID = pacs_tagValueExtract(s.SeriesInstanceUID || s.uid);
          if (sUID) {
            const desc = pacs_tagValueExtract(s.SeriesDescription || "Series");
            seriesToRetrieve.push({ uid: sUID, description: desc });
          }
        });
      }

      if (seriesToRetrieve.length === 0) {
        errorStack.stack_push("error", `cp: No series found to retrieve from '${src}'`);
        return false;
      }

      let pacsserver = await chrisContext.current_get(Context.PACSserver);
      if (!pacsserver) {
        const serversResult = await pacsServers_list();
        if (serversResult.ok && serversResult.value.length > 0) {
          pacsserver = String(serversResult.value[0].id);
        } else {
          errorStack.stack_push("error", "cp: No PACS server available or configured in context.");
          return false;
        }
      }

      console.log(chalk.cyan(`[PACS Retrieve] Initiating sequential gather of ${seriesToRetrieve.length} series...`));

      let overallSuccess = true;
      for (let i = 0; i < seriesToRetrieve.length; i++) {
        const seriesItem = seriesToRetrieve[i];
        console.log(chalk.cyan(`\n[PACS Retrieve ${i + 1}/${seriesToRetrieve.length}] Processing series: ${seriesItem.description} (${seriesItem.uid})...`));

        const queryPayload: PACSQueryCreateData = {
          title: `Synthetic cp Query ${seriesItem.uid}`,
          query: JSON.stringify({
            SeriesInstanceUID: seriesItem.uid,
            StudyInstanceUID: studyUID,
          }),
          execute: false,
        };

        console.log(chalk.gray("  -> Registering synthetic query on CUBE..."));
        const queryResult = await pacsQueries_create(pacsserver, queryPayload);
        if (!queryResult.ok) {
          console.error(chalk.red(`  ✗ Failed to create synthetic query for series ${seriesItem.uid}`));
          overallSuccess = false;
          continue;
        }

        const syntheticQueryId = queryResult.value.id;
        console.log(chalk.gray(`  -> Triggering PACS retrieve (Query ID: ${syntheticQueryId})...`));
        const retrieveResult = await pacsRetrieve_create(syntheticQueryId);
        if (!retrieveResult.ok) {
          console.error(chalk.red(`  ✗ Failed to create PACS retrieve for query ${syntheticQueryId}`));
          overallSuccess = false;
          continue;
        }

        console.log(chalk.gray("  -> Pulling series data sequentially, polling progress..."));
        let finished = false;
        let attempts = 0;
        const maxAttempts = 60;

        while (!finished && attempts < maxAttempts) {
          attempts++;
          await new Promise((resolve) => setTimeout(resolve, 5000));

          const statusResult = await pacsRetrieve_statusForQuery(syntheticQueryId);
          if (statusResult.ok && statusResult.value) {
            const statusReport = statusResult.value;

            let totalExpected = 0;
            let totalActual = 0;
            let anyPulling = false;
            let allPulled = true;
            let anyError = false;

            if (statusReport.studies) {
              for (const s of statusReport.studies) {
                if (s.series) {
                  for (const ser of s.series) {
                    if (String(ser.seriesInstanceUID) === String(seriesItem.uid)) {
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

            const overallStatus = statusReport.retrieveStatus || "pending";
            console.log(chalk.gray(`     [Attempt ${attempts}/${maxAttempts}] CUBE Status: ${overallStatus} | Files: ${totalActual}/${totalExpected}`));

            if (allPulled && totalExpected > 0 && totalActual === totalExpected) {
              finished = true;
              console.log(chalk.green(`  ✓ Pull complete: ${totalActual}/${totalExpected} files retrieved.`));
            } else if (overallStatus === "succeeded" || overallStatus === "completed") {
              finished = true;
              console.log(chalk.green(`  ✓ Pull complete (Status: ${overallStatus}).`));
            } else if (anyError || overallStatus === "error" || overallStatus === "failed") {
              console.error(chalk.red("  ✗ PACS retrieve reported error status."));
              finished = true;
              overallSuccess = false;
            }
          } else {
            console.log(chalk.yellow(`     [Attempt ${attempts}/${maxAttempts}] Failed to fetch status report, retrying...`));
          }
        }

        if (!finished) {
          console.error(chalk.red("  ✗ PACS retrieve timed out."));
          overallSuccess = false;
          continue;
        }

        console.log(chalk.gray("  -> Finding folder path on ChRIS storage..."));
        const folderPath = await seriesFolderPath_get(seriesItem.uid);
        if (!folderPath) {
          console.error(chalk.red(`  ✗ No registered folder path found for series UID ${seriesItem.uid}`));
          overallSuccess = false;
          continue;
        }

        const absoluteFolderPath = folderPath.startsWith("/") ? folderPath : "/" + folderPath;
        const cleanDesc = seriesItem.description.replace(/[\s\/]/g, "_");
        const targetSeriesFolder = path.posix.join(dest, `Series_${seriesItem.uid}_${cleanDesc}`);

        console.log(chalk.gray(`  -> Copying series files to '${targetSeriesFolder}'...`));
        const copySuccess = await files_copyRecursively(absoluteFolderPath, targetSeriesFolder);
        if (!copySuccess) {
          console.error(chalk.red(`  ✗ Recursive copy failed from '${absoluteFolderPath}' to '${targetSeriesFolder}'`));
          overallSuccess = false;
        } else {
          console.log(chalk.green(`  ✓ Series '${seriesItem.description}' copied successfully.`));
        }
      }

      return overallSuccess;
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      errorStack.stack_push("error", `PACS cp failed: ${msg}`);
      return false;
    }
  }
}
