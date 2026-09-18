/**
 * @file A delimited table, read as records.
 *
 * A CSV is a table, and this surface renders every table through one
 * façade — so a CSV opened in a browser should be a listing, not a wall of
 * quoted text. That only holds if the file is read properly: a field may
 * carry the delimiter, a newline, or a quote of its own, and splitting on
 * commas turns one such row into several wrong ones. This is the parse,
 * kept apart from the pane so it can be tested without a browser.
 *
 * The grammar is RFC 4180 as the world actually writes it: records
 * separated by LF or CRLF, fields by the delimiter, a field may be
 * double-quoted, and inside quotes a doubled quote is one quote. A final
 * newline ends the last record rather than starting an empty one.
 *
 * @module
 */

/** A table as read: its caps, and its records. */
export interface CsvTable {
  /** The column names, from the header record or synthesized. */
  caps: string[];
  /** The records, each already the width of `caps` (short rows are filled). */
  rows: string[][];
  /** Whether the first record was taken as the header. */
  headed: boolean;
}

/**
 * Splits delimited text into records of fields.
 *
 * @param text - The file's text.
 * @param delimiter - The field delimiter.
 * @returns The records, in order.
 */
export function delimited_parse(text: string, delimiter: string): string[][] {
  const records: string[][] = [];
  let field: string = '';
  let record: string[] = [];
  let quoted: boolean = false;
  let index: number = 0;
  let sawField: boolean = false;
  const field_end = (): void => { record.push(field); field = ''; sawField = true; };
  const record_end = (): void => { records.push(record); record = []; sawField = false; };
  while (index < text.length) {
    const char: string = text[index] as string;
    if (quoted) {
      if (char === '"') {
        // A doubled quote inside quotes is one quote; a single one closes.
        if (text[index + 1] === '"') { field += '"'; index += 2; continue; }
        quoted = false; index += 1; continue;
      }
      field += char; index += 1; continue;
    }
    if (char === '"' && field === '') { quoted = true; index += 1; continue; }
    if (char === delimiter) { field_end(); index += 1; continue; }
    if (char === '\r' && text[index + 1] === '\n') { field_end(); record_end(); index += 2; continue; }
    if (char === '\n' || char === '\r') { field_end(); record_end(); index += 1; continue; }
    field += char; index += 1;
  }
  // A trailing newline ends the last record; anything else leaves one open.
  if (field !== '' || sawField || record.length > 0) { field_end(); record_end(); }
  return records;
}

/**
 * Whether a record reads as a header rather than as data.
 *
 * A header names its columns: every name present, no two the same, and
 * none of them a bare number — a row of numbers is a row of values. When
 * the first record fails that, the columns are numbered instead and every
 * record is data, because inventing names from data would hide a row.
 *
 * @param record - The first record.
 * @returns True when it names the columns.
 */
export function record_isHeader(record: ReadonlyArray<string>): boolean {
  if (record.length === 0) return false;
  const seen: Set<string> = new Set();
  for (const cell of record) {
    const name: string = cell.trim();
    if (name === '') return false;
    if (seen.has(name.toLowerCase())) return false;
    if (name !== '' && Number.isFinite(Number(name))) return false;
    seen.add(name.toLowerCase());
  }
  return true;
}

/**
 * Reads delimited text as a table.
 *
 * Ragged records are filled to the widest row rather than refused: a table
 * that shows every row with a gap says more than one that shows none.
 *
 * @param text - The file's text.
 * @param path - The file's path, whose extension picks the delimiter.
 * @returns The table.
 */
export function csvTable_read(text: string, path: string): CsvTable {
  const delimiter: string = /\.tsv$/i.test(path) ? '\t' : ',';
  const records: string[][] = delimited_parse(text, delimiter);
  if (records.length === 0) return { caps: [], rows: [], headed: false };
  const first: string[] = records[0] as string[];
  const headed: boolean = record_isHeader(first);
  const body: string[][] = headed ? records.slice(1) : records;
  const width: number = records.reduce((widest: number, record: string[]): number =>
    Math.max(widest, record.length), 0);
  const caps: string[] = headed
    ? Array.from({ length: width }, (_unused: unknown, column: number): string =>
        (first[column] ?? `COLUMN ${column + 1}`).trim())
    : Array.from({ length: width }, (_unused: unknown, column: number): string => `COLUMN ${column + 1}`);
  const rows: string[][] = body.map((record: string[]): string[] =>
    Array.from({ length: width }, (_unused: unknown, column: number): string => record[column] ?? ''));
  return { caps, rows, headed };
}
