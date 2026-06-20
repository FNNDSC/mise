/**
 * @file Pure rendering of PACS query result payloads into a human-readable,
 * indented study/series listing.
 *
 * The CUBE PACS query result is a loosely-typed nested structure; these helpers
 * extract DICOM tag values defensively and format them. Dependency-free for
 * easy unit testing.
 *
 * @module
 */

/** A resolved DICOM tag (label + value). */
interface RenderedTag {
  label: string;
  value: unknown;
}

const STUDY_FIELD_ORDER: string[] = [
  "AccessionNumber",
  "PatientName",
  "PatientID",
  "PatientBirthDate",
  "PatientSex",
  "StudyDate",
  "StudyDescription",
  "StudyInstanceUID",
  "ModalitiesInStudy",
  "NumberOfStudyRelatedSeries",
  "NumberOfStudyRelatedInstances",
  "RetrieveAETitle",
  "status",
  "QueryRetrieveLevel",
];

const SERIES_FIELD_ORDER: string[] = [
  "SeriesDescription",
  "Modality",
  "SeriesInstanceUID",
  "NumberOfSeriesRelatedInstances",
  "InstanceNumber",
  "PerformedStationAETitle",
  "RetrieveLevel",
  "status",
  "uid",
];

/**
 * Extracts a `{ label, value }` DICOM tag from a value if it has the tag shape.
 *
 * @param val - A candidate tag value.
 * @returns The resolved tag, or null if it is not tag-shaped.
 */
function tag_extract(val: unknown): RenderedTag | null {
  if (val && typeof val === "object" && "value" in (val as Record<string, unknown>)) {
    const tagObj: { label?: unknown; value?: unknown } = val as { label?: unknown; value?: unknown };
    const label: string =
      typeof tagObj.label === "string" && tagObj.label.length ? tagObj.label : "";
    return { label, value: tagObj.value };
  }
  return null;
}

/**
 * Extracts displayable fields from an object, preferring a given key order and
 * optionally including all remaining scalar/tag keys. De-duplicates by label.
 *
 * @param obj - The source object.
 * @param preferredOrder - Keys to emit first, in order.
 * @param includeAll - Whether to also include remaining keys.
 * @returns The collected fields.
 */
function fields_extract(
  obj: Record<string, unknown>,
  preferredOrder: string[],
  includeAll: boolean
): RenderedTag[] {
  const collected: RenderedTag[] = [];
  const seen: Set<string> = new Set<string>();

  const field_push = (label: string, value: unknown): void => {
    if (label && !seen.has(label)) {
      collected.push({ label, value });
      seen.add(label);
    }
  };

  const keys_scan = (keys: Iterable<string>): void => {
    for (const key of keys) {
      const val: unknown = obj[key];
      if (Array.isArray(val)) continue;
      const tagVal: RenderedTag | null = tag_extract(val);
      if (tagVal) {
        field_push(tagVal.label || key, tagVal.value);
      } else if (typeof val === "string" || typeof val === "number" || typeof val === "boolean") {
        field_push(key, val);
      }
    }
  };

  keys_scan(preferredOrder);
  if (includeAll) {
    keys_scan(Object.keys(obj));
  }
  return collected;
}

/**
 * Renders one study (and its nested series) into indented output lines.
 *
 * @param studyIdx - Zero-based study index.
 * @param studyObj - The study object.
 * @returns The rendered lines for this study.
 */
function study_renderLines(studyIdx: number, studyObj: Record<string, unknown>): string[] {
  const lines: string[] = [];
  const seriesArr: unknown[] | null =
    Array.isArray(studyObj['series']) ? (studyObj['series'] as unknown[]) :
    Array.isArray(studyObj['Series']) ? (studyObj['Series'] as unknown[]) :
    Array.isArray(studyObj['results']) ? (studyObj['results'] as unknown[]) :
    Array.isArray(studyObj['data']) ? (studyObj['data'] as unknown[]) :
    null;

  const studyFields: RenderedTag[] = fields_extract(studyObj, STUDY_FIELD_ORDER, true);
  lines.push(`Study ${studyIdx + 1}`);
  studyFields.forEach((f) => lines.push(`  ${f.label}: ${f.value as string}`));

  if (seriesArr && seriesArr.length) {
    seriesArr.forEach((series, idx) => {
      if (!series || typeof series !== "object") return;
      const seriesFields: RenderedTag[] = fields_extract(series as Record<string, unknown>, SERIES_FIELD_ORDER, false);
      lines.push(`  Series ${idx + 1}`);
      seriesFields.forEach((f) => lines.push(`    ${f.label}: ${f.value as string}`));
    });
  }
  lines.push("");
  return lines;
}

/**
 * Renders a PACS query result payload into a human-readable string.
 *
 * Accepts a single study object or an array of studies; each study may carry a
 * nested series array under `series`/`Series`/`results`/`data`.
 *
 * @param payload - The PACS query result payload.
 * @returns The formatted listing, or null if there is nothing to render.
 */
export function pacsQueryResult_renderPretty(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const payloadArray: unknown[] = Array.isArray(payload) ? (payload as unknown[]) : [payload];
  const lines: string[] = [];
  payloadArray.forEach((item: unknown, idx: number) => {
    if (item && typeof item === "object") {
      lines.push(...study_renderLines(idx, item as Record<string, unknown>));
    }
  });

  const output: string = lines.join("\n").trim();
  return output.length ? output : null;
}
