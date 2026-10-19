/**
 * @jest-environment jsdom
 */
/**
 * @file The ARGUS language's `trek` subject: a game line opens the bridge
 * through the host, and the words the session answers at once (`--credits`,
 * `--help`, `--version`) are left to the session, so the surface claims
 * only what it draws.
 */
import { describe, it, expect } from '@jest/globals';
import { argusLine_run, trekLine_isGame, VERB_LINES, type ArgusHost } from '../../src/console/argusLang.js';

/** A host that records the trek lines it was asked to open and answers nothing else. */
function host_make(opened: string[]): ArgusHost {
  return { trek_open: (line: string): string => { opened.push(line); return 'trek: the bridge takes the screen'; } } as unknown as ArgusHost;
}

describe('the trek subject', () => {
  it('names a game of trek, and not the words the session answers at once', () => {
    expect(trekLine_isGame('trek')).toBe(true);
    expect(trekLine_isGame('trek --seed 42')).toBe(true);
    expect(trekLine_isGame('trek --credits')).toBe(false);
    expect(trekLine_isGame('trek --version')).toBe(false);
    expect(trekLine_isGame('trek -h')).toBe(false);
    expect(trekLine_isGame('trekking')).toBe(false);
  });

  it('opens the bridge through the host for a game line and leaves the rest to the session', async () => {
    const opened: string[] = [];
    const host: ArgusHost = host_make(opened);
    expect(await argusLine_run(host, 'trek --seed 42')).toBe('trek: the bridge takes the screen');
    expect(opened).toEqual(['trek --seed 42']);
    expect(await argusLine_run(host, 'trek --credits')).toBeNull();
    expect(await argusLine_run(host, 'trek --version')).toBeNull();
    expect(opened).toHaveLength(1);
  });

  it('is in the verb table the command line prints', () => {
    expect(VERB_LINES.some((line: string): boolean => line.startsWith('trek [--seed <n>]'))).toBe(true);
  });
});
