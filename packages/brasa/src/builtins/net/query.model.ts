/**
 * @file A decoded PACS answer, projected onto the wire's `pacs.query` model.
 *
 * Pure, and kept apart from the query verb, so anything that reads an
 * answer — the query itself, `gather add` filling in a series' facts —
 * builds the same rows from the same code.
 *
 * @module
 */
import type { PACSQueryDecodedResult } from '@fnndsc/cumin';
import type { PacsProvenance, PacsQueryModel, PacsStudy } from '@fnndsc/menu';

/**
 * Projects a decoded query result onto the wire's `pacs.query` model:
 * studies containing series, each series carrying its instance UID so a
 * surface can lower a selection straight to a pull.
 *
 * @param decoded - The decoded query payload.
 * @param facts - The query's identity facts.
 * @returns The typed model payload.
 */
export function pacsQueryModel_build(
  decoded: PACSQueryDecodedResult,
  facts: {
    queryId: number;
    vfsPath: string;
    pacsName: string;
    expression: string;
    /**
     * Where this answer came from. Said once here so chell's sentence and
     * argus's pill are the same fact rather than two guesses at it.
     */
    provenance?: PacsProvenance;
  },
): PacsQueryModel {
  const tagVal = (v: unknown): string => {
    if (v && typeof v === 'object' && 'value' in (v as Record<string, unknown>)) {
      return String((v as Record<string, unknown>).value ?? '');
    }
    return String(v ?? '');
  };
  const payload: unknown = decoded.json;
  const payloadArr: unknown[] = Array.isArray(payload) ? payload : payload ? [payload] : [];
  const studies: PacsStudy[] = [];
  for (const studyRaw of payloadArr) {
    if (!studyRaw || typeof studyRaw !== 'object') continue;
    const study: Record<string, unknown> = studyRaw as Record<string, unknown>;
    const seriesArr: unknown[] =
      Array.isArray(study.series) ? study.series :
      Array.isArray(study.Series) ? study.Series :
      Array.isArray(study.results) ? study.results :
      [];
    const studyUID: string = tagVal(study.StudyInstanceUID ?? '');
    const studyDesc: string = tagVal(study.StudyDescription ?? '');
    // The provider's folder grammar, mirrored: a path built here is a path
    // the VFS resolves, which is what makes a series row pullable.
    const studyFolder: string = `Study_${studyUID}_${studyDesc.replace(/[\s/]/g, '_')}`;
    const series: PacsStudy['series'] = [];
    for (const seriesRaw of seriesArr) {
      if (!seriesRaw || typeof seriesRaw !== 'object') continue;
      const one: Record<string, unknown> = seriesRaw as Record<string, unknown>;
      const files: number = parseInt(tagVal(one.NumberOfSeriesRelatedInstances ?? ''), 10);
      const seriesUID: string = tagVal(one.SeriesInstanceUID ?? '');
      const seriesDesc: string = tagVal(one.SeriesDescription ?? '');
      const seriesFolder: string = `Series_${seriesUID}_${seriesDesc.replace(/[\s/]/g, '_')}`;
      series.push({
        seriesUID,
        description: seriesDesc,
        modality: tagVal(one.Modality ?? ''),
        ...(Number.isFinite(files) ? { fileCount: files } : {}),
        ...(studyUID && seriesUID
          ? { vfsPath: `${facts.vfsPath}/${studyFolder}/${seriesFolder}` }
          : {}),
      });
    }
    studies.push({
      ...(studyUID ? { studyUID } : {}),
      ...(studyUID ? { vfsPath: `${facts.vfsPath}/${studyFolder}` } : {}),
      description: studyDesc,
      patientName: tagVal(study.PatientName ?? study.patient_name ?? ''),
      patientId: tagVal(study.PatientID ?? study.patient_id ?? ''),
      date: tagVal(study.StudyDate ?? ''),
      modalities: tagVal(study.ModalitiesInStudy ?? ''),
      accession: tagVal(study.AccessionNumber ?? ''),
      series,
    });
  }
  return { ...facts, studies };
}
