/**
 * @file Schema tests for the PACS query vocabulary.
 *
 * The provenance field is the point of these: whether an answer came from
 * the PACS or from a query already stored is a fact about the answer, and
 * it has to survive the wire in a shape every surface can read the same
 * way — including a surface talking to a daemon that predates it.
 */

import { describe, it, expect } from '@jest/globals';
import {
  pacsQueryModelSchema,
  pacsProvenanceSchema,
  pacsPatientSchema,
  type PacsQueryModel,
} from '../src/pacs.js';

/** A minimal well-formed model. */
function model_make(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    queryId: 2661,
    vfsPath: '/net/pacs/queries/AccessionNumber:22119730_qid:2661',
    pacsName: 'PACSDCM',
    expression: 'AccessionNumber:22119730',
    studies: [],
    ...extra,
  };
}

describe('pacsProvenanceSchema', () => {
  it('carries whether the answer was replayed and when it was answered', () => {
    const parsed = pacsProvenanceSchema.safeParse({
      replayed: true,
      answeredAt: '2026-06-14T09:22:00.000Z',
    });
    expect(parsed.success).toBe(true);
  });

  it('refuses a provenance missing either half', () => {
    expect(pacsProvenanceSchema.safeParse({ replayed: true }).success).toBe(false);
    expect(pacsProvenanceSchema.safeParse({ answeredAt: '2026-06-14' }).success).toBe(false);
  });
});

describe('pacsQueryModelSchema', () => {
  it('accepts a model carrying provenance', () => {
    const parsed = pacsQueryModelSchema.safeParse(model_make({
      provenance: { replayed: true, answeredAt: '2026-06-14T09:22:00.000Z' },
    }));
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      const model: PacsQueryModel = parsed.data;
      expect(model.provenance?.replayed).toBe(true);
    }
  });

  it('still accepts an envelope from a daemon that predates replay', () => {
    const parsed = pacsQueryModelSchema.safeParse(model_make());
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.provenance).toBeUndefined();
  });

  it('distinguishes a fresh answer from a replayed one by the model alone', () => {
    const fresh = pacsQueryModelSchema.parse(model_make({
      provenance: { replayed: false, answeredAt: '2026-09-05T10:00:00.000Z' },
    }));
    const replayed = pacsQueryModelSchema.parse(model_make({
      provenance: { replayed: true, answeredAt: '2026-06-14T09:22:00.000Z' },
    }));
    expect(fresh.provenance?.replayed).toBe(false);
    expect(replayed.provenance?.replayed).toBe(true);
  });

  it('refuses a malformed provenance rather than dropping it silently', () => {
    const parsed = pacsQueryModelSchema.safeParse(model_make({
      provenance: { replayed: 'yes', answeredAt: 1 },
    }));
    expect(parsed.success).toBe(false);
  });
});

describe('pacsPatientSchema', () => {
  /** A minimal well-formed patient row. */
  function patient_make(extra: Record<string, unknown> = {}): Record<string, unknown> {
    return { patientId: '1234567', status: 'found', studyCount: 2, seriesCount: 9, ...extra };
  }

  it('records a patient that was found, with counts an audit reads without unfolding', () => {
    const parsed = pacsPatientSchema.safeParse(patient_make({ patientName: 'DOE^JANE' }));
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.status).toBe('found');
      expect(parsed.data.studyCount).toBe(2);
    }
  });

  // The three states are the point of the level: a patient with no imaging
  // and a patient nothing could be asked about are different answers, and
  // only one of them is a zero.
  it('distinguishes a miss from a query that could not be asked', () => {
    const none = pacsPatientSchema.parse(patient_make({ status: 'none', studyCount: 0, seriesCount: 0 }));
    const unasked = pacsPatientSchema.parse(patient_make({
      status: 'unasked', studyCount: 0, seriesCount: 0, error: 'PACS timed out',
    }));
    expect(none.status).toBe('none');
    expect(none.error).toBeUndefined();
    expect(unasked.status).toBe('unasked');
    expect(unasked.error).toBe('PACS timed out');
  });

  // Degrading to `found` or `none` would let a newer daemon's state read as
  // a confident answer this contract never received.
  it('degrades an unrecognized status to unasked, never to an answer', () => {
    expect(pacsPatientSchema.parse(patient_make({ status: 'partial' })).status).toBe('unasked');
  });

  it('carries the query that answered for it, and that answer\'s provenance', () => {
    const patient = pacsPatientSchema.parse(patient_make({
      queryId: 2661,
      provenance: { replayed: true, answeredAt: '2026-06-14T09:22:00.000Z' },
    }));
    expect(patient.queryId).toBe(2661);
    expect(patient.provenance?.replayed).toBe(true);
  });

  it('refuses a row without the counts an audit is read from', () => {
    expect(pacsPatientSchema.safeParse({ patientId: '1', status: 'found' }).success).toBe(false);
    expect(pacsPatientSchema.safeParse({ status: 'found', studyCount: 0, seriesCount: 0 }).success).toBe(false);
  });
});

describe('pacsQueryModelSchema with a cohort', () => {
  it('expresses a cohort: hits, misses and failures all readable from the model', () => {
    const model: PacsQueryModel = pacsQueryModelSchema.parse(model_make({
      patients: [
        { patientId: '1', status: 'found', studyCount: 3, seriesCount: 12, queryId: 10 },
        { patientId: '2', status: 'none', studyCount: 0, seriesCount: 0, queryId: 11 },
        { patientId: '3', status: 'unasked', studyCount: 0, seriesCount: 0, error: 'no route to PACS' },
      ],
    }));
    const tally = (state: string): number =>
      (model.patients ?? []).filter((patient): boolean => patient.status === state).length;
    expect(tally('found')).toBe(1);
    expect(tally('none')).toBe(1);
    expect(tally('unasked')).toBe(1);
    // The counts a surface reads out are derived, so they cannot disagree
    // with the rows they summarise.
    expect((model.patients ?? []).length).toBe(3);
  });

  it('mixes replayed and freshly asked rows in one answer', () => {
    const model: PacsQueryModel = pacsQueryModelSchema.parse(model_make({
      patients: [
        { patientId: '1', status: 'found', studyCount: 1, seriesCount: 2,
          provenance: { replayed: true, answeredAt: '2026-06-14T09:22:00.000Z' } },
        { patientId: '2', status: 'found', studyCount: 1, seriesCount: 4,
          provenance: { replayed: false, answeredAt: '2026-09-06T10:00:00.000Z' } },
      ],
    }));
    expect(model.patients?.map((patient): boolean | undefined => patient.provenance?.replayed))
      .toEqual([true, false]);
  });

  it('still accepts an envelope from a daemon that predates the fan-out', () => {
    const model: PacsQueryModel = pacsQueryModelSchema.parse(model_make());
    expect(model.patients).toBeUndefined();
  });

  it('refuses a malformed patient rather than dropping the row', () => {
    expect(pacsQueryModelSchema.safeParse(model_make({
      patients: [{ patientId: '1', status: 'found' }],
    })).success).toBe(false);
  });
});

describe('a query across several servers', () => {
  it('names the PACS that answered for a study', () => {
    const model: PacsQueryModel = pacsQueryModelSchema.parse(model_make({
      studies: [{
        server: 'PACSDCM', description: 'Brain', patientName: 'DOE^JANE', patientId: '1',
        date: '20240101', modalities: 'MR', accession: 'A1', series: [],
      }],
    }));
    expect(model.studies[0].server).toBe('PACSDCM');
  });

  // One patient asked of two servers is two rows: the answers are two
  // facts, and one of them may be a miss while the other is not.
  it('carries one patient row per server asked', () => {
    const model: PacsQueryModel = pacsQueryModelSchema.parse(model_make({
      patients: [
        { patientId: '1', server: 'PACSDCM', status: 'found', studyCount: 2, seriesCount: 8 },
        { patientId: '1', server: 'ORTHANC', status: 'none', studyCount: 0, seriesCount: 0 },
      ],
    }));
    expect(model.patients?.map((patient) => `${patient.server}:${patient.status}`))
      .toEqual(['PACSDCM:found', 'ORTHANC:none']);
  });

  it('still parses a single-server answer, which names no server at all', () => {
    const model: PacsQueryModel = pacsQueryModelSchema.parse(model_make({
      patients: [{ patientId: '1', status: 'found', studyCount: 1, seriesCount: 1 }],
    }));
    expect(model.patients?.[0].server).toBeUndefined();
  });
});
