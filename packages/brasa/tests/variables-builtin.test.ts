/**
 * @file Unit tests for `set` and `unset`: listing what is held, showing one
 * whole, and refusing what POSIX `set` does but this one does not.
 */
import { describe, it, expect, beforeEach } from '@jest/globals';

const { builtin_set, builtin_unset } = await import('../src/builtins/sys/variables.js');
const { variable_set, variable_unset, variable_get, variableScope_run, textAnswer_make } = await import('../src/core/variables.js');

const RUN = { source: 'pl-dcm2niix', kind: 'run.scheduled', rows: [], data: { instanceId: 4812, outputPath: '/o' } };

beforeEach(() => {
  for (const name of ['A', 'L']) variable_unset(name);
  process.exitCode = 0;
});

describe('set', () => {
  it('says there is nothing to list before anything is set', async () => {
    const envelope = await builtin_set([]);
    expect(envelope.rendered).toContain('no variables set');
    expect(envelope.model).toEqual({ kind: 'variables.list', data: [] });
  });

  it('lists each variable with its kind and what it holds', async () => {
    variable_set('A', RUN);
    variable_set('L', textAnswer_make('sag cohort', "L='sag cohort'"));
    const envelope = await builtin_set([]);
    expect(envelope.model?.data).toEqual([
      { name: 'A', kind: 'run.scheduled', source: 'pl-dcm2niix', readOnly: false, summary: 'is a run.scheduled; name a field: instanceId, outputPath' },
      { name: 'L', kind: 'text', source: "L='sag cohort'", readOnly: false, summary: 'sag cohort' },
    ]);
  });

  it('shows one variable whole and answers with its own model', async () => {
    variable_set('A', RUN);
    const envelope = await builtin_set(['A']);
    expect(envelope.rendered).toContain('"instanceId": 4812');
    expect(envelope.model).toEqual({ kind: 'run.scheduled', data: RUN.data });
  });

  it("refuses POSIX set's options by name, and a name it does not hold", async () => {
    expect((await builtin_set(['-e'])).status).toBe('error');
    expect((await builtin_set(['NOPE'])).renderedErr).toContain('set: NOPE: no such variable');
  });

  it("marks a manifest's parameters read-only", async () => {
    await variableScope_run(new Map([['SUBJECT', 'anon-001']]), async (): Promise<void> => {
      const envelope = await builtin_set([]);
      expect(envelope.model?.data).toEqual([
        { name: 'SUBJECT', kind: 'text', source: '@param SUBJECT', readOnly: true, summary: 'anon-001' },
      ]);
    });
  });
});

describe('unset', () => {
  it('removes quietly, as unset does', async () => {
    variable_set('A', RUN);
    const envelope = await builtin_unset(['A']);
    expect(envelope).toMatchObject({ status: 'ok', rendered: '' });
    expect(variable_get('A')).toBeUndefined();
  });

  it("refuses a parameter, the session's own names, and nothing to remove", async () => {
    expect((await builtin_unset([])).status).toBe('error');
    expect((await builtin_unset(['cwd'])).renderedErr).toContain('${cwd} is the session\'s own; it is read-only');
    await variableScope_run(new Map([['SUBJECT', 'anon-001']]), async (): Promise<void> => {
      expect((await builtin_unset(['SUBJECT'])).renderedErr).toContain('SUBJECT is a parameter of this manifest; it is read-only');
    });
  });
});
