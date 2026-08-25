/**
 * @file PACS VFS Content Handler.
 *
 * Implements specialized virtual file reading and content generation
 * for PACS queries metadata.json and image_slices.dcm.
 *
 * @module
 */

import { Result, Ok, Err, errorStack, PACSQueryDecodedResult } from "@fnndsc/cumin";
import {
  queryId_extractFromFolder,
  folderUID_get,
  studies_extractFromDecoded,
  series_extractFromStudy,
  study_findByUID,
  series_findByUID,
} from "./pacsHelpers.js";

/**
 * Reads virtual file content under '/net/pacs'.
 *
 * Handles pretty-printed JSON series details for metadata.json and blocks image_slices.dcm.
 *
 * @param pathStr - The absolute virtual path of the file to read.
 * @param queryResult_fetch - Callback to fetch decoded PACS query results (leveraging cache).
 * @returns Promise resolving to a Result containing the file contents as a string.
 */
export async function pacsVfs_read(
  pathStr: string,
  queryResult_fetch: (queryId: number) => Promise<PACSQueryDecodedResult | null>
): Promise<Result<string>> {
  try {
    let effectivePath: string = pathStr.startsWith("/") ? pathStr : "/" + pathStr;
    if (effectivePath.length > 1 && effectivePath.endsWith("/")) {
      effectivePath = effectivePath.slice(0, -1);
    }

    const parts: string[] = effectivePath.split("/").filter(Boolean);
    if (parts.length !== 7 || parts[0] !== "net" || parts[1] !== "pacs" || parts[2] !== "queries") {
      errorStack.stack_push("error", `File not found: ${pathStr}`);
      return Err();
    }

    const queryFolder: string = parts[3];
    const studyFolder: string = parts[4];
    const seriesFolder: string = parts[5];
    const filename: string = parts[6];

    // Query folders are named `<desc>_qid:<id>[_<user>]` (see the listing
    // provider); the shared helper parses the id the same way everywhere.
    const queryId: number = queryId_extractFromFolder(queryFolder);
    if (Number.isNaN(queryId)) {
      errorStack.stack_push("error", `Invalid query ID in path '${pathStr}'`);
      return Err();
    }

    if (filename === "image_slices.dcm") {
      errorStack.stack_push(
        "error",
        "image_slices.dcm is a virtual placeholder. Use the 'cp' command on the containing Study or Series directory to download the DICOM files."
      );
      return Err();
    }

    if (filename !== "metadata.json") {
      errorStack.stack_push("error", `File not found: ${pathStr}`);
      return Err();
    }

    const decoded: PACSQueryDecodedResult | null = await queryResult_fetch(queryId);
    if (!decoded || !decoded.json) {
      errorStack.stack_push("error", `PACS query ${queryId} has no result payload.`);
      return Err();
    }

    const studyUID: string = folderUID_get(studyFolder, "Study");
    const seriesUID: string = folderUID_get(seriesFolder, "Series");

    const studies: Record<string, unknown>[] = studies_extractFromDecoded(decoded.json);
    const studyObj: Record<string, unknown> | undefined = study_findByUID(studies, studyUID);

    if (!studyObj) {
      errorStack.stack_push("error", `Study with UID ${studyUID} not found in query results.`);
      return Err();
    }

    const seriesArray: Record<string, unknown>[] = series_extractFromStudy(studyObj);
    const seriesObj: Record<string, unknown> | undefined = series_findByUID(seriesArray, seriesUID);

    if (!seriesObj) {
      errorStack.stack_push("error", `Series with UID ${seriesUID} not found in study results.`);
      return Err();
    }

    return Ok(JSON.stringify(seriesObj, null, 2));
  } catch (error: unknown) {
    const msg: string = error instanceof Error ? error.message : String(error);
    errorStack.stack_push("error", `PACS VFS read failed: ${msg}`);
    return Err();
  }
}

/**
 * Reads virtual file binary content under '/net/pacs'.
 *
 * @param pathStr - The absolute virtual path of the file to read.
 * @param queryResult_fetch - Callback to fetch decoded PACS query results (leveraging cache).
 * @returns Promise resolving to a Result containing the file contents as a Buffer.
 */
export async function pacsVfs_readBinary(
  pathStr: string,
  queryResult_fetch: (queryId: number) => Promise<PACSQueryDecodedResult | null>
): Promise<Result<Buffer>> {
  const res: Result<string> = await pacsVfs_read(pathStr, queryResult_fetch);
  if (res.ok) {
    return Ok(Buffer.from(res.value, "utf-8"));
  }
  return Err();
}
