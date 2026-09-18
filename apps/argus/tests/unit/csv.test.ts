/**
 * @file A CSV is a table, so it has to be READ as one: a field may carry
 * the delimiter, a newline or a quote, and splitting on commas turns one
 * such row into several wrong ones.
 */
import { describe, it, expect } from '@jest/globals';
import { csvTable_read, delimited_parse, record_isHeader } from '../../src/features/files/csv.js';

describe('delimited_parse', () => {
  it('keeps a delimiter, a newline and a doubled quote inside a quoted field', () => {
    const text: string = 'a,"b,1","line\nbreak","say ""hi"""\n';
    expect(delimited_parse(text, ',')).toEqual([['a', 'b,1', 'line\nbreak', 'say "hi"']]);
  });

  it('reads CRLF and LF records alike, and a trailing newline ends the last', () => {
    expect(delimited_parse('a,b\r\nc,d\n', ',')).toEqual([['a', 'b'], ['c', 'd']]);
    expect(delimited_parse('a,b\nc,d', ',')).toEqual([['a', 'b'], ['c', 'd']]);
  });

  it('keeps an empty field, and an empty trailing field', () => {
    expect(delimited_parse('a,,c,\n', ',')).toEqual([['a', '', 'c', '']]);
  });

  it('reads nothing from nothing', () => {
    expect(delimited_parse('', ',')).toEqual([]);
  });
});

describe('record_isHeader', () => {
  it('takes a record of distinct names as the header', () => {
    expect(record_isHeader(['MRN', 'PATIENT', 'SERIES'])).toBe(true);
  });

  it('refuses one with a number, a blank, or a repeat — those are data', () => {
    expect(record_isHeader(['MRN', '1279049'])).toBe(false);
    expect(record_isHeader(['MRN', ''])).toBe(false);
    expect(record_isHeader(['MRN', 'mrn'])).toBe(false);
  });
});

describe('csvTable_read', () => {
  it('takes the first record as caps and the rest as rows', () => {
    const table = csvTable_read('"MRN","STUDY"\n"1279049","MR Brain"\n', '/home/me/a.csv');
    expect(table).toEqual({ caps: ['MRN', 'STUDY'], rows: [['1279049', 'MR Brain']], headed: true });
  });

  it('numbers the columns when the first record is data, and keeps that row', () => {
    const table = csvTable_read('1,2\n3,4\n', '/home/me/a.csv');
    expect(table.headed).toBe(false);
    expect(table.caps).toEqual(['COLUMN 1', 'COLUMN 2']);
    expect(table.rows).toEqual([['1', '2'], ['3', '4']]);
  });

  it('fills a ragged record rather than refusing the file', () => {
    const table = csvTable_read('A,B,C\n1,2\n', '/home/me/a.csv');
    expect(table.rows).toEqual([['1', '2', '']]);
  });

  it('reads a .tsv by its tabs', () => {
    const table = csvTable_read('A\tB\n1\t2\n', '/home/me/a.tsv');
    expect(table.caps).toEqual(['A', 'B']);
    expect(table.rows).toEqual([['1', '2']]);
  });
});
