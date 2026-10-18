/**
 * @file The session's `trek`: the bsd-trek game wired to the session, its
 * lines to the data channel and its prompts asked as questions. The game
 * itself is tested in the bsd-trek package, against the original's
 * transcripts.
 */
import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { cuminMock_install } from './support/cuminMock.js';

cuminMock_install(() => ({
  envelope_ok: (rendered: string, model?: unknown) => ({ status: 'ok', rendered, model }),
  envelope_error: (rendered: string, _errors?: unknown, renderedErr?: string) => (renderedErr !== undefined ? { status: 'error', rendered, renderedErr } : { status: 'error', rendered }),
}));
const answers: string[] = [];
let written: string = '';
jest.unstable_mockModule('../src/core/question.js', () => ({
  repl_question: async (prompt: string): Promise<string> => {
    written += prompt;
    const next: string | undefined = answers.shift();
    if (next === undefined) throw new Error('no surface');
    return next;
  },
}));
jest.unstable_mockModule('../src/core/sink.js', () => ({ sink_get: () => ({ data_write: (text: string): void => { written += text; } }) }));

const { builtin_trek } = await import('../src/builtins/games/trek.js');

beforeEach(() => { answers.length = 0; written = ''; });

describe('the trek command', () => {
  it('refuses an unknown flag by name', async () => {
    const refused = await builtin_trek(['--warp']);
    expect(refused.status).toBe('error');
    expect((refused as { renderedErr?: string }).renderedErr).toContain("unknown option '--warp'");
    expect(((await builtin_trek(['extra'])) as { renderedErr?: string }).renderedErr).toContain('usage: trek');
  });

  it('plays a seeded classic game through the session, prompts as questions', async () => {
    answers.push('', 's', 'n', 'pw', 'terminate', 'n');
    const ended = await builtin_trek(['--classic', '--seed', '42', '-f', '-s']);
    expect(ended.status).toBe('ok');
    expect(ended.model).toEqual({ kind: 'games.trek', data: { seed: 42, exit: 0 } });
    expect(written).toContain('S T A R   T R E K');
    expect(written).toContain('What length game: ');
    expect(written).toContain('\nCommand: ');
  });

  it('says so when the session cannot ask', async () => {
    const ended = await builtin_trek(['--seed', '1']);
    expect(ended.status).toBe('error');
    expect((ended as { renderedErr?: string }).renderedErr).toContain('trek: cannot ask here');
  });
});
