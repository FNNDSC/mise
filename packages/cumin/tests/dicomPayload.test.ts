/**
 * @file Unit tests for the DICOM query-payload helpers (dicomPayload.ts).
 *
 * Pure-function tests over the shapes the wire has been seen to use: bare
 * values, CUBE's {value} decoder wrapper, DICOM-JSON's {Value: [...]}
 * wrapper, and the several container keys studies and series arrive under.
 */

import {
  tag_extractRaw,
  tag_extractValue,
  studies_extractFromDecoded,
  series_extractFromStudy,
  study_findByUID,
  series_findByUID,
} from '../src/pacs/dicomPayload';

describe('tag_extractRaw', () => {
  test('unwraps the {value} decoder wrapper preserving type', () => {
    expect(tag_extractRaw({ value: 42 })).toBe(42);
    expect(tag_extractRaw({ value: undefined })).toBeUndefined();
  });

  test('unwraps the DICOM-JSON {Value: [...]} wrapper, first element wins', () => {
    expect(tag_extractRaw({ Value: ['first', 'second'] })).toBe('first');
  });

  test('passes bare values, null, and undefined through unchanged', () => {
    expect(tag_extractRaw('plain')).toBe('plain');
    expect(tag_extractRaw(null)).toBeNull();
    expect(tag_extractRaw(undefined)).toBeUndefined();
  });
});

describe('tag_extractValue', () => {
  test('stringifies unwrapped values', () => {
    expect(tag_extractValue({ value: 'abc' })).toBe('abc');
    expect(tag_extractValue({ Value: [7] })).toBe('7');
    expect(tag_extractValue('plain')).toBe('plain');
  });

  test('renders null and undefined as empty string', () => {
    expect(tag_extractValue(null)).toBe('');
    expect(tag_extractValue({ value: null })).toBe('');
  });
});

describe('studies_extractFromDecoded', () => {
  const studyA: Record<string, unknown> = { StudyInstanceUID: 'A' };
  const studyB: Record<string, unknown> = { StudyInstanceUID: 'B' };

  test.each([
    ['studies', { studies: [studyA, studyB] }],
    ['Studies', { Studies: [studyA, studyB] }],
    ['results', { results: [studyA, studyB] }],
  ])('locates the study array under the %s key', (_key: string, payload: unknown) => {
    expect(studies_extractFromDecoded(payload)).toEqual([studyA, studyB]);
  });

  test('treats a bare array payload as the study collection', () => {
    expect(studies_extractFromDecoded([studyA])).toEqual([studyA]);
  });

  test('wraps a bare study object as a single-element collection', () => {
    expect(studies_extractFromDecoded(studyA)).toEqual([studyA]);
  });
});

describe('series_extractFromStudy', () => {
  const s1: Record<string, unknown> = { SeriesInstanceUID: 'S1' };

  test.each(['series', 'Series', 'results', 'data'])(
    'locates the series array under the %s key',
    (key: string) => {
      expect(series_extractFromStudy({ [key]: [s1] })).toEqual([s1]);
    },
  );

  test('yields an empty array for a study with no series container', () => {
    expect(series_extractFromStudy({ StudyInstanceUID: 'A' })).toEqual([]);
  });
});

describe('UID lookups', () => {
  test('study_findByUID matches wrapped and bare UIDs', () => {
    const studies: Record<string, unknown>[] = [
      { StudyInstanceUID: { value: '1.2.3' } },
      { uid: '4.5.6' },
    ];
    expect(study_findByUID(studies, '1.2.3')).toBe(studies[0]);
    expect(study_findByUID(studies, '4.5.6')).toBe(studies[1]);
    expect(study_findByUID(studies, '9.9.9')).toBeUndefined();
  });

  test('series_findByUID matches wrapped and bare UIDs', () => {
    const series: Record<string, unknown>[] = [
      { SeriesInstanceUID: { Value: ['7.8.9'] } },
      { uid: '1.1.1' },
    ];
    expect(series_findByUID(series, '7.8.9')).toBe(series[0]);
    expect(series_findByUID(series, '1.1.1')).toBe(series[1]);
    expect(series_findByUID(series, '0.0.0')).toBeUndefined();
  });
});
