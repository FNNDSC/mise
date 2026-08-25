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

export {
  tag_extractValue,
  studies_extractFromDecoded,
  series_extractFromStudy,
  study_findByUID,
  series_findByUID,
} from "@fnndsc/cumin";

export function path_normalize(pathStr: string): string {
  let p: string = pathStr.startsWith("/") ? pathStr : "/" + pathStr;
  if (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1);
  return p;
}

export function queryId_extractFromFolder(folder: string): number {
  const match: RegExpExecArray | null = /_qid:(\d+)/.exec(folder);
  return match ? Number(match[1]) : NaN;
}

/**
 * Extracts the descriptive label of a query folder, the part before its
 * `_qid:` marker (the id, user, and no-hits suffixes are all dropped).
 *
 * @param folder - Query folder name (`<desc>_qid:<id>[_<user>][_no-hits]`).
 * @returns The label, or the folder unchanged when it carries no marker.
 */
export function queryLabel_extractFromFolder(folder: string): string {
  return folder.replace(/_qid:\d+.*$/, "");
}

/**
 * Extracts the UID portion of a study or series folder name
 * (`<prefix>_<uid>_<label>`).
 *
 * @param folder - The folder name.
 * @param prefix - The expected prefix, `Study` or `Series`.
 * @returns The UID between the prefix and the first following underscore.
 */
export function folderUID_get(folder: string, prefix: string): string {
  const withoutPrefix: string = folder.replace(new RegExp(`^${prefix}_`), "");
  return withoutPrefix.split("_")[0];
}

/**
 * Everything that determines a query folder's name.
 *
 * @property queryId - The query's numeric id.
 * @property queryObj - The query's key-value search terms; blank values are
 *   skipped.
 * @property title - The query record's title, used as the description when
 *   queryObj yields nothing.
 * @property username - Owning username, appended as `_<user>` when present.
 * @property hasResult - Whether the query holds a result payload; false
 *   appends the `_no-hits` suffix. Defaults to true.
 */
export interface QueryFolderNameParts {
  queryId: number | string;
  queryObj: Record<string, unknown>;
  title?: string;
  username?: string;
  hasResult?: boolean;
}

/**
 * Builds a query folder name: `<desc>_qid:<id>[_<user>][_no-hits]`.
 *
 * This is the single naming authority: the listing provider and any surface
 * that pre-computes a query's path must both use it, otherwise a freshly
 * created query can be addressed by a name `ls` will never show.
 *
 * @param parts - The name's inputs. See QueryFolderNameParts.
 * @returns The folder name (no leading path).
 */
export function queryFolderName_build(parts: QueryFolderNameParts): string {
  const segments: string[] = [];
  for (const [k, v] of Object.entries(parts.queryObj)) {
    if (v !== undefined && v !== null && String(v).trim().length > 0) segments.push(`${k}:${v}`);
  }
  let desc: string = segments.join("_");
  if (!desc) {
    const title: string = parts.title ?? "";
    desc = title
      ? title.replace(/^pacs_query_\d+_\d+$/, "query").replace(/^pacs_query_/, "")
      : "query";
    if (!desc) desc = "query";
  }
  const userSuffix: string = parts.username ? `_${parts.username}` : "";
  const noHitsSuffix: string = parts.hasResult === false ? "_no-hits" : "";
  return `${desc}_qid:${parts.queryId}${userSuffix}${noHitsSuffix}`;
}

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
