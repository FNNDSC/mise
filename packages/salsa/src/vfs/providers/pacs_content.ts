/**
 * @file PACS VFS Content Handler.
 *
 * Implements specialized virtual file reading and content generation
 * for PACS queries metadata.json and image_slices.dcm.
 *
 * @module
 */

import { Result, Ok, Err, errorStack, PACSQueryDecodedResult } from "@fnndsc/cumin";

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
    let effectivePath = pathStr.startsWith("/") ? pathStr : "/" + pathStr;
    if (effectivePath.length > 1 && effectivePath.endsWith("/")) {
      effectivePath = effectivePath.slice(0, -1);
    }

    const parts = effectivePath.split("/").filter(Boolean);
    if (parts.length !== 7 || parts[0] !== "net" || parts[1] !== "pacs" || parts[2] !== "queries") {
      errorStack.stack_push("error", `File not found: ${pathStr}`);
      return Err();
    }

    const queryFolder = parts[3];
    const studyFolder = parts[4];
    const seriesFolder = parts[5];
    const filename = parts[6];

    const queryId = Number(queryFolder.split("_")[0]);
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

    // Fetch decoded query results
    const decoded = await queryResult_fetch(queryId);
    if (!decoded || !decoded.json) {
      errorStack.stack_push("error", `PACS query ${queryId} has no result payload.`);
      return Err();
    }

    const studyUID = studyFolder.replace(/^Study_/, "").split("_")[0];
    const seriesUID = seriesFolder.replace(/^Series_/, "").split("_")[0];

    // Extract study object
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
      errorStack.stack_push("error", `Study with UID ${studyUID} not found in query results.`);
      return Err();
    }

    // Extract series object
    const seriesArray: unknown[] =
      Array.isArray(studyObj.series) ? studyObj.series :
      Array.isArray(studyObj.Series) ? studyObj.Series :
      Array.isArray(studyObj.results) ? studyObj.results :
      Array.isArray(studyObj.data) ? studyObj.data :
      [];

    const seriesObj = (seriesArray as Record<string, unknown>[]).find((s: Record<string, unknown>) => {
      const sUID = pacs_tagValueExtract(s.SeriesInstanceUID || s.uid);
      return sUID === seriesUID;
    });

    if (!seriesObj) {
      errorStack.stack_push("error", `Series with UID ${seriesUID} not found in study results.`);
      return Err();
    }

    return Ok(JSON.stringify(seriesObj, null, 2));
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
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
  const res = await pacsVfs_read(pathStr, queryResult_fetch);
  if (res.ok) {
    return Ok(Buffer.from(res.value, "utf-8"));
  }
  return Err();
}
