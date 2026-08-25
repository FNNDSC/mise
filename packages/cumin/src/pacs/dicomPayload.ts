/**
 * @file DICOM query-payload interpretation helpers.
 *
 * A decoded PACS query result arrives as loosely shaped JSON: studies under
 * one of several container keys, series likewise, and individual tag values
 * either bare or wrapped (`{value: ...}` from CUBE's decoder, `{Value: [...]}`
 * from DICOM-JSON). Four packages grew private copies of this interpretation,
 * each accepting a different subset of the shapes. This module is the one
 * home: every helper accepts the union of the shapes the copies handled.
 *
 * Key components:
 *   - tag_extractRaw / tag_extractValue: unwrap one tag value
 *   - studies_extractFromDecoded: locate the study array in a decoded payload
 *   - series_extractFromStudy: locate the series array in a study object
 *   - study_findByUID / series_findByUID: UID lookups over those arrays
 *
 * Dependencies: none — pure functions over unknown-shaped JSON.
 *
 * @module
 */

/**
 * Unwraps a potentially wrapped DICOM tag value, preserving its raw type.
 *
 * Accepts CUBE's `{value: ...}` decoder wrapper, the DICOM-JSON
 * `{Value: [...]}` wrapper (first element wins), or a bare value.
 *
 * @param val - Potentially wrapped tag value.
 * @returns The unwrapped value; undefined and null pass through unchanged.
 */
export function tag_extractRaw(val: unknown): unknown {
  if (val && typeof val === "object") {
    const record: Record<string, unknown> = val as Record<string, unknown>;
    if ("value" in record) return record.value;
    if (Array.isArray(record.Value) && record.Value.length > 0) return record.Value[0];
  }
  return val;
}

/**
 * Extracts a DICOM tag value as a string.
 *
 * @param val - Potentially wrapped tag value.
 * @returns The unwrapped value as a string; empty string for null/undefined.
 */
export function tag_extractValue(val: unknown): string {
  return String(tag_extractRaw(val) ?? "");
}

/**
 * Locates the study array inside a decoded PACS query payload.
 *
 * Probes the container keys the wire has been seen to use (`studies`,
 * `Studies`, `results`), falling back to treating the payload itself as the
 * study collection. A non-array collection is wrapped as a single study.
 *
 * @param decodedJson - The decoded query result payload.
 * @returns The study objects, in payload order. Never null; a payload with
 *   no recognizable studies yields a single-element wrap of the payload.
 */
export function studies_extractFromDecoded(decodedJson: unknown): Record<string, unknown>[] {
  let studiesObj: unknown;
  if (decodedJson && typeof decodedJson === "object" && !Array.isArray(decodedJson)) {
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

/**
 * Locates the series array inside one study object.
 *
 * Probes `series`, `Series`, `results`, and `data`; a study carrying none of
 * them has no series.
 *
 * @param studyObj - One study object from a decoded payload.
 * @returns The series objects, or an empty array.
 */
export function series_extractFromStudy(studyObj: Record<string, unknown>): Record<string, unknown>[] {
  const arr: unknown[] =
    Array.isArray(studyObj.series) ? studyObj.series :
    Array.isArray(studyObj.Series) ? studyObj.Series :
    Array.isArray(studyObj.results) ? studyObj.results :
    Array.isArray(studyObj.data) ? studyObj.data :
    [];
  return arr as Record<string, unknown>[];
}

/**
 * Finds a study by its StudyInstanceUID.
 *
 * @param studies - Study objects from studies_extractFromDecoded.
 * @param uid - The StudyInstanceUID to match.
 * @returns The matching study, or undefined.
 */
export function study_findByUID(studies: Record<string, unknown>[], uid: string): Record<string, unknown> | undefined {
  return studies.find((s: Record<string, unknown>) => {
    const sUID: string = tag_extractValue(s.StudyInstanceUID || s.uid);
    return sUID === uid;
  });
}

/**
 * Finds a series by its SeriesInstanceUID.
 *
 * @param seriesArr - Series objects from series_extractFromStudy.
 * @param uid - The SeriesInstanceUID to match.
 * @returns The matching series, or undefined.
 */
export function series_findByUID(seriesArr: Record<string, unknown>[], uid: string): Record<string, unknown> | undefined {
  return seriesArr.find((s: Record<string, unknown>) => {
    const sUID: string = tag_extractValue(s.SeriesInstanceUID || s.uid);
    return sUID === uid;
  });
}
