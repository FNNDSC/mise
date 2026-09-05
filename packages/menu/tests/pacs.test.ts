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
