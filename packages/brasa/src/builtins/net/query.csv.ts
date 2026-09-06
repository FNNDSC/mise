/**
 * @file A PACS answer as a table a spreadsheet can read.
 *
 * There has been a `--csv` on listings since chili, and it renders the same
 * way this does — headers uppercased, every cell quoted, embedded quotes
 * doubled — but it renders it inside a chili handler rather than from a
 * function anything else can call. Rather than grow a dependency on a
 * package the stack is trying to shed, the rule is stated here, once, and
 * the PACS answer is the first thing to use it.
 *
 * The shape is settled by doctrine rather than by convenience: a row per
 * STUDY, and a row for every patient that owns none. The MRNs that come
 * back are the ones with imaging, so a table built from studies alone
 * would quietly drop exactly the rows an audit is asking about.
 *
 * @module
 */
import type { PacsPatient, PacsQueryModel, PacsStudy } from '@fnndsc/menu';

/** The columns of a PACS answer's table, in reading order. */
const CSV_COLUMNS: ReadonlyArray<string> = [
  'MRN', 'PATIENT', 'SERVER', 'STATUS', 'STUDY', 'DATE',
  'ACCESSION', 'MODALITY', 'SERIES', 'ANSWERED',
];

/**
 * Quotes one cell.
 *
 * Everything is quoted, including numbers: a study description carrying a
 * comma is the ordinary case, not the edge one, and a renderer that quotes
 * only when it thinks it must is a renderer that will one day think wrong.
 *
 * @param value - The cell's value.
 * @returns The quoted cell.
 */
function cell_quote(value: unknown): string {
  return `"${String(value ?? '').split('"').join('""')}"`;
}

/**
 * Renders one answer as CSV.
 *
 * ANSWERED carries the ISO timestamp rather than `3 MONTHS AGO`: a
 * spreadsheet sorts and subtracts dates, and the phrase a surface reads out
 * is for a human glance, not for a column of data.
 *
 * @param model - The answer.
 * @returns The CSV text, header row first.
 */
export function pacsAnswer_toCsv(model: PacsQueryModel): string {
  const rows: string[][] = [];
  const patients: ReadonlyArray<PacsPatient> = model.patients ?? [];
  const studiesOf = (patient: PacsPatient): PacsStudy[] =>
    model.studies.filter((study: PacsStudy): boolean =>
      study.patientId === patient.patientId
      && (patient.server === undefined || study.server === undefined || study.server === patient.server));

  const study_row = (
    study: PacsStudy,
    facts: { mrn: string; server: string; status: string; answeredAt: string },
  ): string[] => [
    facts.mrn,
    study.patientName,
    facts.server,
    facts.status,
    study.description,
    study.date,
    study.accession,
    study.modalities,
    String(study.series.length),
    facts.answeredAt,
  ];

  if (patients.length > 0) {
    for (const patient of patients) {
      const server: string = patient.server ?? model.pacsName;
      const answeredAt: string = patient.provenance?.answeredAt ?? '';
      const owned: PacsStudy[] = studiesOf(patient);
      if (owned.length === 0) {
        // The row that cannot be derived from studies, and the one an
        // audit is usually about: a patient with no imaging, or one whose
        // question could not be asked at all.
        rows.push([
          patient.patientId, patient.patientName ?? '', server, patient.status,
          '', '', '', '', '0', answeredAt,
        ]);
        continue;
      }
      for (const study of owned) {
        rows.push(study_row(study, {
          mrn: patient.patientId, server, status: patient.status, answeredAt,
        }));
      }
    }
  } else {
    for (const study of model.studies) {
      rows.push(study_row(study, {
        mrn: study.patientId,
        server: study.server ?? model.pacsName,
        status: 'found',
        answeredAt: model.provenance?.answeredAt ?? '',
      }));
    }
  }

  const lines: string[] = [CSV_COLUMNS.map(cell_quote).join(',')];
  for (const row of rows) lines.push(row.map(cell_quote).join(','));
  return `${lines.join('\n')}\n`;
}
