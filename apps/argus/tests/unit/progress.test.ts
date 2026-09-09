/**
 * @jest-environment jsdom
 */
/**
 * @file A progress track reads its state and its fill.
 *
 * The errored case is the point: a feed that died fills only as far as the
 * work that succeeded, so its bar's length is how far it got, not a full
 * bar in the error hue that says nothing.
 *
 * @module
 */
import { describe, it, expect } from '@jest/globals';
import { progressCell_build, type ListingProgress } from '../../src/features/roster/row.js';

/** The rendered fill width as a percentage number. */
function fillPercent(el: HTMLElement): number {
  const fill: HTMLElement | null = el.querySelector('.listing-progress-fill');
  return fill === null ? -1 : Number((fill.style.width || '0%').replace('%', ''));
}

describe('progressCell_build', () => {
  it('draws an idle track with no fill when nothing is scheduled', () => {
    for (const progress of [null, { done: 0, total: 0 } as ListingProgress]) {
      const el: HTMLElement = progressCell_build(progress);
      expect(el.classList.contains('listing-progress-idle')).toBe(true);
      expect(el.querySelector('.listing-progress-fill')).toBeNull();
    }
  });

  it('fills a running feed to its settled fraction', () => {
    const el: HTMLElement = progressCell_build({ done: 3, total: 10 });
    expect(el.classList.contains('listing-progress-running')).toBe(true);
    expect(fillPercent(el)).toBe(30);
  });

  it('fills a finished feed full, in the done state', () => {
    const el: HTMLElement = progressCell_build({ done: 10, total: 10 });
    expect(el.classList.contains('listing-progress-done')).toBe(true);
    expect(fillPercent(el)).toBe(100);
  });

  it('fills an errored feed to the work that succeeded, not to every settled node', () => {
    // 10 of 10 settled — every node ran — but only 8 finished cleanly; two
    // errored. The bar is 80% in the failed hue, not a full red bar.
    const el: HTMLElement = progressCell_build({ done: 10, total: 10, failed: true, succeeded: 8 });
    expect(el.classList.contains('listing-progress-failed')).toBe(true);
    expect(fillPercent(el)).toBe(80);
    expect(el.title).toBe('8/10 succeeded — errored');
  });

  it('falls back to the settled count for an errored feed with no success count', () => {
    const el: HTMLElement = progressCell_build({ done: 10, total: 10, failed: true });
    expect(el.classList.contains('listing-progress-failed')).toBe(true);
    expect(fillPercent(el)).toBe(100);
  });

  it('never fills past full or below empty, whatever the counts', () => {
    expect(fillPercent(progressCell_build({ done: 12, total: 10 }))).toBe(100);
    expect(fillPercent(progressCell_build({ done: 10, total: 10, failed: true, succeeded: 0 }))).toBe(0);
  });
});
