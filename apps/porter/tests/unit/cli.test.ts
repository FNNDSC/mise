/**
 * @file The porter entry's command line: the words it takes, and a refusal
 * by name for any other — a stray word once started a second door.
 */
import { describe, it, expect } from '@jest/globals';
import { porterArgs_parse, PORTER_USAGE } from '../../src/porter.js';

describe('porterArgs_parse', () => {
  it('serves with no words, and answers the ones it knows', () => {
    expect(porterArgs_parse([])).toEqual({ mode: 'serve' });
    expect(porterArgs_parse(['--status'])).toEqual({ mode: 'status' });
    expect(porterArgs_parse(['--sessions'])).toEqual({ mode: 'status' });
    expect(porterArgs_parse(['--end', 'chris'])).toEqual({ mode: 'end', who: 'chris' });
    expect(porterArgs_parse(['--help'])).toEqual({ mode: 'help' });
    expect(porterArgs_parse(['-h'])).toEqual({ mode: 'help' });
  });

  it('refuses an unknown word, a missing name and an extra one, by name', () => {
    expect(porterArgs_parse(['sessions'])).toEqual({ refusal: "unknown word 'sessions'" });
    expect(porterArgs_parse(['--end'])).toMatchObject({ refusal: expect.stringContaining('--end wants') });
    expect(porterArgs_parse(['--end', '--status'])).toMatchObject({ refusal: expect.stringContaining('--end wants') });
    expect(porterArgs_parse(['--end', 'a', 'b'])).toMatchObject({ refusal: expect.stringContaining("'b' is extra") });
    expect(porterArgs_parse(['--status', 'x'])).toMatchObject({ refusal: expect.stringContaining('takes no argument') });
    expect(PORTER_USAGE).toContain('--sessions');
  });
});
