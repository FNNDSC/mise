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

const { shellWords_tokenize, shellWords_referencesExpand } = await import('../src/lib/parser.js');
const { reference_resolve, paramScope_run, unresolvedStands_run, reference_isReserved, reference_refusal } =
  await import('../src/core/expansion.js');
const { recentFeed_note, recentRunPlace_note, recentRuns_note, recent_forget } =
  await import('../src/session/recent.js');

/** Expands a whole line the way the dispatcher does, and returns the operands. */
async function line_words(line: string): Promise<string[] | { missing: string }> {
  const expanded = await shellWords_referencesExpand(shellWords_tokenize(line), reference_resolve);
  return expanded.ok ? expanded.words.map((word): string => word.value) : { missing: expanded.missing };
}

beforeEach(() => {
  members = [];
  recent_forget();
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
    expect(await line_words('image ${gather.first}')).toEqual(['image', '/net/pacs/q/Series 2 AX T2']);
  });

  it('joins a reference with the text around it', async () => {
    process.env.MISE_TEST_VALUE = '1279049';
    expect(await line_words('pacs query PatientID:${MISE_TEST_VALUE}'))
      .toEqual(['pacs', 'query', 'PatientID:1279049']);
  });
});

describe('what answers a reference, and in what order', () => {
  it('answers the session before the environment', async () => {
    process.env.MISE_TEST_VALUE = 'from the environment';
    recentFeed_note(4599);
    expect(await line_words('expect feed ${feed} status eq x'))
      .toEqual(['expect', 'feed', '4599', 'status', 'eq', 'x']);
    expect(await line_words('echo ${MISE_TEST_VALUE}')).toEqual(['echo', 'from the environment']);
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
    expect(reference_isReserved('gather.first.place')).toBe(true);
    expect(reference_isReserved('feed')).toBe(true);
    expect(reference_isReserved('MRN')).toBe(false);
  });

  it('gives a member its place, and refuses when it has none', async () => {
    members = [{ vfsPath: '/net/pacs/q/S1', kind: 'series', folderPath: '/home/chris/SERVICES/s1' }];
    expect(await line_words('image ${gather.first.place}')).toEqual(['image', '/home/chris/SERVICES/s1']);

    members = [{ vfsPath: '/net/pacs/q/S2', kind: 'series' }];
    expect(await line_words('image ${gather.first.place}')).toEqual({ missing: 'gather.first.place' });
  });

  it('answers where the last run wrote, which is what a chain takes', async () => {
    recentRuns_note([601164]);
    recentRunPlace_note('/home/chris/feeds/feed_1/pl-x_2/data/');
    expect(await line_words('cd ${run.place}')).toEqual(['cd', '/home/chris/feeds/feed_1/pl-x_2/data/']);
  });
});

describe('a reference nothing answers', () => {
  it('refuses the line rather than deleting the wrong thing', async () => {
    expect(await line_words('rm -rf ${MISE_TEST_UNSET}/scratch')).toEqual({ missing: 'MISE_TEST_UNSET' });
  });

  it('refuses a session pronoun the session cannot answer yet', async () => {
    expect(await line_words('expect feed ${feed} status eq x')).toEqual({ missing: 'feed' });
  });

  it('stands as written inside a dry run, which has run nothing', async () => {
    const expanded = await unresolvedStands_run(async () =>
      await shellWords_referencesExpand(shellWords_tokenize('cd ${run.place}'), reference_resolve, true));
    expect(expanded.ok && expanded.words.map((word) => word.value)).toEqual(['cd', '${run.place}']);
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
      shellWords_tokenize('cat ${gather.first}'), reference_resolve,
    );
    expect(expanded.ok && expanded.words[1].pathnameExpansion).toBe(false);
    expect(expanded.ok && expanded.words[1].value).toBe('/home/chris/uploads/scan[1].dcm');
  });
});

describe('a refusal says where it looked', () => {
  it('names the session and the environment outside a manifest', () => {
    expect(reference_refusal('NOWHERE')).toBe('${NOWHERE}: nothing to put there. Looked in the session, the environment.');
  });

  it('adds the manifest parameters inside one, and says a pronoun is not yet filled', async () => {
    const text: string = await paramScope_run(new Map(), async (): Promise<string> => reference_refusal('feed'));
    expect(text).toContain('nothing in this session has one yet');
    expect(text).toContain("this manifest's parameters");
  });

  it('tells an index that nothing is numbered yet', () => {
    expect(reference_refusal('@SER1')).toBe('@SER1: nothing is numbered yet — list something first.');
  });
});
