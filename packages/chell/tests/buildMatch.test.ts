/**
 * @file A remote chell says when it and its daemon are different builds.
 */
import { describe, it, expect } from '@jest/globals';
import { buildMismatch_line, closingLine_of } from '../src/remote/buildMatch.js';

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
