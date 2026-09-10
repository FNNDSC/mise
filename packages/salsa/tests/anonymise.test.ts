/**
 * @file Standing in for what a PACS answer says about a person.
 *
 * A demo runs against a live hospital PACS, so every answer carries real
 * names, record numbers and dates onto a projector. What is pinned here is
 * what a stand-in must be to be worth having: stable inside one answer, so
 * a demo is followable; shaped like the thing it replaces, so nothing
 * downstream needs to know; and carrying none of the original, which for a
 * seven-digit record number means a salt rather than a bare digest.
 */
import { describe, it, expect } from '@jest/globals';
import {
  answer_standIn,
  birthDate_toYear,
  criteria_standIn,
  date_toMonth,
  field_standIn,
  nameStandIn_of,
  token_of,
} from '../src/pacs/anonymise.js';

describe('a stand-in token', () => {
  it('is the same for the same value, so one patient reads as one patient', () => {
    expect(token_of('1279049')).toBe(token_of('1279049'));
  });

  it('differs for different values', () => {
    expect(token_of('1279049')).not.toBe(token_of('1279050'));
  });

  it('carries none of the original', () => {
    expect(token_of('1279049')).not.toContain('1279049');
  });

  it('is not the bare digest of the value, which a seven-digit space makes reversible', () => {
    // The whole space of record numbers can be hashed in under a second, so
    // an unsalted token is a lookup away from the value behind it. This is
    // the property the salt exists for; without it this assertion fails.
    const bare: string = require('crypto').createHash('sha256').update('1279049').digest('hex').slice(0, 8);
    expect(token_of('1279049')).not.toBe(bare);
  });

  it('says nothing for nothing, rather than tokenising an empty field', () => {
    expect(token_of('')).toBe('');
  });
});

describe('a stand-in name', () => {
  it('reads as a name, in the form DICOM writes one', () => {
    expect(nameStandIn_of('PIENAAR^CHLOE')).toMatch(/^[A-Z]+\^[A-Z]+$/);
  });

  it('is stable, so the same person reads the same way across an answer', () => {
    expect(nameStandIn_of('PIENAAR^CHLOE')).toBe(nameStandIn_of('PIENAAR^CHLOE'));
  });

  it('carries none of the original name', () => {
    const stoodIn: string = nameStandIn_of('PIENAAR^CHLOE');
    expect(stoodIn).not.toContain('PIENAAR');
    expect(stoodIn).not.toContain('CHLOE');
  });
});

describe('dates', () => {
  it('coarsens a study date to the month it fell in', () => {
    expect(date_toMonth('20260910')).toBe('20260901');
  });

  it('coarsens a birth date all the way to its year, since an age identifies', () => {
    expect(birthDate_toYear('19971013')).toBe('19970101');
  });

  it('leaves something that is not a date alone', () => {
    expect(date_toMonth('')).toBe('');
    expect(date_toMonth('unknown')).toBe('unknown');
  });
});

describe('which fields are stood in for', () => {
  it('stands in for the ones that name a person', () => {
    expect(field_standIn('PatientID', '1279049')).not.toBe('1279049');
    expect(field_standIn('AccessionNumber', '22119730')).not.toBe('22119730');
    expect(field_standIn('PatientName', 'DOE^JANE')).not.toBe('DOE^JANE');
  });

  it('leaves the ones that name nobody, so an answer stays readable', () => {
    expect(field_standIn('Modality', 'MR')).toBe('MR');
    expect(field_standIn('SeriesDescription', 'AX T2 FLAIR')).toBe('AX T2 FLAIR');
    // The identifiers are never shown and are what the held-state
    // reconciliation matches on: standing in for them would break the
    // answer while hiding nothing.
    expect(field_standIn('StudyInstanceUID', '1.2.3')).toBe('1.2.3');
    expect(field_standIn('SeriesInstanceUID', '1.2.3.4')).toBe('1.2.3.4');
  });
});

describe('a whole answer', () => {
  const answer = [{
    PatientID: { value: '1279049' },
    PatientName: { value: 'DOE^JANE' },
    PatientBirthDate: { value: '19971013' },
    AccessionNumber: { value: '22119730' },
    StudyDate: { value: '20260910' },
    StudyInstanceUID: { value: '1.2.3' },
    StudyDescription: { value: 'MR Brain' },
    series: [{
      SeriesInstanceUID: { value: '1.2.3.4' },
      SeriesDescription: { value: 'AX T2 FLAIR' },
      Modality: { value: 'MR' },
    }],
  }];

  it('says nothing identifying anywhere in it', () => {
    const stoodIn: string = JSON.stringify(answer_standIn(answer));
    for (const secret of ['1279049', 'DOE', 'JANE', '22119730', '19971013']) {
      expect(stoodIn).not.toContain(secret);
    }
  });

  it('keeps its shape, so what reads it needs no telling', () => {
    const out = answer_standIn(answer) as typeof answer;
    expect(out[0]?.StudyDescription?.value).toBe('MR Brain');
    expect(out[0]?.StudyInstanceUID?.value).toBe('1.2.3');
    expect(out[0]?.series[0]?.Modality?.value).toBe('MR');
    expect(out[0]?.series[0]?.SeriesInstanceUID?.value).toBe('1.2.3.4');
    expect(out[0]?.StudyDate?.value).toBe('20260901');
  });

  it('leaves the original untouched, since the real answer is still needed', () => {
    answer_standIn(answer);
    expect(answer[0]?.PatientID?.value).toBe('1279049');
  });
});

describe('the question itself', () => {
  it('stands in for the values, since the typed line is the first thing on the screen', () => {
    expect(criteria_standIn({ PatientID: '1279049' }).PatientID).not.toContain('1279049');
  });

  it('names the same token the rows do, so the line and the answer agree', () => {
    expect(criteria_standIn({ PatientID: '1279049' }).PatientID).toBe(token_of('1279049'));
  });

  it('leaves a term that names nobody, so the question still reads', () => {
    expect(criteria_standIn({ Modality: 'MR' }).Modality).toBe('MR');
  });
});
