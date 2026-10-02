/**
 * @jest-environment jsdom
 */
/**
 * @file A chunk of an older build is told, once, and never swallowed: the
 * loader's event is left to throw, so the caller fails with the chunk's own
 * message instead of destructuring `undefined`.
 */
import { describe, it, expect } from '@jest/globals';
import { stalePage_watch, STALE_PAGE_READOUT, STALE_PAGE_SENTENCE } from '../../src/app/stalePage.js';

describe('stalePage_watch', () => {
  it('tells once on the loader\'s event without preventing it, and once more only for a new page', () => {
    const notes: string[] = [];
    const host: HTMLElement = document.createElement('div');
    stalePage_watch((line: string): void => { notes.push(line); }, host);
    const event: Event = new Event('vite:preloadError', { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    window.dispatchEvent(new Event('vite:preloadError', { cancelable: true }));
    expect(notes).toHaveLength(1);
    expect(notes[0]).toContain(STALE_PAGE_SENTENCE);
    const notice: HTMLElement | null = host.querySelector('.stale-page');
    expect(notice).not.toBeNull();
    expect(notice?.textContent).toBe(STALE_PAGE_SENTENCE);
    expect(notice?.querySelector('.stale-page-reload')?.textContent).toBe('refresh');
    expect(host.querySelectorAll('.stale-page')).toHaveLength(1);
  });

  it('names the cure for a surface to read out on its own field', () => {
    expect(STALE_PAGE_READOUT).toBe('ARGUS UPDATED IN THE BACKGROUND · REFRESH THIS PAGE');
    expect(STALE_PAGE_SENTENCE).toBe('ARGUS has been updated in the background — refresh this page');
  });
});
