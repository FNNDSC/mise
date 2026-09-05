/**
 * @file Unit tests for the PACS query index.
 *
 * The index decides whether a question has been asked before, so its key is
 * the whole correctness story: too loose and mise serves an answer to a
 * question nobody asked, too tight and replay never fires. These tests pin
 * what normalization is allowed to ignore, and what it must not.
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import {
  QueryIndex,
  queryIndex_get,
  queryKey_build,
  queryCriteria_parse,
  type QueryIndexEntry,
  type QueryIndexSnapshot,
} from '../src/cache/queryIndex.js';

/** A query record as the index files it. */
function entry_make(overrides: Partial<QueryIndexEntry> = {}): QueryIndexEntry {
  return {
    queryId: 1,
    server: 'PACSDCM',
    criteria: { PatientID: '4432456' },
    owner: 'someone',
    answeredAt: '2026-09-05T10:00:00.000Z',
    hasResult: true,
    ...overrides,
  };
}

describe('queryKey_build', () => {
  it('ignores the order criteria were typed in', () => {
    const a: string = queryKey_build({ PatientID: '1', StudyDate: '20260101' }, 'PACSDCM', 'someone');
    const b: string = queryKey_build({ StudyDate: '20260101', PatientID: '1' }, 'PACSDCM', 'someone');
    expect(a).toBe(b);
  });

  it('ignores whitespace around keys and values', () => {
    const a: string = queryKey_build({ '  PatientID ': ' 4432456  ' }, ' PACSDCM ', 'someone');
    const b: string = queryKey_build({ PatientID: '4432456' }, 'PACSDCM', 'someone');
    expect(a).toBe(b);
  });

  it('does NOT fold case: a DICOM value is the PACS vocabulary, not ours', () => {
    const a: string = queryKey_build({ PatientName: 'SMITH' }, 'PACSDCM', 'someone');
    const b: string = queryKey_build({ PatientName: 'smith' }, 'PACSDCM', 'someone');
    expect(a).not.toBe(b);
  });

  it("separates one identity's question from another's", () => {
    const a: string = queryKey_build({ PatientID: '1' }, 'PACSDCM', 'me');
    const b: string = queryKey_build({ PatientID: '1' }, 'PACSDCM', 'you');
    expect(a).not.toBe(b);
  });

  it('separates the same criteria asked of different servers', () => {
    const a: string = queryKey_build({ PatientID: '1' }, 'PACSDCM', 'someone');
    const b: string = queryKey_build({ PatientID: '1' }, 'ORTHANC', 'someone');
    expect(a).not.toBe(b);
  });

  it('does not let a value containing a separator collide with two criteria', () => {
    const a: string = queryKey_build({ PatientID: '1', StudyDate: '2' }, 'P', 'someone');
    const b: string = queryKey_build({ PatientID: '1 StudyDate=2' }, 'P', 'someone');
    expect(a).not.toBe(b);
  });

  it('drops criteria with no value, which narrow nothing', () => {
    const a: string = queryKey_build({ PatientID: '1', Modality: '   ' }, 'P', 'someone');
    const b: string = queryKey_build({ PatientID: '1' }, 'P', 'someone');
    expect(a).toBe(b);
  });
});

describe('queryCriteria_parse', () => {
  it('reads the JSON string CUBE stores', () => {
    expect(queryCriteria_parse('{"PatientID": "4432456"}')).toEqual({ PatientID: '4432456' });
  });

  it('renders non-string values as strings rather than dropping them', () => {
    expect(queryCriteria_parse('{"Limit": 5}')).toEqual({ Limit: '5' });
  });

  it('answers null for anything unusable rather than throwing', () => {
    expect(queryCriteria_parse('not json')).toBeNull();
    expect(queryCriteria_parse('[1,2]')).toBeNull();
    expect(queryCriteria_parse('')).toBeNull();
    expect(queryCriteria_parse(undefined)).toBeNull();
  });
});

describe('QueryIndex', () => {
  let index: QueryIndex;

  beforeEach(() => {
    index = new QueryIndex();
  });

  it('finds a question it was told about, with no wire traffic', () => {
    index.entry_note(entry_make({ queryId: 42 }));
    const found: QueryIndexEntry | null = index.entry_find({ PatientID: '4432456' }, 'PACSDCM', 'someone');
    expect(found?.queryId).toBe(42);
  });

  it('answers null for a question it has never seen', () => {
    expect(index.entry_find({ PatientID: 'nobody' }, 'PACSDCM', 'someone')).toBeNull();
  });

  it('keeps every record, so the log shows a question asked twice twice', () => {
    index.entry_note(entry_make({ queryId: 1, answeredAt: '2026-01-01T00:00:00.000Z' }));
    index.entry_note(entry_make({ queryId: 2, answeredAt: '2026-06-01T00:00:00.000Z' }));
    expect(index.size_get()).toBe(2);
    expect(index.questions_count()).toBe(1);
  });

  it('hands an older record back the question when the newest is dropped', () => {
    index.entry_note(entry_make({ queryId: 1, answeredAt: '2026-01-01T00:00:00.000Z' }));
    index.entry_note(entry_make({ queryId: 2, answeredAt: '2026-06-01T00:00:00.000Z' }));
    index.entry_drop({ PatientID: '4432456' }, 'PACSDCM', 'someone');
    expect(index.entry_find({ PatientID: '4432456' }, 'PACSDCM', 'someone')?.queryId).toBe(1);
  });

  it('answers a lookup with the newest record for that question', () => {
    index.entry_note(entry_make({ queryId: 1, answeredAt: '2026-01-01T00:00:00.000Z' }));
    index.entry_note(entry_make({ queryId: 2, answeredAt: '2026-06-01T00:00:00.000Z' }));
    expect(index.entry_find({ PatientID: '4432456' }, 'PACSDCM', 'someone')?.queryId).toBe(2);
  });

  it('does not let an older record displace a newer one', () => {
    index.entry_note(entry_make({ queryId: 2, answeredAt: '2026-06-01T00:00:00.000Z' }));
    index.entry_note(entry_make({ queryId: 1, answeredAt: '2026-01-01T00:00:00.000Z' }));
    expect(index.entry_find({ PatientID: '4432456' }, 'PACSDCM', 'someone')?.queryId).toBe(2);
  });

  it("never answers with another identity's query", () => {
    index.entry_note(entry_make({ queryId: 5, owner: 'someone-else' }));
    expect(index.entry_find({ PatientID: '4432456' }, 'PACSDCM', 'someone')).toBeNull();
    expect(index.size_get()).toBe(1);
  });

  it('files a query that found nothing rather than omitting it', () => {
    index.entry_note(entry_make({ hasResult: false }));
    expect(index.entry_find({ PatientID: '4432456' }, 'PACSDCM', 'someone')?.hasResult).toBe(false);
  });

  it('forgets a query whose stored answer turned out to be gone', () => {
    index.entry_note(entry_make());
    index.entry_drop({ PatientID: '4432456' }, 'PACSDCM', 'someone');
    expect(index.entry_find({ PatientID: '4432456' }, 'PACSDCM', 'someone')).toBeNull();
  });

  it('moves its floor back only, so a sweep resumes rather than restarting', () => {
    index.floor_set('2026-06-01T00:00:00.000Z');
    index.floor_set('2026-01-01T00:00:00.000Z');
    expect(index.floor_get()).toBe('2026-01-01T00:00:00.000Z');
    index.floor_set('2026-09-01T00:00:00.000Z');
    expect(index.floor_get()).toBe('2026-01-01T00:00:00.000Z');
  });

  it('survives a round trip through a snapshot, floor included', () => {
    index.entry_note(entry_make({ queryId: 7 }));
    index.floor_set('2026-01-01T00:00:00.000Z');
    const snapshot: QueryIndexSnapshot = index.snapshot_create();

    const restored: QueryIndex = new QueryIndex();
    restored.snapshot_restore(snapshot);
    expect(restored.entry_find({ PatientID: '4432456' }, 'PACSDCM', 'someone')?.queryId).toBe(7);
    expect(restored.floor_get()).toBe('2026-01-01T00:00:00.000Z');
  });

  it('keeps what this process learned over what a snapshot claims, ties included', () => {
    index.entry_note(entry_make({ queryId: 7 }));
    const snapshot: QueryIndexSnapshot = index.snapshot_create();

    const live: QueryIndex = new QueryIndex();
    live.entry_note(entry_make({ queryId: 99 }));
    live.snapshot_restore(snapshot);
    expect(live.entry_find({ PatientID: '4432456' }, 'PACSDCM', 'someone')?.queryId).toBe(99);
  });

  it('tells its listeners, and a throwing listener does not stop the rest', () => {
    let told: number = 0;
    index.changeListener_add((): void => { throw new Error('mine alone'); });
    index.changeListener_add((): void => { told += 1; });
    index.entry_note(entry_make());
    expect(told).toBe(1);
  });

  it('stops telling a listener that has been removed', () => {
    let told: number = 0;
    const remove: () => void = index.changeListener_add((): void => { told += 1; });
    index.entry_note(entry_make());
    remove();
    index.entry_note(entry_make({ queryId: 2, answeredAt: '2026-10-01T00:00:00.000Z' }));
    expect(told).toBe(1);
  });

  it('is a process-wide singleton', () => {
    expect(queryIndex_get()).toBe(queryIndex_get());
  });
});
