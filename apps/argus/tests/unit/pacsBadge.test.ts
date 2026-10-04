/**
 * @file A series' badge in the PACS pane: a pull waiting on its first file
 * paces rather than standing still, and an answer finding the series home
 * in CUBE outranks a pull that ended badly.
 */
import { describe, it, expect } from '@jest/globals';
import { answer_outranksBadge, badgeFraction_of } from '../../src/features/pacs/panel.js';

describe('badgeFraction_of', () => {
  it('paces a fired pull still waiting on its first file, though it knows its total', () => {
    expect(badgeFraction_of({ status: 'running', current: 0, total: 131 })).toBeNull();
  });

  it('paces a queued pull and one with no total', () => {
    expect(badgeFraction_of({ status: 'queued' })).toBeNull();
    expect(badgeFraction_of({ status: 'running', current: 3 })).toBeNull();
  });

  it('fills as far as the files have come once they come', () => {
    expect(badgeFraction_of({ status: 'running', current: 33, total: 132 })).toBeCloseTo(0.25);
    expect(badgeFraction_of({ status: 'running', current: 200, total: 100 })).toBe(1);
  });
});

describe('answer_outranksBadge', () => {
  it('lets a series found home in CUBE replace an ERROR, an UNCONFIRMED or a STALLED', () => {
    for (const status of ['error', 'unconfirmed', 'stalled', 'timeout']) {
      expect(answer_outranksBadge({ pulled: true }, { status })).toBe(true);
    }
  });

  it('never cuts across a pull still in flight, or one already done', () => {
    for (const status of ['running', 'queued', 'done']) {
      expect(answer_outranksBadge({ pulled: true }, { status })).toBe(false);
    }
  });

  it('keeps the error when the answer does not find the series home', () => {
    expect(answer_outranksBadge({ pulled: false }, { status: 'error' })).toBe(false);
    expect(answer_outranksBadge({}, { status: 'error' })).toBe(false);
  });
});
