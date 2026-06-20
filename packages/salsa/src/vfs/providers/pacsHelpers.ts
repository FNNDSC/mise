/**
 * @file Pure helpers for the PACS VFS provider.
 *
 * Tag extraction, path/query parsing, and study/series lookup — dependency-light
 * (cumin only) so they load and unit-test without the provider's import cycle.
 *
 * @module
 */
import { Result, Ok, Err, errorStack } from "@fnndsc/cumin";

/**
 * Safely extracts a string value from a potentially object-wrapped DICOM tag.
 *
 * @param val - Potentially object-wrapped DICOM tag or raw string.
 * @returns The string value of the DICOM tag.
 */
export function tag_extractValue(val: unknown): string {
  if (val && typeof val === "object") {
    const record: Record<string, unknown> = val as Record<string, unknown>;
    if ("value" in record) {
      return String(record.value ?? "");
    }
  }
  return String(val ?? "");
}

export function path_normalize(pathStr: string): string {
  let p: string = pathStr.startsWith("/") ? pathStr : "/" + pathStr;
  if (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1);
  return p;
}

export function queryId_extractFromFolder(folder: string): number {
  const match: RegExpExecArray | null = /_qid:(\d+)/.exec(folder);
  return match ? Number(match[1]) : NaN;
}

export function studies_extractFromDecoded(decodedJson: unknown): Record<string, unknown>[] {
  let studiesObj: unknown;
  if (decodedJson && typeof decodedJson === "object") {
    const record: Record<string, unknown> = decodedJson as Record<string, unknown>;
    if ("studies" in record) studiesObj = record.studies;
    else if ("Studies" in record) studiesObj = record.Studies;
    else if ("results" in record) studiesObj = record.results;
    else studiesObj = decodedJson;
  } else {
    studiesObj = decodedJson;
  }
  const arr: unknown[] = Array.isArray(studiesObj) ? studiesObj : [studiesObj];
  return arr as Record<string, unknown>[];
}

export function series_extractFromStudy(studyObj: Record<string, unknown>): Record<string, unknown>[] {
  const arr: unknown[] =
    Array.isArray(studyObj.series) ? studyObj.series :
    Array.isArray(studyObj.Series) ? studyObj.Series :
    Array.isArray(studyObj.results) ? studyObj.results :
    Array.isArray(studyObj.data) ? studyObj.data :
    [];
  return arr as Record<string, unknown>[];
}

export function study_findByUID(studies: Record<string, unknown>[], uid: string): Record<string, unknown> | undefined {
  return studies.find((s: Record<string, unknown>) => {
    const sUID: string = tag_extractValue(s.StudyInstanceUID || s.uid);
    return sUID === uid;
  });
}

export function series_findByUID(seriesArr: Record<string, unknown>[], uid: string): Record<string, unknown> | undefined {
  return seriesArr.find((s: Record<string, unknown>) => {
    const sUID: string = tag_extractValue(s.SeriesInstanceUID || s.uid);
    return sUID === uid;
  });
}

export function cpSrc_parse(src: string): Result<{ studyUID: string; seriesUID?: string; queryId: number }> {
  const absolutePath: string = src.startsWith("/") ? src : "/" + src;
  const parts: string[] = absolutePath.split("/").filter(Boolean);

  if (parts.length < 4) {
    errorStack.stack_push("error", `cp: Copying from '${src}' is not supported. Please specify a Study or Series directory.`);
    return Err();
  }

  const studyFolder: string = parts[3];
  if (!studyFolder.startsWith("Study_")) {
    errorStack.stack_push("error", `cp: Invalid PACS Study folder format: '${studyFolder}'`);
    return Err();
  }

  const studyUID: string = studyFolder.replace(/^Study_/, "").split("_")[0];

  let seriesUID: string | undefined;
  if (parts.length >= 5 && parts[4].startsWith("Series_")) {
    seriesUID = parts[4].replace(/^Series_/, "").split("_")[0];
  }

  const queryId: number = queryId_extractFromFolder(parts[2]);
  if (Number.isNaN(queryId)) {
    errorStack.stack_push("error", `cp: Invalid query ID in path '${src}'`);
    return Err();
  }

  return Ok({ studyUID, seriesUID, queryId });
}
