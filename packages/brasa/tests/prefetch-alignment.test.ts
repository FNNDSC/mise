/**
 * @file Unit tests for boot-step announcement alignment.
 */

import { describe, it, expect } from '@jest/globals';
import { announceIndent_get, SPINNER_GLYPH_WIDTH } from '../src/lib/announceIndent.js';

describe('announceIndent_get', () => {
  it('lands the label where a padded status tag and its space would end', () => {
    // The host renders `${tag.padEnd(width)} ${label}`, so the label sits at
    // width + 1. A plain log line draws no glyph and owes all of it.
    for (const width of [6, 7, 9]) {
      expect(announceIndent_get(width, false)).toBe(width + 1);
    }
  });

  it('gives the animated path room for the glyph it draws itself', () => {
    const width: number = 7;
    expect(SPINNER_GLYPH_WIDTH + announceIndent_get(width, true)).toBe(announceIndent_get(width, false));
  });

  it('follows the host width, so a longer status cannot break the column', () => {
    // `[PENDING]` is nine characters against six for `[ OK ]`; the indent has
    // to be derived rather than written down.
    expect(announceIndent_get(9, true)).toBeGreaterThan(announceIndent_get(7, true));
    expect(announceIndent_get(9, false)).toBeGreaterThan(announceIndent_get(7, false));
  });

  it('never returns a negative indent for a host with no status column', () => {
    expect(announceIndent_get(0, true)).toBe(0);
    expect(announceIndent_get(0, false)).toBe(1);
  });
});
