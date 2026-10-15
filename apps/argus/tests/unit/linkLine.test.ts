/**
 * @jest-environment jsdom
 */
/**
 * @file The link line: the address in full behind a LINK pill; a press
 * copies it and the pill says so, or selects it for the hand.
 */
import { describe, it, expect, jest } from '@jest/globals';
import { linkLine_build, linkLine_copy, linkLine_set } from '../../src/app/link.js';

describe('the link line', () => {
  it('shows the whole address for a path', () => {
    const line: HTMLElement = linkLine_build('/proc/jobs/feed_4389');
    expect(line.querySelector('.link-address')?.textContent).toBe(`${window.location.origin}/#/proc/jobs/feed_4389`);
    linkLine_set(line, '/proc/jobs/feed_4389/pl-dicom_repack_639204');
    expect(line.dataset['link']).toBe(`${window.location.origin}/#/proc/jobs/feed_4389/pl-dicom_repack_639204`);
  });

  it('says COPIED when the browser takes it, and reads LINK again after', async () => {
    jest.useFakeTimers();
    const line: HTMLElement = linkLine_build('/home/x');
    const writeText = jest.fn(async (_text: string): Promise<void> => undefined);
    expect(await linkLine_copy(line, { writeText })).toBe(true);
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/#/home/x`);
    expect(line.querySelector('.link-pill')?.textContent).toBe('COPIED');
    expect(line.dataset['copied']).toBe('yes');
    jest.advanceTimersByTime(3000);
    expect(line.querySelector('.link-pill')?.textContent).toBe('LINK');
    jest.useRealTimers();
  });

  it('selects the address for the hand when the browser will not copy', async () => {
    const line: HTMLElement = linkLine_build('/home/x');
    document.body.appendChild(line);
    const writeText = async (): Promise<void> => { throw new Error('insecure'); };
    expect(await linkLine_copy(line, { writeText })).toBe(false);
    expect(line.querySelector('.link-pill')?.textContent).toBe('SELECT + COPY');
    expect(window.getSelection()?.toString()).toBe(`${window.location.origin}/#/home/x`);
  });
});
