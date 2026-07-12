import { jest, describe, it, expect } from '@jest/globals';

// query.ts / pacsUtils.ts pull cumin + chili at module load; the pure parsers
// under test use none of it, so stub the boundary just enough to import them.
jest.unstable_mockModule('@fnndsc/cumin', () => ({
  envelope_ok: (rendered: string) => ({ status: 'ok', rendered }),
  envelope_error: (rendered: string, _errors?: unknown, renderedErr?: string) => (renderedErr !== undefined ? { status: 'error', rendered, renderedErr } : { status: 'error', rendered }),
  errorStack: { stack_pop: jest.fn(), stack_push: jest.fn() },
  chrisContext: {},
  Context: {},
  pacsQuery_get: jest.fn(),
  pacsQuery_resultDecode: jest.fn(),
  pacsQueries_create: jest.fn(),
  pacsServers_list: jest.fn(),
}));
jest.unstable_mockModule('@fnndsc/chili/screen/screen.js', () => ({ screen: {} }));
jest.unstable_mockModule('../src/lib/spinner.js', () => ({ spinner: {} }));

const { queryExpr_parse, queryVfsPath_build } = await import('../src/builtins/net/query.js');
const { pacs_tagValueExtract, folderUID_get } = await import('../src/builtins/net/pacsUtils.js');

describe('queryExpr_parse', () => {
  it('parses comma-separated Key:Value pairs', () => {
    expect(queryExpr_parse('PatientID:X,Modality:CT')).toEqual({ PatientID: 'X', Modality: 'CT' });
  });

  it('trims whitespace around keys and values', () => {
    expect(queryExpr_parse(' a : b ')).toEqual({ a: 'b' });
  });

  it('parses a JSON object expression', () => {
    expect(queryExpr_parse('{"a":"b"}')).toEqual({ a: 'b' });
  });

  it('rejects a JSON array', () => {
    expect(queryExpr_parse('[1,2]')).toBeNull();
  });

  it('rejects malformed JSON', () => {
    expect(queryExpr_parse('{bad')).toBeNull();
  });

  it('rejects a part without a colon', () => {
    expect(queryExpr_parse('nocolon')).toBeNull();
  });

  it('rejects an empty value', () => {
    expect(queryExpr_parse('k:')).toBeNull();
  });
});

describe('queryVfsPath_build', () => {
  it('builds a path from the query pairs and username', () => {
    expect(queryVfsPath_build(5, { PatientID: 'X' }, 'me')).toBe('/net/pacs/queries/PatientID:X_qid:5_me');
  });

  it('omits the user suffix when no username is given', () => {
    expect(queryVfsPath_build(7, { Modality: 'CT' })).toBe('/net/pacs/queries/Modality:CT_qid:7');
  });

  it('falls back to "query" when the object is empty', () => {
    expect(queryVfsPath_build(1, {})).toBe('/net/pacs/queries/query_qid:1');
  });
});

describe('pacs_tagValueExtract', () => {
  it('reads a { value } wrapper', () => {
    expect(pacs_tagValueExtract({ value: 'abc' })).toBe('abc');
  });

  it('reads the first DICOM { Value: [] } element', () => {
    expect(pacs_tagValueExtract({ Value: ['first', 'second'] })).toBe('first');
  });

  it('stringifies a plain scalar', () => {
    expect(pacs_tagValueExtract('plain')).toBe('plain');
  });

  it('returns an empty string for null', () => {
    expect(pacs_tagValueExtract(null)).toBe('');
  });
});

describe('folderUID_get', () => {
  it('extracts the UID between the prefix and the label', () => {
    expect(folderUID_get('series_1.2.3_BrainScan', 'series')).toBe('1.2.3');
  });
});
