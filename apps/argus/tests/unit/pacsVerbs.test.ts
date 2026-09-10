/**
 * @file A series that has landed says so on its own row.
 *
 * The defect these cover: a retrieve the wire reported done left the row
 * still offering PULL, because nothing wrote `pulled` on the surface and
 * only re-running the query brought a fresh answer. An operator pulled a
 * series, watched the bar fill, and was still offered the pull.
 *
 * Both rules are pure, so this needs neither a PACS nor a browser.
 *
 * @module
 */
import { describe, it, expect } from '@jest/globals';
import type { PacsQueryModel, PacsSeries } from '@fnndsc/menu';
import { seriesPulled_mark, seriesVerbs_offered } from '../../src/features/pacs/panel.js';

/** A series as the query model holds one. */
function series_make(extra: Partial<PacsSeries> = {}): PacsSeries {
  return { seriesUID: '1.2.3', description: 'AX T2', modality: 'MR', fileCount: 62, ...extra };
}

/** An answer holding one study of one series. */
function model_make(series: PacsSeries): PacsQueryModel {
  return {
    queryId: 1,
    vfsPath: '/net/pacs/queries/AccessionNumber:1_qid:1',
    pacsName: 'PACSDCM',
    expression: 'AccessionNumber:1',
    studies: [{ studyUID: '1.2', description: 'MR Brain', patientName: 'X', patientId: 'Y', date: '', modalities: 'MR', accession: '1', series: [series] }],
  } as PacsQueryModel;
}

describe('seriesVerbs_offered', () => {
  it('offers the pull, and nothing else, for a series not yet in CUBE', () => {
    expect(seriesVerbs_offered(series_make())).toEqual({ gather: false, image: false, pull: true });
  });

  it('offers the gather, and withdraws the pull, once the series is home', () => {
    expect(seriesVerbs_offered(series_make({ pulled: true }))).toEqual({ gather: true, image: false, pull: false });
  });

  it('offers the image only once CUBE has named the folder', () => {
    const home: PacsSeries = series_make({ pulled: true, folderPath: '/SERVICES/PACS/X/p/s' });
    expect(seriesVerbs_offered(home)).toEqual({ gather: true, image: true, pull: false });
  });
});

describe('seriesPulled_mark', () => {
  it('turns a landed series over, so its row stops offering the pull', () => {
    const series: PacsSeries = series_make();
    const model: PacsQueryModel = model_make(series);
    expect(seriesVerbs_offered(series).pull).toBe(true);

    expect(seriesPulled_mark(model, '1.2.3', 62)).toBe(true);

    expect(series.pulled).toBe(true);
    expect(series.pulledFiles).toBe(62);
    expect(seriesVerbs_offered(series)).toEqual({ gather: true, image: false, pull: false });
  });

  it('reports nothing changed for a series already home, so no repaint is asked for', () => {
    const model: PacsQueryModel = model_make(series_make({ pulled: true, pulledFiles: 62 }));
    expect(seriesPulled_mark(model, '1.2.3', 62)).toBe(false);
  });

  it('leaves a series the report does not name alone', () => {
    const series: PacsSeries = series_make();
    const model: PacsQueryModel = model_make(series);
    expect(seriesPulled_mark(model, '9.9.9', 10)).toBe(false);
    expect(series.pulled).toBeUndefined();
  });

  it('keeps a count it was not given rather than writing a zero', () => {
    const series: PacsSeries = series_make();
    const model: PacsQueryModel = model_make(series);
    seriesPulled_mark(model, '1.2.3', undefined);
    expect(series.pulled).toBe(true);
    expect(series.pulledFiles).toBeUndefined();
  });
});
