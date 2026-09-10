import { jest, describe, it, expect } from '@jest/globals';

jest.unstable_mockModule('@fnndsc/cumin', () => ({
  seriesStorage_resolve: jest.fn(async () => ({ ok: false })),
  seriesStorage_resolveMany: jest.fn(async () => ({ ok: true, value: new Map() })),
  tag_extractValue: (v) => (v && typeof v === 'object' && 'value' in v ? String(v.value ?? '') : String(v ?? '')),
  studies_extractFromDecoded: jest.fn(() => []),
  series_extractFromStudy: jest.fn(() => []),
  errorStack: { stack_getAll: jest.fn(() => []), stack_push: jest.fn(), stack_pop: jest.fn(), checkpoint_mark: jest.fn(() => 1), checkpoint_drain: jest.fn(() => []) },
  Ok: (value: unknown) => ({ ok: true, value }),
  Err: () => ({ ok: false }),
  chrisContext: { current_get: jest.fn() },
  Context: {},
  pacsQuery_get: jest.fn(),
  pacsQuery_resultDecode: jest.fn(),
  pacsQueries_create: jest.fn(),
  pacsServers_list: jest.fn(),
  envelope_ok: (rendered: string, model?: unknown) => ({ status: 'ok', rendered, model }),
  envelope_error: (rendered: string, _e?: unknown, renderedErr?: string) => ({ status: 'error', rendered, renderedErr }),
  listCache_get: jest.fn(() => ({ cache_set: jest.fn() })),
  queryIndex_get: jest.fn(() => ({ entry_note: jest.fn(), entry_find: jest.fn(() => null) })),
}));
jest.unstable_mockModule('@fnndsc/salsa', () => ({ queryId_extractFromFolder: jest.fn(), queryLabel_extractFromFolder: jest.fn(), folderUID_get: jest.fn(), queryFolderName_build: jest.fn(), answer_standIn: (v: unknown) => v, criteria_standIn: (c: Record<string, string>) => c }));
jest.unstable_mockModule('@fnndsc/chili/screen/screen.js', () => ({ screen: { table_output: jest.fn(() => '') } }));
jest.unstable_mockModule('../src/lib/spinner.js', () => ({
  spinner: { start: jest.fn(), stop: jest.fn(), updateMessage: jest.fn() },
}));

const { pacsQueryModel_build, pulledFilters_of } = await import('../src/builtins/net/query.js');

describe('pacsQueryModel_build', () => {
  it('projects studies and series with UIDs and pullable VFS paths', () => {
    const decoded = {
      raw: '',
      json: [{
        StudyInstanceUID: { value: '1.2.3' },
        StudyDescription: { value: 'Brain MR' },
        PatientName: { value: 'DOE^JANE' },
        PatientID: { value: '4453422' },
        StudyDate: { value: '20260801' },
        ModalitiesInStudy: { value: 'MR' },
        AccessionNumber: { value: 'A99' },
        series: [{
          SeriesInstanceUID: { value: '1.2.3.4' },
          SeriesDescription: { value: 'AX T2 FLAIR' },
          Modality: { value: 'MR' },
          NumberOfSeriesRelatedInstances: { value: '674' },
        }],
      }],
    };

    const model = pacsQueryModel_build(decoded, {
      queryId: 42,
      vfsPath: '/net/pacs/queries/42_test',
      pacsName: 'PACSDCM',
      expression: 'PatientID:4453422',
    });

    expect(model.queryId).toBe(42);
    expect(model.studies).toHaveLength(1);
    const study = model.studies[0]!;
    expect(study).toMatchObject({ studyUID: '1.2.3', patientId: '4453422', date: '20260801' });
    const series = study.series[0]!;
    expect(series).toMatchObject({ seriesUID: '1.2.3.4', modality: 'MR', fileCount: 674 });
    expect(series.vfsPath).toBe(
      '/net/pacs/queries/42_test/Study_1.2.3_Brain_MR/Series_1.2.3.4_AX_T2_FLAIR',
    );
  });

  it('carries an empty study list when nothing matched', () => {
    const model = pacsQueryModel_build({ raw: '' }, {
      queryId: 7, vfsPath: '/net/pacs/queries/7_x', pacsName: 'P', expression: 'PatientID:0',
    });
    expect(model.studies).toEqual([]);
  });
});

/**
 * The shape of the asking, not just its answer.
 *
 * Reconciling an answer against what CUBE already holds used to ask about
 * every series in turn, two round trips each, and a patient's history of
 * 299 series cost twenty seconds — which is what made a REPLAYED query feel
 * exactly like a fresh one. CUBE indexes a stored series by its study, so
 * the asking is one question per study. An answer built the slow way looks
 * identical, so what is pinned here is the question count.
 */
describe('pulledFilters_of', () => {
  /** An answer of `studies` studies, each holding `series` series. */
  const answer_of = (studies: number, series: number, uid: (i: number) => string | undefined) => ({
    studies: Array.from({ length: studies }, (_u: unknown, s: number) => ({
      studyUID: uid(s),
      series: Array.from({ length: series }, (_v: unknown, i: number) => ({ seriesUID: `${s}.${i}` })),
    })),
  });

  it('asks once per study, however many series each holds', () => {
    const filters = pulledFilters_of(answer_of(20, 15, (s: number) => `9.${s}`) as never);
    // Twenty studies, 300 series, twenty questions.
    expect(filters).toHaveLength(20);
    expect(filters[0]).toEqual({ StudyInstanceUID: '9.0' });
    expect(filters[19]).toEqual({ StudyInstanceUID: '9.19' });
  });

  it('leaves out a study the answer does not name, since it cannot be asked about in bulk', () => {
    const filters = pulledFilters_of(answer_of(3, 2, (s: number) => (s === 1 ? undefined : `9.${s}`)) as never);
    expect(filters).toEqual([{ StudyInstanceUID: '9.0' }, { StudyInstanceUID: '9.2' }]);
  });

  it('treats an empty UID as no UID, rather than asking CUBE about nothing', () => {
    const filters = pulledFilters_of(answer_of(2, 1, (s: number) => (s === 0 ? '' : '9.1')) as never);
    expect(filters).toEqual([{ StudyInstanceUID: '9.1' }]);
  });
});
