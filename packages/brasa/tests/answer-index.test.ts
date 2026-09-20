/**
 * @file Unit tests for naming a row by its number.
 *
 * The claims worth pinning: what gets numbered is the MODEL, so a console
 * table and a graphical pane count the same rows; an index past the end
 * refuses and says how many there are; `@2,3` and `@2-4` mean what they
 * look like; and an empty answer does not silently un-number the listing
 * the operator just read.
 */
import { describe, it, expect, jest, beforeEach } from '@jest/globals';

jest.unstable_mockModule('../src/session/index.js', () => ({
  session: { getCWD: async (): Promise<string> => '/home/chris' },
}));
jest.unstable_mockModule('../src/builtins/res/gather.store.js', () => ({
  cohort_read: async (): Promise<unknown> => ({ version: 1, name: null, feed: null, series: [] }),
}));

const { answer_note, answer_get, answerRow_get, answerConsulted_take, answer_forget } =
  await import('../src/session/answer.js');
const { answerAdapters_register } = await import('../src/session/answerAdapters.js');
const { indices_parse, reference_resolve } = await import('../src/core/expansion.js');
const { shellWords_tokenize, shellWords_referencesExpand } = await import('../src/lib/parser.js');

answerAdapters_register();

/** A PACS answer holding one study of two series. */
const PACS_ANSWER: unknown = {
  queryId: 1, vfsPath: '/net/pacs/queries/q', pacsName: 'PACSDCM', expression: 'PatientID:1',
  studies: [{
    description: 'MR Brain', patientName: 'X', patientId: '1', date: '', modalities: 'MR',
    accession: 'A', vfsPath: '/net/pacs/queries/q/Study_1',
    series: [
      { seriesUID: '1.1', description: 'AAHScout', modality: 'MR', vfsPath: '/net/pacs/queries/q/Study_1/Series_1' },
      { seriesUID: '1.2', description: 'AX T2', modality: 'MR', vfsPath: '/net/pacs/queries/q/Study_1/Series_2' },
    ],
  }],
};

/** Expands a line the way the dispatcher does. */
async function line_words(line: string): Promise<string[] | { missing: string }> {
  const expanded = await shellWords_referencesExpand(shellWords_tokenize(line), reference_resolve);
  return expanded.ok ? expanded.words.map((word): string => word.value) : { missing: expanded.missing };
}

beforeEach(() => {
  answer_forget();
});

describe('what a listing contributes', () => {
  it('numbers a file listing by path, flattened across targets as it printed', () => {
    answer_note('fs.listing', [
      { path: '/home/chris/a', items: [{ name: 'one.txt' }, { name: 'two.txt' }] },
      { path: '/home/chris/b', items: [{ name: 'three.txt' }] },
    ], 'ls a b');
    expect(answerRow_get(1)?.value).toBe('/home/chris/a/one.txt');
    expect(answerRow_get(3)?.value).toBe('/home/chris/b/three.txt');
  });

  it('numbers a PACS answer by SERIES, which is what a pull takes', () => {
    answer_note('pacs.query', PACS_ANSWER, 'pacs query PatientID:1');
    expect(answerRow_get(1)?.value).toBe('/net/pacs/queries/q/Study_1/Series_1');
    expect(answerRow_get(2)?.label).toBe('AX T2');
  });

  it('numbers the cohort, so removing by number reads like every other act', () => {
    answer_note('gather.cohort', { series: [{ vfsPath: '/a', description: 'SAG' }, { vfsPath: '/b' }] }, 'gather list');
    expect(answerRow_get(1)?.label).toBe('SAG');
    expect(answerRow_get(2)?.value).toBe('/b');
  });

  it('ignores a model nobody has said how to number', () => {
    answer_note('fs.cwd', { path: '/home/chris' }, 'pwd');
    expect(answer_get()).toBeNull();
  });

  it('does not let an EMPTY answer un-number the listing just read', () => {
    answer_note('fs.listing', [{ path: '/a', items: [{ name: 'one' }] }], 'ls /a');
    answer_note('fs.listing', [{ path: '/empty', items: [] }], 'ls /empty');
    expect(answer_get()?.source).toBe('ls /a');
  });
});

describe('indices_parse', () => {
  it('reads a number, a list and a range', () => {
    expect(indices_parse('2')).toEqual([2]);
    expect(indices_parse('2,3,6')).toEqual([2, 3, 6]);
    expect(indices_parse('2-4')).toEqual([2, 3, 4]);
    expect(indices_parse('1,3-5')).toEqual([1, 3, 4, 5]);
  });

  it('reads a backwards range as the rows it names', () => {
    expect(indices_parse('4-2')).toEqual([4, 3, 2]);
  });
});

describe('an index on a line', () => {
  beforeEach(() => {
    answer_note('pacs.query', PACS_ANSWER, 'pacs query PatientID:1');
  });

  it('becomes the row it names', async () => {
    expect(await line_words('gather add @2'))
      .toEqual(['gather', 'add', '/net/pacs/queries/q/Study_1/Series_2']);
  });

  it('becomes SEVERAL operands when it names several rows', async () => {
    expect(await line_words('gather add @1,2')).toEqual([
      'gather', 'add',
      '/net/pacs/queries/q/Study_1/Series_1',
      '/net/pacs/queries/q/Study_1/Series_2',
    ]);
  });

  it('refuses past the end rather than acting on the wrong row', async () => {
    expect(await line_words('gather add @9')).toEqual({ missing: '@9' });
  });

  it('is not an index inside a word, so an address is left alone', async () => {
    expect(await line_words('setfacl -m user@host:r /a')).toEqual(['setfacl', '-m', 'user@host:r', '/a']);
  });

  it('is text in quotes, like every other expansion', async () => {
    expect(await line_words("touch '@2'")).toEqual(['touch', '@2']);
  });

  it('says which listing it counted, once, for the line that used it', async () => {
    await line_words('gather add @1');
    const counted = answerConsulted_take();
    expect(counted?.source).toBe('pacs query PatientID:1');
    expect(counted?.rows).toHaveLength(2);
    // Taken once: the next line did not use an index.
    expect(answerConsulted_take()).toBeNull();
  });
});
