/**
 * @file Unit tests for playing a manifest.
 *
 * The claims worth pinning: a manifest says what it needs and is refused
 * BEFORE it changes anything when it does not have it; a gathered path with
 * a space in it is one operand, not several; a refused line stops the play;
 * and a dry run touches nothing.
 */
import { describe, it, expect, jest, beforeEach } from '@jest/globals';

/** Lines the fake session was asked to run. */
const ran: string[] = [];
/** What the next line_execute answers. */
let refuseAt: string | null = null;

/** The manifest the fake filesystem holds. */
let stored: string = '';

/** The cohort the fake session holds. */
let members: Array<{ vfsPath: string; kind: string }> = [];

jest.unstable_mockModule('@fnndsc/cumin', () => ({
  envelope_ok: (rendered: string, model?: unknown) => ({ status: 'ok', rendered, model }),
  envelope_error: (rendered: string, _errors?: unknown, renderedErr?: string) => ({ status: 'error', rendered, renderedErr }),
  listCache_get: () => ({ cache_invalidate: (): void => undefined }),
  // Reading a manifest asks CFS first and drains the miss when it is not there.
  errorStack: { checkpoint_mark: (): number => 0, checkpoint_drain: (): unknown[] => [] },
}));

jest.unstable_mockModule('@fnndsc/salsa', () => ({
  fileContent_get: async (): Promise<{ ok: boolean; value?: string }> => ({ ok: true, value: stored }),
  files_path_isDirectory: async (): Promise<boolean> => true,
}));

jest.unstable_mockModule('@fnndsc/chili/commands/fs/touch.js', () => ({ files_touch: async (): Promise<boolean> => true }));
jest.unstable_mockModule('@fnndsc/chili/commands/fs/mkdir.js', () => ({ files_mkdir: async (): Promise<boolean> => true }));

jest.unstable_mockModule('../src/builtins/utils.js', () => ({
  path_resolve: async (p: string): Promise<string> => p,
  commandArgs_process: (args: string[]) => ({ _: args }),
}));

jest.unstable_mockModule('../src/session/index.js', () => ({
  session: { getCWD: async (): Promise<string> => '/home/chris/uploads' },
}));

const output: string[] = [];
jest.unstable_mockModule('../src/core/sink.js', () => ({
  sink_dataLine: (line: string): void => { output.push(line); },
  sink_errLine: (line: string): void => { output.push(line); },
}));

jest.unstable_mockModule('../src/core/engine.js', () => ({
  line_execute: async (line: string): Promise<Array<{ status: string; rendered: string }>> => {
    ran.push(line);
    return [{ status: refuseAt !== null && line.includes(refuseAt) ? 'error' : 'ok', rendered: '' }];
  },
}));

// The cohort is read for its pronouns; the store's own file path is mocked above.
jest.unstable_mockModule('../src/builtins/res/gather.store.js', () => ({
  cohort_read: async (): Promise<{ version: number; name: string | null; feed: null; series: typeof members }> =>
    ({ version: 1, name: 'sag cohort', feed: null, series: members }),
}));

const { builtin_play, manifest_parse, line_expand, playArgs_parse } = await import('../src/builtins/res/play.js');
const { recentFeed_note, recent_forget } = await import('../src/session/recent.js');

beforeEach(() => {
  ran.length = 0;
  output.length = 0;
  refuseAt = null;
  stored = '';
  members = [];
  recent_forget();
  process.exitCode = 0;
});

describe('manifest_parse', () => {
  it('reads what the file says about itself, and keeps the line numbers', () => {
    const manifest = manifest_parse([
      '# a workflow',
      '@name  sag cohort',
      '@description  gather and process',
      '@param MRN',
      '@param LABEL = draft',
      '',
      'pacs query PatientID:${MRN}',
      'gather add --shown',
    ].join('\n'));
    expect(manifest.name).toBe('sag cohort');
    expect(manifest.description).toBe('gather and process');
    expect(manifest.params).toEqual([{ name: 'MRN' }, { name: 'LABEL', fallback: 'draft' }]);
    expect(manifest.lines.map((line) => line.number)).toEqual([7, 8]);
  });
});

describe('playArgs_parse', () => {
  it('keeps EVERY --param, which a generic parser would not', () => {
    const parsed = playArgs_parse(['f.mise', '--param', 'MRN=1', '--param', 'LABEL=two words']);
    expect(parsed.params.get('MRN')).toBe('1');
    expect(parsed.params.get('LABEL')).toBe('two words');
  });

  it('refuses --step, which needs a terminal, by name', () => {
    expect(playArgs_parse(['f.mise', '--step']).parseError).toContain('terminal');
  });
});

describe('line_expand', () => {
  it('makes one operand of a path with a space in it', async () => {
    members = [{ vfsPath: '/net/pacs/queries/q/Series_1.2.3 AX T2', kind: 'series' }];
    const expanded = await line_expand('pull ${gather}', new Map());
    expect(expanded).toEqual({ text: "pull '/net/pacs/queries/q/Series_1.2.3 AX T2'" });
  });

  it('answers the cohort pronouns from the cohort', async () => {
    members = [{ vfsPath: '/a', kind: 'dir' }, { vfsPath: '/b', kind: 'dir' }];
    expect(await line_expand('image ${gather.first}', new Map())).toEqual({ text: 'image /a' });
    expect(await line_expand('image ${gather.last}', new Map())).toEqual({ text: 'image /b' });
    expect(await line_expand('expect gather size eq ${gather.size}', new Map()))
      .toEqual({ text: 'expect gather size eq 2' });
  });

  it('refuses a pronoun the session cannot answer yet, by name', async () => {
    const expanded = await line_expand('expect feed ${feed} status eq finishedSuccessfully', new Map());
    expect('refusal' in expanded && expanded.refusal).toContain('${feed}');
  });

  it('answers ${feed} once something has made one', async () => {
    recentFeed_note(4599);
    expect(await line_expand('expect feed ${feed} status eq x', new Map()))
      .toEqual({ text: 'expect feed 4599 status eq x' });
  });
});

describe('play', () => {
  it('refuses a manifest it cannot fill in, BEFORE running any line', async () => {
    stored = ['@param MRN', 'pacs query PatientID:${MRN}'].join('\n');
    const envelope = await builtin_play(['f.mise']);
    expect(envelope.status).toBe('error');
    expect(envelope.renderedErr).toContain('--param MRN=');
    expect(ran).toEqual([]);
  });

  it('takes a default when the operator gives nothing', async () => {
    stored = ['@param LABEL = draft', 'feed create ${LABEL}'].join('\n');
    await builtin_play(['f.mise']);
    expect(ran).toEqual(['feed create draft']);
  });

  it('runs the lines in order, showing each one before it runs', async () => {
    stored = ['pwd', 'ls'].join('\n');
    const envelope = await builtin_play(['f.mise']);
    expect(ran).toEqual(['pwd', 'ls']);
    expect(output.some((line: string): boolean => line.includes('▸ pwd'))).toBe(true);
    expect(envelope.status).toBe('ok');
  });

  it('stops where the trouble is, and says which line', async () => {
    stored = ['pwd', 'ls /nowhere', 'pwd'].join('\n');
    refuseAt = '/nowhere';
    const envelope = await builtin_play(['f.mise']);
    expect(ran).toEqual(['pwd', 'ls /nowhere']);
    expect(envelope.status).toBe('error');
    expect(envelope.renderedErr).toContain('line 2');
    expect(process.exitCode).toBe(1);
  });

  it('leaves a pronoun a dry run cannot know as it was written', async () => {
    // Nothing has run, so ${feed} has no value — refusing there would make
    // --dry-run useless for exactly the manifests that chain.
    stored = ['pwd', 'expect feed ${feed} status eq finishedSuccessfully'].join('\n');
    const envelope = await builtin_play(['f.mise', '--dry-run']);
    expect(envelope.status).toBe('ok');
    expect(output.some((line: string): boolean => line.includes('expect feed ${feed} status'))).toBe(true);
  });

  it('shows a dry run without running anything', async () => {
    stored = ['@param MRN', 'pacs query PatientID:${MRN}'].join('\n');
    const envelope = await builtin_play(['f.mise', '--param', 'MRN=1279049', '--dry-run']);
    expect(ran).toEqual([]);
    expect(output.some((line: string): boolean => line.includes('pacs query PatientID:1279049'))).toBe(true);
    expect(envelope.status).toBe('ok');
  });
});
