/**
 * @file Handles shown (#1099): what a listing prints is what an index
 * expands to, short and aligned, with a footer saying what is numbered.
 */
import { describe, it, expect } from '@jest/globals';
import { answerAdapters_register } from '../src/session/answerAdapters.js';
import { answerNumbering_of, handle_word, numberedFooter_of } from '../src/session/answer.js';
import { pacsAnswer_render } from '../src/builtins/net/query.view.js';
import { pacsAnswer_toTable } from '../src/builtins/net/query.csv.js';

answerAdapters_register();

const strip = (text: string): string => text.replace(/\x1b\[[0-9;]*m/g, '');

function model_make(): never {
  const series = (n: number, description: string) => ({ seriesUID: `s${n}`, description, modality: 'MR', fileCount: 100 + n, vfsPath: `/q/st1/se${n}` });
  return {
    queryId: 1, vfsPath: '/q', pacsName: 'PACSDCM', expression: 'PatientID:1234',
    studies: [
      { description: 'Brain MRI', patientName: 'DOE^JANE', patientId: '1234', date: '20240101', modalities: 'MR', accession: '', vfsPath: '/q/st1', series: [series(1, 'T1 SAG'), series(2, 'T2 AX')] },
      { description: 'Spine MRI', patientName: 'DOE^JANE', patientId: '1234', date: '20240202', modalities: 'MR', accession: '', vfsPath: '/q/st2', series: [{ seriesUID: 's9', description: 'T1 COR', modality: 'MR', vfsPath: '/q/st2/se9' }] },
    ],
  } as never;
}

describe('the numbered footer', () => {
  it('says each kind in the form an index is typed: runs as ranges, gaps with commas', () => {
    expect(numberedFooter_of([{ kind: 'PAT', ordinal: 1 }, ...[1, 2, 3].map((ordinal) => ({ kind: 'SER', ordinal }))])).toBe('numbered: @PAT1, @SER1-3');
    expect(numberedFooter_of([1, 3, 41, 42].map((ordinal) => ({ kind: 'SER', ordinal })))).toBe('numbered: @SER1,3,41-42');
    expect(numberedFooter_of([])).toBe('');
    expect(handle_word({ kind: 'STD', ordinal: 12 })).toBe('@STD12');
  });
});

describe('a PACS answer with its handles', () => {
  it('prints every patient, study and series with the handle that expands to it, and the footer', () => {
    const model = model_make();
    const text: string = strip(pacsAnswer_render(model) ?? '');
    const numbered = answerNumbering_of('pacs.query', model) ?? [];
    expect(numbered.filter((one) => one.kind === 'SER').map((one) => one.address)).toEqual(['/q/st1/se1', '/q/st1/se2', '/q/st2/se9']);
    expect(text).toMatch(/@PAT1 +DOE\^JANE \(ID: 1234\)/);
    expect(text).toMatch(/@STD1 +Brain MRI/);
    expect(text).toMatch(/@SER2 +T2 AX \[MR\] 102 files/);
    expect(text).toMatch(/@SER3 +T1 COR/);
    expect(text).toContain('numbered: @PAT1, @STD1-2, @SER1-3');
  });

  it('leads the table with the handle column, and keeps the old table when nothing is numbered', () => {
    const table: string = pacsAnswer_toTable(model_make(), 'series');
    expect(table.split('\n')[0]).toMatch(/^  @ +MRN/);
    expect(table).toMatch(/\n  @SER3 +1234/);
    expect(table).toContain('numbered: @PAT1, @STD1-2, @SER1-3');
    const bare = { queryId: 1, vfsPath: '/q', pacsName: 'P', expression: 'x', studies: [{ description: 'B', patientName: 'X', patientId: '1', date: '', modalities: '', accession: '', series: [] }] } as never;
    expect(pacsAnswer_toTable(bare).split('\n')[0]).toMatch(/^  MRN/);
  });
});

describe('help pronouns', () => {
  it('says what a pronoun is, the core\'s own, the backend\'s lines, and the index handles beside them', async () => {
    const { pronounsPage_render } = await import('../src/builtins/pronouns.js');
    const page: string = strip(pronounsPage_render(['  ${feed}          the feed']));
    expect(page).toContain('PRONOUNS');
    expect(page).toContain('${cwd}');
    expect(page).toContain('${feed}          the feed');
    expect(page).toContain('numbered: @PAT1, @STD1-9, @SER1-235');
  });
});
