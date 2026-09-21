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

const { answer_note, answer_get, answerRow_get, answerHandles_get, answerConsulted_take, answer_forget } =
  await import('../src/session/answer.js');
const { answerAdapters_register } = await import('../src/session/answerAdapters.js');
const { indices_parse, reference_resolve, reference_refusal, verbInHand_set } = await import('../src/core/expansion.js');
const { shellWords_tokenize, shellWords_referencesExpand } = await import('../src/lib/parser.js');

answerAdapters_register();

/** A PACS answer holding one study of two series, asked of two patients — one a miss. */
const PACS_ANSWER: unknown = {
  queryId: 1, vfsPath: '/net/pacs/queries/q', pacsName: 'PACSDCM', expression: 'PatientID:1',
  patients: [
    { patientId: '1', server: 'PACSDCM', patientName: 'X', status: 'found', studyCount: 1, seriesCount: 2 },
    { patientId: '2', server: 'PACSDCM', status: 'none', studyCount: 0, seriesCount: 0 },
  ],
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
    expect(answerRow_get({ kind: 'FIL', ordinal: 1 })?.values).toEqual(['/home/chris/a/one.txt']);
    expect(answerRow_get({ kind: 'FIL', ordinal: 3 })?.values).toEqual(['/home/chris/b/three.txt']);
  });

  it('numbers a PACS answer by STUDY and by SERIES, each in its own sequence', () => {
    answer_note('pacs.query', PACS_ANSWER, 'pacs query PatientID:1');
    expect(answerRow_get({ kind: 'SER', ordinal: 1 })?.values).toEqual(['/net/pacs/queries/q/Study_1/Series_1']);
    expect(answerRow_get({ kind: 'SER', ordinal: 2 })?.label).toBe('AX T2');
    // A study hands over its series, as the surface's GATHER on a study does.
    expect(answerRow_get({ kind: 'STD', ordinal: 1 })?.values).toEqual([
      '/net/pacs/queries/q/Study_1',
      '/net/pacs/queries/q/Study_1/Series_1',
      '/net/pacs/queries/q/Study_1/Series_2',
    ]);
  });

  it('numbers a PATIENT in its own sequence, hands a verb every series of theirs, and skips a miss', () => {
    answer_note('pacs.query', PACS_ANSWER, 'pacs query PatientID:1,2');
    const handles = answerHandles_get().filter((h) => h.kind === 'PAT');
    expect(handles).toEqual([{ kind: 'PAT', ordinal: 1, address: 'pacs:patient:PACSDCM:1' }]);
    expect(answerRow_get({ kind: 'PAT', ordinal: 1 })?.values).toEqual(['/net/pacs/queries/q/Study_1/Series_1', '/net/pacs/queries/q/Study_1/Series_2']);
    expect(answerRow_get({ kind: 'PAT', ordinal: 2 })).toBeNull();
  });

  it('derives a patient per study when the answer names none, so a single question numbers its patient too', () => {
    const single = { ...(PACS_ANSWER as Record<string, unknown>), patients: undefined };
    answer_note('pacs.query', single, 'pacs query AccessionNumber:A');
    expect(answerHandles_get().filter((h) => h.kind === 'PAT')).toEqual([{ kind: 'PAT', ordinal: 1, address: 'pacs:patient:-:1' }]);
  });

  it('tells a surface each row\'s handle beside its address', () => {
    answer_note('pacs.query', PACS_ANSWER, 'pacs query PatientID:1');
    expect(answerHandles_get()).toEqual([
      { kind: 'PAT', ordinal: 1, address: 'pacs:patient:PACSDCM:1' },
      { kind: 'STD', ordinal: 1, address: '/net/pacs/queries/q/Study_1' },
      { kind: 'SER', ordinal: 1, address: '/net/pacs/queries/q/Study_1/Series_1' },
      { kind: 'SER', ordinal: 2, address: '/net/pacs/queries/q/Study_1/Series_2' },
    ]);
  });

  it('numbers the cohort, so removing by number reads like every other act', () => {
    answer_note('gather.cohort', { series: [{ vfsPath: '/a', description: 'SAG' }, { vfsPath: '/b', kind: 'dir' }] }, 'gather list');
    expect(answerRow_get({ kind: 'SER', ordinal: 1 })?.label).toBe('SAG');
    expect(answerRow_get({ kind: 'DIR', ordinal: 1 })?.values).toEqual(['/b']);
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
  const ser = (ordinal: number) => ({ kind: 'SER', ordinal });

  it('reads a kind with a number, a list and a range', () => {
    expect(indices_parse('SER2')).toEqual([ser(2)]);
    expect(indices_parse('SER002')).toEqual([ser(2)]);
    expect(indices_parse('SER2,3,6')).toEqual([ser(2), ser(3), ser(6)]);
    expect(indices_parse('SER2-4')).toEqual([ser(2), ser(3), ser(4)]);
    expect(indices_parse('FIL1,3-5')).toEqual([1, 3, 4, 5].map((n) => ({ kind: 'FIL', ordinal: n })));
  });

  it('reads a backwards range as the rows it names', () => {
    expect(indices_parse('DIR4-2')).toEqual([4, 3, 2].map((n) => ({ kind: 'DIR', ordinal: n })));
  });

  it('is not an index without a kind it knows', () => {
    expect(indices_parse('2')).toBeNull();
    expect(indices_parse('XYZ1')).toBeNull();
  });
});

describe('an index on a line', () => {
  beforeEach(() => {
    answer_note('pacs.query', PACS_ANSWER, 'pacs query PatientID:1');
  });

  it('becomes the row it names', async () => {
    expect(await line_words('gather add @SER2'))
      .toEqual(['gather', 'add', '/net/pacs/queries/q/Study_1/Series_2']);
  });

  it('becomes SEVERAL operands when it names several rows', async () => {
    expect(await line_words('gather add @SER1,2')).toEqual([
      'gather', 'add',
      '/net/pacs/queries/q/Study_1/Series_1',
      '/net/pacs/queries/q/Study_1/Series_2',
    ]);
  });

  it('hands over a whole study as its series, which is what GATHER on a study does', async () => {
    expect(await line_words('gather add @STD1')).toEqual([
      'gather', 'add',
      '/net/pacs/queries/q/Study_1',
      '/net/pacs/queries/q/Study_1/Series_1',
      '/net/pacs/queries/q/Study_1/Series_2',
    ]);
  });

  it('refuses past the end rather than acting on the wrong row', async () => {
    expect(await line_words('gather add @SER9')).toEqual({ missing: '@SER9' });
  });

  it('is not an index without its kind: a bare number is a number', async () => {
    expect(await line_words('gather remove 2')).toEqual(['gather', 'remove', '2']);
  });

  it('refuses by KIND when the verb in hand does not take it', async () => {
    verbInHand_set('image');
    const refused = await line_words('image @STD1');
    verbInHand_set(null);
    expect(refused).toEqual({ missing: '@STD1' });
    expect(reference_refusal('@STD1')).toContain('image takes a series or a folder or a file; STD001 is a study');
  });

  it('is not an index inside a word, so an address is left alone', async () => {
    expect(await line_words('setfacl -m user@host:r /a')).toEqual(['setfacl', '-m', 'user@host:r', '/a']);
  });

  it('is text in quotes, like every other expansion', async () => {
    expect(await line_words("touch '@2'")).toEqual(['touch', '@2']);
  });

  it('says which listing it counted, once, for the line that used it', async () => {
    await line_words('gather add @SER1');
    const counted = answerConsulted_take();
    expect(counted?.source).toBe('pacs query PatientID:1');
    // The patient, the study and its two series: four rows, three sequences.
    expect(counted?.rows).toHaveLength(4);
    // Taken once: the next line did not use an index.
    expect(answerConsulted_take()).toBeNull();
  });
});
