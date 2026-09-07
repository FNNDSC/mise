/**
 * @file A move or a copy that was not told where.
 *
 * `mv foo` used to answer with a usage line — telling an operator something
 * they already knew instead of asking them the one thing they had not said.
 * What is pinned here is the shape of the question, because that is what
 * decides whether it can be answered without typing a path from scratch:
 * it opens where the source lives and offers the source's own name, so a
 * rename is a rename.
 */
import { jest, describe, it, expect, beforeEach } from '@jest/globals';

const mockPrompt = jest.fn<(request: Record<string, unknown>) => Promise<string>>();
jest.unstable_mockModule('../src/core/question.js', () => ({
  repl_questionPath: (message: string, path: unknown, commit?: string): Promise<string> =>
    mockPrompt({ message, wants: 'path', path, commit }),
}));
jest.unstable_mockModule('../src/builtins/utils.js', () => ({
  path_resolve: async (p: string): Promise<string> =>
    (p.startsWith('/') ? p : `/home/chris/${p}`),
}));

const { destination_ask, destination_missing } = await import('../src/builtins/fs/destination.js');

beforeEach((): void => {
  jest.clearAllMocks();
  mockPrompt.mockResolvedValue('/home/chris/elsewhere/report.txt');
});

describe('destination_ask', () => {
  it('asks where one file should go, offering its own name', async () => {
    const answer: string = await destination_ask({
      verb: 'mv', commit: 'MOVE HERE', sources: ['report.txt'],
    });
    const asked = mockPrompt.mock.calls[0][0] as {
      message: string; commit?: string;
      path?: { anchor?: string; wantsDirectory?: boolean; suggest?: string };
    };
    // The anchor is where the file already is: a fact, not an invention.
    expect(asked.path?.anchor).toBe('/home/chris');
    // And nothing is offered: the only name this verb could propose is the
    // source's own, and answering with it moves the file onto itself.
    expect(asked.path?.suggest).toBeUndefined();
    expect(asked.path?.wantsDirectory).toBe(false);
    expect(asked.commit).toBe('MOVE HERE');
    expect(asked.message).toContain('report.txt');
    expect(answer).toBe('/home/chris/elsewhere/report.txt');
  });

  // `mv a b c <dir>` is what a shell means by several sources, so several
  // sources want a folder and no name is offered.
  it('asks for a directory when there are several sources', async () => {
    await destination_ask({ verb: 'mv', commit: 'MOVE HERE', sources: ['a', 'b', 'c'] });
    const asked = mockPrompt.mock.calls[0][0] as {
      message: string; path?: { wantsDirectory?: boolean; suggest?: string };
    };
    expect(asked.path?.wantsDirectory).toBe(true);
    expect(asked.path?.suggest).toBeUndefined();
    expect(asked.message).toContain('3');
  });

  it('anchors on the first source when several are given', async () => {
    await destination_ask({ verb: 'cp', commit: 'COPY HERE', sources: ['/data/one.nii', '/data/two.nii'] });
    const asked = mockPrompt.mock.calls[0][0] as { path?: { anchor?: string } };
    expect(asked.path?.anchor).toBe('/data');
  });

  it('reads an abandoned question as no destination', async () => {
    mockPrompt.mockRejectedValue(new Error('the operator abandoned the question'));
    expect(await destination_ask({ verb: 'mv', commit: 'MOVE HERE', sources: ['a'] })).toBe('');
  });

  it('reads an empty answer the same way', async () => {
    mockPrompt.mockResolvedValue('   ');
    expect(await destination_ask({ verb: 'mv', commit: 'MOVE HERE', sources: ['a'] })).toBe('');
  });
});

describe('destination_missing', () => {
  it('says what did not happen, in the verb\'s own words', () => {
    expect(destination_missing('mv')).toContain('nothing moved');
    expect(destination_missing('cp')).toContain('nothing copied');
  });
});
