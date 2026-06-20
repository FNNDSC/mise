/**
 * @file Unit tests for the pure helpers in the PACS VFS provider.
 *
 * @module
 */
import { describe, it, expect } from '@jest/globals';
import {
  tag_extractValue,
  path_normalize,
  queryId_extractFromFolder,
  studies_extractFromDecoded,
  series_extractFromStudy,
  study_findByUID,
  cpSrc_parse,
} from '../src/vfs/providers/pacsHelpers';

describe('tag_extractValue', () => {
  it('reads .value from a tag object', () => {
    expect(tag_extractValue({ value: 'X' })).toBe('X');
    expect(tag_extractValue({ value: null })).toBe('');
  });
  it('stringifies scalars and null', () => {
    expect(tag_extractValue('Y')).toBe('Y');
    expect(tag_extractValue(5)).toBe('5');
    expect(tag_extractValue(null)).toBe('');
  });
});

describe('path_normalize', () => {
  it('prepends a leading slash and strips a trailing one', () => {
    expect(path_normalize('a/b')).toBe('/a/b');
    expect(path_normalize('/a/b/')).toBe('/a/b');
  });
  it('leaves root intact', () => {
    expect(path_normalize('/')).toBe('/');
  });
});

describe('queryId_extractFromFolder', () => {
  it('extracts the _qid: number', () => {
    expect(queryId_extractFromFolder('q_qid:42')).toBe(42);
  });
  it('returns NaN when absent', () => {
    expect(Number.isNaN(queryId_extractFromFolder('nope'))).toBe(true);
  });
});

describe('studies_extractFromDecoded', () => {
  it('reads the studies/Studies/results key', () => {
    expect(studies_extractFromDecoded({ studies: [{ a: 1 }] })).toEqual([{ a: 1 }]);
    expect(studies_extractFromDecoded({ Studies: [{ b: 2 }] })).toEqual([{ b: 2 }]);
  });
  it('wraps a bare object as a single study', () => {
    expect(studies_extractFromDecoded({ x: 1 })).toEqual([{ x: 1 }]);
  });
  it('passes arrays through', () => {
    expect(studies_extractFromDecoded([{ a: 1 }, { b: 2 }])).toEqual([{ a: 1 }, { b: 2 }]);
  });
});

describe('series_extractFromStudy', () => {
  it('finds the series array under any known key', () => {
    expect(series_extractFromStudy({ series: [{ s: 1 }] })).toEqual([{ s: 1 }]);
    expect(series_extractFromStudy({ Series: [{ s: 2 }] })).toEqual([{ s: 2 }]);
  });
  it('returns [] when none present', () => {
    expect(series_extractFromStudy({})).toEqual([]);
  });
});

describe('study_findByUID', () => {
  it('matches on StudyInstanceUID tag value', () => {
    const studies = [{ StudyInstanceUID: { value: '1.2' } }, { StudyInstanceUID: { value: '3.4' } }];
    expect(study_findByUID(studies, '3.4')).toBe(studies[1]);
  });
  it('returns undefined when not found', () => {
    expect(study_findByUID([], 'x')).toBeUndefined();
  });
});

describe('cpSrc_parse', () => {
  it('parses a study-level path', () => {
    const r = cpSrc_parse('/net/pacs/q_qid:5/Study_1.2.3_desc');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual({ studyUID: '1.2.3', seriesUID: undefined, queryId: 5 });
  });
  it('parses a series-level path', () => {
    const r = cpSrc_parse('/net/pacs/q_qid:5/Study_1.2.3_d/Series_4.5.6_d');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual({ studyUID: '1.2.3', seriesUID: '4.5.6', queryId: 5 });
  });
  it('rejects too-short paths', () => {
    expect(cpSrc_parse('/a/b/c').ok).toBe(false);
  });
  it('rejects a non-Study folder', () => {
    expect(cpSrc_parse('/net/pacs/q_qid:5/NotAStudy').ok).toBe(false);
  });
  it('rejects a missing query id', () => {
    expect(cpSrc_parse('/net/pacs/noqid/Study_1.2.3_d').ok).toBe(false);
  });
});
