/**
 * @file Unit tests for a PACS answer rendered as CSV.
 *
 * The two claims worth pinning are the ones a naive renderer gets wrong: a
 * study description carrying a comma or a quote must survive the trip into
 * a spreadsheet, and a patient with NO studies must still appear — the
 * MRNs that come back are the ones with imaging, so a table built from
 * studies alone drops exactly the rows an audit is asking about.
 */
import { describe, it, expect } from '@jest/globals';
import { pacsAnswer_toCsv } from '../src/builtins/net/query.csv.js';

/** One study, with the fields the table reads. */
function study_make(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    description: 'Brain MRI',
    patientName: 'DOE^JANE',
    patientId: '1234',
    date: '20240101',
    modalities: 'MR',
    accession: 'A100',
    series: [{ seriesUID: 's1', description: 'T1', modality: 'MR' }],
    ...extra,
  };
}

/** A model with the given studies and patients. */
function model_make(extra: Record<string, unknown> = {}): never {
  return {
    queryId: 1, vfsPath: '/net/pacs/queries/x', pacsName: 'PACSDCM',
    expression: 'PatientID:1234', studies: [], ...extra,
  } as never;
}

/** The CSV split into rows of cells, quotes stripped. */
function rows_of(csv: string): string[][] {
  return csv.trimEnd().split('\n').map((line: string): string[] =>
    line.split('","').map((cell: string): string => cell.replace(/^"|"$/g, '')));
}

describe('pacsAnswer_toCsv', () => {
  it('heads the table with the columns the listing shows', () => {
    const [header] = rows_of(pacsAnswer_toCsv(model_make()));
    expect(header).toEqual([
      'MRN', 'PATIENT', 'SERVER', 'STATUS', 'STUDY', 'DATE',
      'ACCESSION', 'MODALITY', 'SERIES', 'ANSWERED',
    ]);
  });

  it('renders a study per row, naming the server that answered', () => {
    const csv: string = pacsAnswer_toCsv(model_make({ studies: [study_make()] }));
    const [, row] = rows_of(csv);
    expect(row).toEqual(['1234', 'DOE^JANE', 'PACSDCM', 'found', 'Brain MRI', '20240101',
      'A100', 'MR', '1', '']);
  });

  // The row that cannot be derived from studies, and the one an audit is
  // usually about.
  it('gives a patient with no imaging a row of its own', () => {
    const csv: string = pacsAnswer_toCsv(model_make({
      patients: [{ patientId: '9999', status: 'none', studyCount: 0, seriesCount: 0 }],
    }));
    const [, row] = rows_of(csv);
    expect(row[0]).toBe('9999');
    expect(row[3]).toBe('none');
    expect(row[8]).toBe('0');
  });

  it('distinguishes a patient nothing could be asked about', () => {
    const csv: string = pacsAnswer_toCsv(model_make({
      patients: [{ patientId: '9999', status: 'unasked', studyCount: 0, seriesCount: 0 }],
    }));
    expect(rows_of(csv)[1][3]).toBe('unasked');
  });

  it('carries each row\'s own answer time as a timestamp a spreadsheet can sort', () => {
    const csv: string = pacsAnswer_toCsv(model_make({
      studies: [study_make()],
      patients: [{
        patientId: '1234', status: 'found', studyCount: 1, seriesCount: 1,
        provenance: { replayed: true, answeredAt: '2026-06-14T09:22:00.000Z' },
      }],
    }));
    expect(rows_of(csv)[1][9]).toBe('2026-06-14T09:22:00.000Z');
  });

  // Where a naive renderer breaks: a study description is free text.
  it('survives a comma and a quote in a study description', () => {
    const csv: string = pacsAnswer_toCsv(model_make({
      studies: [study_make({ description: 'MRI BRAIN, W/ AND W/O "GAD"' })],
    }));
    const line: string = csv.trimEnd().split('\n')[1];
    expect(line).toContain('"MRI BRAIN, W/ AND W/O ""GAD"""');
    // Ten columns, whatever the text inside them.
    expect(line.split('","')).toHaveLength(10);
  });

  it('keeps a cohort\'s rows in the order the patients were asked', () => {
    const csv: string = pacsAnswer_toCsv(model_make({
      studies: [study_make({ patientId: '2' })],
      patients: [
        { patientId: '1', status: 'none', studyCount: 0, seriesCount: 0 },
        { patientId: '2', status: 'found', studyCount: 1, seriesCount: 1 },
        { patientId: '3', status: 'unasked', studyCount: 0, seriesCount: 0 },
      ],
    }));
    expect(rows_of(csv).slice(1).map((row: string[]): string => row[0])).toEqual(['1', '2', '3']);
  });

  it('renders an answer that found nothing as a header and no rows', () => {
    expect(rows_of(pacsAnswer_toCsv(model_make()))).toHaveLength(1);
  });
});
