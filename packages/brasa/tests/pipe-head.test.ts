/**
 * @file Unit tests for a variable at the head of a pipe: it hands on its
 * model to a builtin that reads one, and its operands as text to anything else.
 */
import { describe, it, expect, jest, beforeEach } from '@jest/globals';

jest.unstable_mockModule('../src/builtins/res/gather.store.js', () => ({
  cohort_read: async (): Promise<unknown> => ({ version: 1, name: null, feed: null, series: [] }),
}));
jest.unstable_mockModule('../src/session/index.js', () => ({
  session: { getCWD: async (): Promise<string> => '/home/chris' },
}));

const { chrisReferences, chrisAnswerKinds, chrisVerbTakes } = await import('../src/chris/references.js');
(await import('../src/core/backend.js')).backend_install({
  id: 'chris',
  session: {} as never,
  references: chrisReferences,
  answerKinds: chrisAnswerKinds,
  verbTakes: chrisVerbTakes,
});
(await import('../src/session/answerAdapters.js')).answerAdapters_register();
const { variable_set, variable_unset, textAnswer_make } = await import('../src/core/variables.js');
const { pipeHeadVariable_read } = await import('../src/core/pipeHead.js');

/** A PACS answer a grep kept: one series, with its study and patient as context. */
const ANSWER = {
  source: 'query PatientID:0001 | grep -i t1', kind: 'pacs.query', rows: [],
  data: {
    patients: [{ patientId: '0001' }],
    studies: [{
      studyUID: 's1', patientId: '0001', description: 'MRI BRAIN', vfsPath: '/net/pacs/queries/q1/s1',
      series: [{ seriesUID: '1.1', description: 'SAG T1', modality: 'MR', vfsPath: '/net/pacs/queries/q1/s1/1.1' }],
    }],
  },
};

beforeEach(() => {
  variable_unset('T1');
  variable_unset('L');
});

describe('pipeHeadVariable_read', () => {
  it('hands on the model a variable holds, and its operands as text', () => {
    variable_set('T1', ANSWER);
    for (const segment of ['${T1}', '$T1', '  ${T1} ']) {
      const reading = pipeHeadVariable_read(segment);
      expect(reading).toEqual({ output: expect.objectContaining({ model: { kind: 'pacs.query', data: ANSWER.data } }) });
      expect(reading !== null && 'output' in reading ? reading.output.text : '').toBe('/net/pacs/queries/q1/s1/1.1\n');
    }
  });

  it('hands on text as text, with no model', () => {
    variable_set('L', textAnswer_make('a\nb\n', 'cat list'));
    expect(pipeHeadVariable_read('${L}')).toEqual({ output: { text: 'a\nb\n', buffer: Buffer.from('a\nb\n') } });
  });

  it('refuses a name nothing has set, saying where it looked', () => {
    const reading = pipeHeadVariable_read('${NOPE}');
    expect(reading !== null && 'refused' in reading ? reading.refused : '').toContain('${NOPE}: nothing to put there');
  });

  it('leaves anything but a lone bare name to run as a command', () => {
    variable_set('T1', ANSWER);
    expect(pipeHeadVariable_read('${T1.studies}')).toBeNull();
    expect(pipeHeadVariable_read('ls ${T1}')).toBeNull();
    expect(pipeHeadVariable_read('${T1}x')).toBeNull();
    expect(pipeHeadVariable_read('query PatientID:1')).toBeNull();
  });
});
