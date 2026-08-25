/**
 * @file Pure helpers for the PACS VFS provider.
 *
 * The PACS path grammar in one place: query folders are named
 * `<desc>_qid:<id>[_<user>][_no-hits]`, study folders `Study_<uid>_<desc>`,
 * series folders `Series_<uid>_<desc>`. This module owns both directions,
 * building folder names and parsing them back, so a path a surface builds is
 * always the path the listing shows. Payload interpretation (tag values,
 * study/series arrays) lives in cumin's dicomPayload module and is re-exported
 * here for the provider's convenience. Dependency-light (cumin only) so these
 * load and unit-test without the provider's import cycle.
 *
 * @module
 */
import { Result, Ok, Err, errorStack } from "@fnndsc/cumin";
import { folderUID_get, queryId_extractFromFolder } from "./pacsGrammar.js";

export {
  tag_extractValue,
  studies_extractFromDecoded,
  series_extractFromStudy,
  study_findByUID,
  series_findByUID,
} from "@fnndsc/cumin";

/**
 * Normalizes a VFS path: guarantees a leading slash and strips one trailing
 * slash (the root path keeps its single slash).
 *
 * @param pathStr - Raw path string.
 * @returns The normalized absolute path.
 */
export function path_normalize(pathStr: string): string {
  let p: string = pathStr.startsWith("/") ? pathStr : "/" + pathStr;
  if (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1);
  return p;
}

export {
  queryId_extractFromFolder,
  queryLabel_extractFromFolder,
  folderUID_get,
  queryFolderName_build,
} from "./pacsGrammar.js";
export type { QueryFolderNameParts } from "./pacsGrammar.js";

/**
 * Parses a `cp` source path into its study, optional series, and query id.
 *
 * @param src - Source path naming a Study or Series directory under a query.
 * @returns The parsed identifiers, or Err with a rendered reason on the
 *   error stack when the path is not a copyable PACS location.
 */
export function cpSrc_parse(src: string): Result<{ studyUID: string; seriesUID?: string; queryId: number }> {
  const absolutePath: string = src.startsWith("/") ? src : "/" + src;
  const parts: string[] = absolutePath.split("/").filter(Boolean);

  // Locate the query folder by its `_qid:` marker rather than by position:
  // real listing paths are /net/pacs/queries/<qfolder>/Study_/Series_, and a
  // fixed-offset parse silently rejected every one of them.
  const queryIdx: number = parts.findIndex((part: string): boolean => /_qid:\d+/.test(part));
  if (queryIdx === -1 || parts.length < queryIdx + 2) {
    errorStack.stack_push("error", `cp: Copying from '${src}' is not supported. Please specify a Study or Series directory.`);
    return Err();
  }

  const studyFolder: string = parts[queryIdx + 1];
  if (!studyFolder.startsWith("Study_")) {
    errorStack.stack_push("error", `cp: Invalid PACS Study folder format: '${studyFolder}'`);
    return Err();
  }

  const studyUID: string = folderUID_get(studyFolder, "Study");

  let seriesUID: string | undefined;
  if (parts.length >= queryIdx + 3 && parts[queryIdx + 2].startsWith("Series_")) {
    seriesUID = folderUID_get(parts[queryIdx + 2], "Series");
  }

  const queryId: number = queryId_extractFromFolder(parts[queryIdx]);
  if (Number.isNaN(queryId)) {
    errorStack.stack_push("error", `cp: Invalid query ID in path '${src}'`);
    return Err();
  }

  return Ok({ studyUID, seriesUID, queryId });
}
