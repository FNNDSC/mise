/**
 * @file Unit tests for the pure PACS query result renderer.
 *
 * @module
 */
import { describe, it, expect } from '@jest/globals';
import { pacsQueryResult_renderPretty } from '../../src/pacs/pacsResultRender.js';

describe('pacsQueryResult_renderPretty', () => {
  it('returns null for non-object payloads', () => {
    expect(pacsQueryResult_renderPretty(null)).toBeNull();
    expect(pacsQueryResult_renderPretty('x')).toBeNull();
    expect(pacsQueryResult_renderPretty(42)).toBeNull();
  });

  it('still emits the study header for a field-less study (matches original)', () => {
    expect(pacsQueryResult_renderPretty({})).toBe('Study 1');
  });

  it('renders a study with tag labels, key fallback, and nested series', () => {
    const out = pacsQueryResult_renderPretty({
      AccessionNumber: { label: 'Accession', value: '123' },
      PatientName: { value: 'DOE^J' },
      series: [{ SeriesDescription: { value: 'AX T1' }, Modality: { value: 'MR' } }],
    });
    expect(out).not.toBeNull();
    const text = out as string;
    expect(text).toContain('Study 1');
    expect(text).toContain('Accession: 123');     // uses tag label
    expect(text).toContain('PatientName: DOE^J');  // falls back to key when label empty
    expect(text).toContain('Series 1');
    expect(text).toContain('SeriesDescription: AX T1');
    expect(text).toContain('Modality: MR');
  });

  it('renders an array of studies', () => {
    const out = pacsQueryResult_renderPretty([
      { AccessionNumber: { value: 'A' } },
      { AccessionNumber: { value: 'B' } },
    ]) as string;
    expect(out).toContain('Study 1');
    expect(out).toContain('Study 2');
  });

  it('skips array-valued fields as scalar tags', () => {
    const out = pacsQueryResult_renderPretty({ StudyDate: { value: '20240101' }, weird: [1, 2, 3] }) as string;
    expect(out).toContain('StudyDate: 20240101');
    expect(out).not.toContain('weird');
  });
});
