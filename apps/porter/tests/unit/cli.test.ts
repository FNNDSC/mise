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
    expect(porterArgs_parse(['--version'])).toEqual({ mode: 'version' });
    expect(porterArgs_parse(['-V'])).toEqual({ mode: 'version' });
    expect(porterArgs_parse(['--version', 'extra'])).toEqual({ refusal: "--version takes no argument ('extra')" });
    expect(porterArgs_parse(['-h'])).toEqual({ mode: 'help' });
    expect(porterArgs_parse(['--tokens'])).toEqual({ mode: 'tokens' });
    expect(porterArgs_parse(['--revoke', 'chris'])).toEqual({ mode: 'revoke', user: 'chris' });
    expect(porterArgs_parse(['--revoke', 'chris', 'cron@titan'])).toEqual({ mode: 'revoke', user: 'chris', name: 'cron@titan' });
    expect(porterArgs_parse(['--mint', 'mise-e2e', '--name', 'nightly'])).toEqual({ mode: 'mint', user: 'mise-e2e', name: 'nightly' });
  });

  it('refuses an unknown word, a missing name and an extra one, by name', () => {
    expect(porterArgs_parse(['sessions'])).toEqual({ refusal: "unknown word 'sessions'" });
    expect(porterArgs_parse(['--end'])).toMatchObject({ refusal: expect.stringContaining('--end wants') });
    expect(porterArgs_parse(['--end', '--status'])).toMatchObject({ refusal: expect.stringContaining('--end wants') });
    expect(porterArgs_parse(['--end', 'a', 'b'])).toMatchObject({ refusal: expect.stringContaining("'b' is extra") });
    expect(porterArgs_parse(['--tokens', 'x'])).toMatchObject({ refusal: expect.stringContaining('--tokens takes no argument') });
    expect(porterArgs_parse(['--revoke'])).toMatchObject({ refusal: expect.stringContaining('--revoke wants') });
    expect(porterArgs_parse(['--revoke', 'a', 'b', 'c'])).toMatchObject({ refusal: expect.stringContaining("'c' is extra") });
    expect(porterArgs_parse(['--mint', 'chris'])).toMatchObject({ refusal: expect.stringContaining('--name <name>') });
    expect(porterArgs_parse(['--mint', 'chris', 'nightly'])).toMatchObject({ refusal: expect.stringContaining('--name <name>') });
    expect(porterArgs_parse(['--status', 'x'])).toMatchObject({ refusal: expect.stringContaining('takes no argument') });
    expect(PORTER_USAGE).toContain('--sessions');
  });
});
