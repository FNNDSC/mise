/**
 * @jest-environment jsdom
 */
/**
 * @file The status strip's open-question readout: `? N WAITING` while any
 * surface has a question open, each named in the title; empty (and so
 * hidden) when none is.
 */
import { describe, it, expect } from '@jest/globals';
import { StatusBar } from '../../src/app/status.js';

/** A page holding the strip's fields. */
function page_make(): Document {
  document.body.innerHTML = ['identity', 'jobs', 'activity', 'latency', 'mismatch', 'lamp', 'host', 'questions']
    .map((name: string): string => `<span id="status-${name}" class="readout"></span>`).join('');
  return document;
}

describe('StatusBar questions', () => {
  it('says how many wait, and who asked what in its title', () => {
    const bar: StatusBar = new StatusBar(page_make());
    bar.questions_show([{ surface: 'abcdef1234', message: 'Another game: ', sinceMs: 12_400 }]);
    const field: HTMLElement = document.getElementById('status-questions') as HTMLElement;
    expect(field.textContent).toBe('? 1 WAITING');
    expect(field.title).toBe('surface abcdef asks "Another game:" (12 s); its command is paused until answered there');
  });

  it('is empty when nothing is asked', () => {
    const bar: StatusBar = new StatusBar(page_make());
    bar.questions_show([{ surface: 'x', message: 'q', sinceMs: 0 }]);
    bar.questions_show([]);
    const field: HTMLElement = document.getElementById('status-questions') as HTMLElement;
    expect(field.textContent).toBe('');
    expect(field.title).toBe('');
  });
});
