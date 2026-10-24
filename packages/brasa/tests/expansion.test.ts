/**
 * @file Unit tests for the one expander.
 *
 * There used to be two: the dispatcher's, which substituted the environment
 * AFTER tokenizing (so a single-quoted `$HOME` expanded anyway), and play's,
 * which substituted parameters and pronouns BEFORE (so a path with a space
 * had to be quoted by hand). These pin the rules of the one that replaced
 * them — the shell's rules, which the stack claims to wear.
 */
import { describe, it, expect, jest, beforeEach } from '@jest/globals';

/** The cohort the fake session holds. */
let members: Array<{ vfsPath: string; kind: string; folderPath?: string }> = [];

jest.unstable_mockModule('../src/builtins/res/gather.store.js', () => ({
  cohort_read: async (): Promise<unknown> => ({ version: 1, name: 'sag', feed: null, series: members }),
}));
jest.unstable_mockModule('../src/session/index.js', () => ({
  session: { getCWD: async (): Promise<string> => '/home/chris/uploads' },
}));

// The ChRIS backend's references and kinds: the session itself is mocked above.
const { chrisReferences, chrisAnswerKinds, chrisVerbTakes } = await import('../src/chris/references.js');
(await import('../src/core/backend.js')).backend_install({
  id: 'chris',
  session: {} as never,
  references: chrisReferences,
  answerKinds: chrisAnswerKinds,
  verbTakes: chrisVerbTakes,
});
const { shellWords_tokenize, shellWords_referencesExpand } = await import('../src/lib/parser.js');
const { reference_resolve, unresolvedStands_run, reference_isReserved, reference_refusal } =
  await import('../src/core/expansion.js');
const { variableScope_run, variable_set, variable_unset, textAnswer_make } = await import('../src/core/variables.js');
(await import('../src/session/answerAdapters.js')).answerAdapters_register();
const { listingOperands_of } = await import('../src/core/listing.js');
const paramScope_run = variableScope_run;

/** Expands a whole line the way the dispatcher does, and returns the operands. */
async function line_words(line: string): Promise<string[] | { missing: string }> {
  const expanded = await shellWords_referencesExpand(shellWords_tokenize(line), reference_resolve);
  return expanded.ok ? expanded.words.map((word): string => word.value) : { missing: expanded.missing };
}

beforeEach(() => {
  members = [];
  delete process.env.MISE_TEST_VALUE;
});

describe('quoting decides what an expansion becomes', () => {
  it('splits a bare list-valued reference into several operands', async () => {
    members = [
      { vfsPath: '/net/pacs/q/Series_1', kind: 'series' },
      { vfsPath: '/net/pacs/q/Series 2 AX T2', kind: 'series' },
    ];
    expect(await line_words('pull ${gather}')).toEqual([
      'pull', '/net/pacs/q/Series_1', '/net/pacs/q/Series 2 AX T2',
    ]);
  });

  it('keeps a double-quoted list as ONE operand, however many values it holds', async () => {
    members = [
      { vfsPath: '/a', kind: 'dir' },
      { vfsPath: '/b', kind: 'dir' },
    ];
    expect(await line_words('echo "${gather}"')).toEqual(['echo', '/a /b']);
  });

  it('leaves a single-quoted reference as text, which is what makes a $ in a value safe', async () => {
    process.env.MISE_TEST_VALUE = 'expanded';
    expect(await line_words("echo '${MISE_TEST_VALUE}'")).toEqual(['echo', '${MISE_TEST_VALUE}']);
  });

  it('keeps a single value with spaces as one operand, unquoted', async () => {
    members = [{ vfsPath: '/net/pacs/q/Series 2 AX T2', kind: 'series' }];
    expect(await line_words('image ${gather}')).toEqual(['image', '/net/pacs/q/Series 2 AX T2']);
  });

  it('joins a reference with the text around it', async () => {
    process.env.MISE_TEST_VALUE = '1279049';
    expect(await line_words('pacs query PatientID:${MISE_TEST_VALUE}'))
      .toEqual(['pacs', 'query', 'PatientID:1279049']);
  });
});

describe('what answers a reference, and in what order', () => {
  it('answers a variable before the environment', async () => {
    process.env.MISE_TEST_VALUE = 'from the environment';
    expect(await line_words('echo ${MISE_TEST_VALUE}')).toEqual(['echo', 'from the environment']);
    variable_set('MISE_TEST_VALUE', textAnswer_make('from a line', 'MISE_TEST_VALUE=x'));
    expect(await line_words('echo ${MISE_TEST_VALUE}')).toEqual(['echo', 'from a line']);
    variable_unset('MISE_TEST_VALUE');
  });

  it('has retired the pronouns a run used to fill behind the line', async () => {
    expect(reference_isReserved('feed')).toBe(false);
    expect(reference_isReserved('run')).toBe(false);
    expect(reference_isReserved('query')).toBe(false);
    expect(await line_words('cd ${run.place}')).toEqual({ missing: 'run.place' });
  });

  it("answers a manifest's parameter before the environment", async () => {
    process.env.MISE_TEST_VALUE = 'from the environment';
    const words = await paramScope_run(
      new Map([['MISE_TEST_VALUE', 'from the manifest']]),
      async (): Promise<string[] | { missing: string }> => await line_words('echo ${MISE_TEST_VALUE}'),
    );
    expect(words).toEqual(['echo', 'from the manifest']);
  });

  it('knows which names the session owns', () => {
    expect(reference_isReserved('gather.series.folderPath')).toBe(true);
    expect(reference_isReserved('cwd')).toBe(true);
    expect(reference_isReserved('MRN')).toBe(false);
  });

  it('reads the cohort by its own fields: where members landed, and refuses a member that has not', async () => {
    members = [{ vfsPath: '/net/pacs/q/S1', kind: 'series', folderPath: '/home/chris/SERVICES/s1' }];
    expect(await line_words('image ${gather.series.folderPath}')).toEqual(['image', '/home/chris/SERVICES/s1']);
    expect(await line_words('echo ${gather.name}')).toEqual(['echo', 'sag']);

    members = [{ vfsPath: '/net/pacs/q/S2', kind: 'series' }];
    expect(await line_words('image ${gather.series.folderPath}')).toEqual({ missing: 'gather.series.folderPath' });
    expect(reference_refusal('gather.series.folderPath')).toMatch(/gather\.series has no field folderPath/);
  });

  it('refuses an empty cohort by name instead of expanding to nothing', async () => {
    expect(await line_words('pull ${gather}')).toEqual({ missing: 'gather' });
    expect(reference_refusal('gather')).toBe('${gather}: gather is empty.');
  });

});

describe('a reference nothing answers', () => {
  it('refuses the line rather than deleting the wrong thing', async () => {
    expect(await line_words('rm -rf ${MISE_TEST_UNSET}/scratch')).toEqual({ missing: 'MISE_TEST_UNSET' });
  });

  it('refuses a variable no line has set', async () => {
    expect(await line_words('expect run ${A.instanceId} status eq x')).toEqual({ missing: 'A.instanceId' });
  });

  it('stands as written inside a dry run, which has run nothing', async () => {
    const expanded = await unresolvedStands_run(async () =>
      await shellWords_referencesExpand(shellWords_tokenize('cd ${A.outputPath}'), reference_resolve, true));
    expect(expanded.ok && expanded.words.map((word) => word.value)).toEqual(['cd', '${A.outputPath}']);
  });
});

describe('the command word', () => {
  it('expands too, because a manifest names its plugin as a parameter', async () => {
    const words = await paramScope_run(
      new Map([['ANON', 'pl-pfdicom_tagSub-v3.3.4']]),
      async (): Promise<string[] | { missing: string }> => await line_words('${ANON} --fileFilter dcm'),
    );
    expect(words).toEqual(['pl-pfdicom_tagSub-v3.3.4', '--fileFilter', 'dcm']);
  });
});

describe('an expanded value is a value', () => {
  it('does not become a glob pattern after expansion', async () => {
    members = [{ vfsPath: '/home/chris/uploads/scan[1].dcm', kind: 'file' }];
    const expanded = await shellWords_referencesExpand(
      shellWords_tokenize('cat ${gather}'), reference_resolve,
    );
    expect(expanded.ok && expanded.words[1].pathnameExpansion).toBe(false);
    expect(expanded.ok && expanded.words[1].value).toBe('/home/chris/uploads/scan[1].dcm');
  });
});

describe('a refusal says where it looked', () => {
  it('names the session and the environment outside a manifest', () => {
    expect(reference_refusal('NOWHERE')).toBe("${NOWHERE}: nothing to put there. Looked in the session's built-ins, its variables, the environment.");
  });

  it('adds the manifest parameters inside one, and says a built-in has nothing yet', async () => {
    const text: string = await paramScope_run(new Map(), async (): Promise<string> => reference_refusal('listing'));
    expect(text).toContain('nothing in this session has one yet');
    expect(text).toContain("this manifest's variables and parameters");
  });

  it('tells an index that nothing is numbered yet', () => {
    expect(reference_refusal('@SER1')).toBe('@SER1: nothing is numbered yet — list something first.');
  });
});

describe('a variable holds an answer, and a dot is a field of it', () => {
  const RUN = {
    source: 'pl-dcm2niix', kind: 'run.scheduled', rows: [],
    data: { pluginName: 'pl-dcm2niix', instanceId: 4812, feedId: 977, newFeed: true, outputPath: '/home/chris/feeds/feed_977/pl-dcm2niix_4812/data' },
  };
  const PIPELINE = {
    source: 'dcm-pipe', kind: 'pipeline.scheduled', rows: [],
    data: { feedId: 977, instances: [{ instanceId: 1, outputPath: '/o/1' }, { instanceId: 2, outputPath: '/o/2' }], tags: ['a', 'b'] },
  };

  beforeEach(() => {
    variable_unset('A');
    variable_unset('P');
    variable_unset('T');
  });

  it('reads a field by the name the model gives it', async () => {
    variable_set('A', RUN);
    expect(await line_words('expect run ${A.instanceId} status eq finishedSuccessfully'))
      .toEqual(['expect', 'run', '4812', 'status', 'eq', 'finishedSuccessfully']);
    expect(await line_words('cd ${A.outputPath}')).toEqual(['cd', '/home/chris/feeds/feed_977/pl-dcm2niix_4812/data']);
  });

  it('refuses a bare name for one thing with several fields, and names the fields', async () => {
    variable_set('A', RUN);
    expect(await line_words('cd ${A}')).toEqual({ missing: 'A' });
    expect(reference_refusal('A')).toBe('${A}: A is a run.scheduled; name a field: pluginName, instanceId, feedId, newFeed, outputPath.');
  });

  it('refuses a field the model does not have, saying what it has', async () => {
    variable_set('A', RUN);
    expect(await line_words('cd ${A.place}')).toEqual({ missing: 'A.place' });
    expect(reference_refusal('A.place')).toBe('${A.place}: A has no field place; it has pluginName, instanceId, feedId, newFeed, outputPath.');
  });

  it('reaches through a list: one operand per element, and a list of values spreads', async () => {
    variable_set('P', PIPELINE);
    expect(await line_words('ls ${P.instances.outputPath}')).toEqual(['ls', '/o/1', '/o/2']);
    expect(await line_words('echo ${P.tags}')).toEqual(['echo', 'a', 'b']);
    // Bare, a scheduled pipeline is its nodes.
    expect(await line_words('expect run ${P} status eq x')).toEqual(['expect', 'run', '1', '2', 'status', 'eq', 'x']);
    expect(await line_words('echo ${P.instances}')).toEqual({ missing: 'P.instances' });
    expect(reference_refusal('P.instances')).toBe('${P.instances}: P.instances holds records; name a field: instanceId, outputPath.');
  });

  it('expands text one line per operand, spaces kept', async () => {
    variable_set('T', textAnswer_make('/home/r/My Scans/a.dcm\n/home/r/b.dcm\n', 'cat list.txt'));
    expect(await line_words('rm ${T}')).toEqual(['rm', '/home/r/My Scans/a.dcm', '/home/r/b.dcm']);
    expect(await line_words('rm ${T.x}')).toEqual({ missing: 'T.x' });
    expect(reference_refusal('T.x')).toBe('${T.x}: T is text; it has no field x.');
  });

  it('refuses empty text by name', async () => {
    variable_set('T', textAnswer_make('', 'grep nothing'));
    expect(await line_words('rm ${T}')).toEqual({ missing: 'T' });
    expect(reference_refusal('T')).toBe('${T}: T is empty.');
  });

  it("keeps a play's variables and parameters to the play, and its parameters read-only", async () => {
    variable_set('A', RUN);
    await variableScope_run(new Map([['SUBJECT', 'anon-001']]), async (): Promise<void> => {
      expect(await line_words('echo ${A.instanceId}')).toEqual({ missing: 'A.instanceId' });
      expect(variable_set('SUBJECT', textAnswer_make('x', 'SUBJECT=x'))).toBe('SUBJECT is a parameter of this manifest; it is read-only');
      expect(variable_unset('SUBJECT')).toBe('SUBJECT is a parameter of this manifest; it is read-only');
      variable_set('C', RUN);
      expect(await line_words('echo ${SUBJECT} ${C.feedId}')).toEqual(['echo', 'anon-001', '977']);
    });
    expect(await line_words('echo ${C.feedId}')).toEqual({ missing: 'C.feedId' });
    expect(await line_words('echo ${A.feedId}')).toEqual(['echo', '977']);
  });
});

describe('a variable holding a listing expands as a pipe hands it on', () => {
  // A PACS answer a grep kept: two T1 series in two studies, with the
  // patient and study rows the grep kept beside them as context.
  const series = (study: string, uid: string, description: string): Record<string, unknown> =>
    ({ seriesUID: uid, description, modality: 'MR', vfsPath: `/net/pacs/queries/q1/${study}/${uid}` });
  const ANSWER = {
    source: 'query PatientID:0001 | grep -i t1', kind: 'pacs.query', rows: [],
    data: {
      patients: [{ patientId: '0001' }],
      studies: [
        { studyUID: 's1', patientId: '0001', description: 'MRI BRAIN', vfsPath: '/net/pacs/queries/q1/s1', series: [series('s1', '1.1', 'SAG T1')] },
        { studyUID: 's2', patientId: '0001', description: 'MRI SPINE', vfsPath: '/net/pacs/queries/q1/s2', series: [series('s2', '2.1', 'AX T1')] },
      ],
    },
  };

  beforeEach(() => { variable_unset('Q'); });

  it('gives the series once each, never a study or patient row', async () => {
    variable_set('Q', ANSWER);
    expect(await line_words('gather add ${Q}'))
      .toEqual(['gather', 'add', '/net/pacs/queries/q1/s1/1.1', '/net/pacs/queries/q1/s2/2.1']);
  });

  it('gives what the same answer piped into a verb gives', async () => {
    variable_set('Q', ANSWER);
    const piped: string[] | null = listingOperands_of({ kind: ANSWER.kind, data: ANSWER.data });
    expect(await line_words('pull ${Q}')).toEqual(['pull', ...(piped ?? [])]);
  });

  it('still reaches the studies by field', async () => {
    variable_set('Q', ANSWER);
    expect(await line_words('ls ${Q.studies.vfsPath}')).toEqual(['ls', '/net/pacs/queries/q1/s1', '/net/pacs/queries/q1/s2']);
  });
});
