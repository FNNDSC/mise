/**
 * @file A remote chell says when it and its daemon are different builds.
 */
import { describe, it, expect } from '@jest/globals';
import { buildMismatch_line, closingLine_of, staleLines_of, surfaceNews_read } from '../src/remote/buildMatch.js';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('buildMismatch_line', () => {
  it('names both builds and the cure when they differ', () => {
    const line: string | null = buildMismatch_line('7bedda', '1c8b92');
    expect(line).toBe('[!] This chell (7bedda) and the calypso daemon (1c8b92) are different builds. Restart the calypso daemon.');
  });

  it('says nothing when they agree, or when either names no commit', () => {
    expect(buildMismatch_line('7bedda', '7bedda')).toBeNull();
    expect(buildMismatch_line('dev', '7bedda')).toBeNull();
    expect(buildMismatch_line('7bedda', 'unknown')).toBeNull();
  });
});

describe('closingLine_of', () => {
  it('says why the daemon went, as it told', () => {
    expect(closingLine_of('restart')).toMatch(/restarting/);
    expect(closingLine_of('end')).toMatch(/ended by an administrator/);
    expect(closingLine_of('stop')).toBe('[!] The calypso daemon stopped.');
  });
});

describe('staleLines_of', () => {
  it('names the fact and the cure, and what the newer release brings when the notes are at hand', () => {
    const bare: string[] = staleLines_of(null);
    expect(bare.length).toBe(1);
    expect(bare[0]).toMatch(/out of date.*Restart it.*porter --end/);
    const told: string[] = staleLines_of({ version: '5.10.3', headline: 'The session can say what the installed releases changed.' });
    expect(told.length).toBe(2);
    expect(told[1]).toContain('chell 5.10.3 · The session can say what the installed releases changed.');
    const long: string[] = staleLines_of({ version: '1.0.0', headline: 'x'.repeat(200) });
    expect(long[1]!.length).toBeLessThan(150);
    expect(long[1]).toContain('…');
  });

  it('reads the surface\'s own shipped notes, and answers null without them', () => {
    const dir: string = mkdtempSync(join(tmpdir(), 'chell-notes-'));
    const file: string = join(dir, 'notes.json');
    writeFileSync(file, JSON.stringify({ version: '5.10.3', releases: [{ changes: [{ headline: 'Internal: ours.', internal: true }, { headline: 'For the operator.', internal: false }] }] }));
    expect(surfaceNews_read(file)).toEqual({ version: '5.10.3', headline: 'For the operator.' });
    expect(surfaceNews_read(join(dir, 'missing.json'))).toBeNull();
  });
});
