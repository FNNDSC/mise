/**
 * @file Unit tests for the PACS query sweep.
 *
 * The sweep is the reason the index can exist at all: CUBE cannot be asked
 * which query had given criteria, so the collection is walked once. What
 * matters here is that it walks it *all* — a sweep that quietly stopped at
 * the first page would rebuild the very defect this replaces (#401) — and
 * that when a bound does stop it, it says so.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';

/** Typed loosely on purpose: the mock stands in for one CUBE call. */
type PageAnswer = { ok: boolean; value?: { tableData: Record<string, unknown>[] } };
const pacsQueries_listMock = jest.fn<(options?: Record<string, unknown>) => Promise<PageAnswer>>();

jest.mock('../src/pacs/chrisPACS', () => ({
  pacsQueries_list: (options?: Record<string, unknown>): Promise<PageAnswer> =>
    pacsQueries_listMock(options),
}));

import {
  queryIndex_sweep,
  queryIndex_note,
  queryRow_toEntry,
  QUERY_SWEEP_PAGE,
  type QuerySweepResult,
} from '../src/pacs/queryIndexSweep.js';
import { queryIndex_get, type QueryIndexEntry } from '../src/cache/queryIndex.js';
import type { Result } from '../src/utils/result.js';

/** One row of the `pacs/queries` collection. */
function row_make(id: number, criteria: Record<string, string>, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    creation_date: `2026-09-0${(id % 9) + 1}T00:00:00.000Z`,
    query: JSON.stringify(criteria),
    status: 'succeeded',
    pacs_identifier: 'PACSDCM',
    owner_username: 'someone',
    result: 'eJzT0yMA',
    ...extra,
  };
}

/** Answers the mock with one page. */
function page_of(rows: Record<string, unknown>[]): PageAnswer {
  return { ok: true, value: { tableData: rows } };
}

describe('queryRow_toEntry', () => {
  it('reads a record into an entry', () => {
    const entry: QueryIndexEntry | null = queryRow_toEntry(row_make(7, { PatientID: '1' }));
    expect(entry?.queryId).toBe(7);
    expect(entry?.server).toBe('PACSDCM');
    expect(entry?.criteria).toEqual({ PatientID: '1' });
    expect(entry?.hasResult).toBe(true);
  });

  it('marks a record with no stored result as a no-hit rather than dropping it', () => {
    const entry: QueryIndexEntry | null = queryRow_toEntry(row_make(8, { PatientID: '2' }, { result: '' }));
    expect(entry?.hasResult).toBe(false);
  });

  it('refuses a record whose criteria cannot be read', () => {
    expect(queryRow_toEntry(row_make(9, {}, { query: 'not json' }))).toBeNull();
    expect(queryRow_toEntry(row_make(9, {}, { query: '{}' }))).toBeNull();
  });
});

describe('queryIndex_sweep', () => {
  beforeEach(() => {
    queryIndex_get().reset();
    pacsQueries_listMock.mockReset();
  });

  it('walks past the first page: a short page is the only end marker', async () => {
    const full: Record<string, unknown>[] = Array.from(
      { length: QUERY_SWEEP_PAGE },
      (_unused: unknown, i: number): Record<string, unknown> => row_make(i + 1, { PatientID: String(i + 1) }),
    );
    pacsQueries_listMock
      .mockResolvedValueOnce(page_of(full))
      .mockResolvedValueOnce(page_of([row_make(9001, { PatientID: 'tail' })]));

    const swept: Result<QuerySweepResult> = await queryIndex_sweep();
    expect(swept.ok).toBe(true);
    expect(pacsQueries_listMock).toHaveBeenCalledTimes(2);
    if (swept.ok) {
      expect(swept.value.indexed).toBe(QUERY_SWEEP_PAGE + 1);
      expect(swept.value.bounded).toBe(false);
    }
    // The tail of the collection is in the index, not just its head.
    expect(queryIndex_get().entry_find({ PatientID: 'tail' }, 'PACSDCM', 'someone')?.queryId).toBe(9001);
  });

  it('asks for successive offsets rather than the same page twice', async () => {
    const full: Record<string, unknown>[] = Array.from(
      { length: QUERY_SWEEP_PAGE },
      (_unused: unknown, i: number): Record<string, unknown> => row_make(i + 1, { PatientID: String(i + 1) }),
    );
    pacsQueries_listMock
      .mockResolvedValueOnce(page_of(full))
      .mockResolvedValueOnce(page_of([]));

    await queryIndex_sweep();
    expect(pacsQueries_listMock.mock.calls[0]?.[0]).toMatchObject({ offset: 0 });
    expect(pacsQueries_listMock.mock.calls[1]?.[0]).toMatchObject({ offset: QUERY_SWEEP_PAGE });
  });

  it('passes server-side narrowing through', async () => {
    pacsQueries_listMock.mockResolvedValueOnce(page_of([]));
    await queryIndex_sweep({ owner_username: 'someone' });
    expect(pacsQueries_listMock.mock.calls[0]?.[0]).toMatchObject({ owner_username: 'someone' });
  });

  it('records how far back it reached, so the next sweep resumes', async () => {
    pacsQueries_listMock.mockResolvedValueOnce(page_of([
      row_make(1, { PatientID: 'a' }, { creation_date: '2026-09-05T00:00:00.000Z' }),
      row_make(2, { PatientID: 'b' }, { creation_date: '2026-01-01T00:00:00.000Z' }),
    ]));
    await queryIndex_sweep();
    expect(queryIndex_get().floor_get()).toBe('2026-01-01T00:00:00.000Z');
  });

  it('rebuilds from scratch when the index is empty', async () => {
    pacsQueries_listMock.mockResolvedValueOnce(page_of([]));
    await queryIndex_sweep();
    expect(pacsQueries_listMock.mock.calls[0]?.[0]).not.toHaveProperty('min_creation_date');
  });

  it('resumes from the newest record held rather than re-walking the log', async () => {
    queryIndex_get().entry_note({
      queryId: 1, server: 'PACSDCM', criteria: { PatientID: 'held' },
      owner: 'someone', answeredAt: '2026-06-01T00:00:00.000Z', hasResult: true,
    });
    pacsQueries_listMock.mockResolvedValueOnce(page_of([]));
    const swept: Result<QuerySweepResult> = await queryIndex_sweep();
    expect(pacsQueries_listMock.mock.calls[0]?.[0]).toMatchObject({
      min_creation_date: '2026-06-01T00:00:00.000Z',
    });
    if (swept.ok) expect(swept.value.resumed).toBe(true);
  });

  it('reports a refusal rather than pretending the collection was empty', async () => {
    pacsQueries_listMock.mockResolvedValueOnce({ ok: false });
    const swept: Result<QuerySweepResult> = await queryIndex_sweep();
    expect(swept.ok).toBe(false);
  });
});

describe('queryIndex_note', () => {
  beforeEach(() => {
    queryIndex_get().reset();
  });

  it('files one record, so a query this session ran needs no sweep', () => {
    queryIndex_note(row_make(11, { AccessionNumber: '22119730' }));
    expect(queryIndex_get().entry_find({ AccessionNumber: '22119730' }, 'PACSDCM', 'someone')?.queryId).toBe(11);
  });

  it('ignores a record it cannot read rather than throwing', () => {
    expect((): void => queryIndex_note({ id: 'nope' })).not.toThrow();
    expect(queryIndex_get().size_get()).toBe(0);
  });
});
