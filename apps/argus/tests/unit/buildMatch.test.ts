/**
 * @jest-environment jsdom
 */
/**
 * @file A page and the kernel it talks to say when they are different
 * builds, which side is older, and the cure.
 */
import { describe, it, expect } from '@jest/globals';
import { buildMismatch_of, buildMismatch_sentence, buildMismatch_tell, type BuildStamp } from '../../src/app/buildMatch.js';
import type { StackInfo } from '../../src/calypso/client.js';

const PAGE: BuildStamp = { git: '7bedda5', built: '2026-10-03 14:20' };
const stack = (surface?: BuildStamp): StackInfo => ({ chell: '5.9.6', calypso: '0.17.1', build: '7bedda', ...(surface !== undefined ? { surface } : {}) });

describe('buildMismatch_of', () => {
  it('says nothing when the kernel started beside this very page', () => {
    expect(buildMismatch_of(PAGE, stack({ ...PAGE }))).toBeNull();
  });

  it('knows the kernel is older when the page was built after the one it started beside', () => {
    expect(buildMismatch_of(PAGE, stack({ git: '4128890', built: '2026-10-01 09:00' }))).toBe('daemon-older');
  });

  it('knows the page is older when the kernel started beside a later build', () => {
    expect(buildMismatch_of(PAGE, stack({ git: '9999999', built: '2026-10-04 08:00' }))).toBe('argus-older');
  });

  it('takes a daemon that names no page as one older than the stamp', () => {
    expect(buildMismatch_of(PAGE, stack())).toBe('daemon-older');
  });

  it('cannot judge a daemon that reports no stack', () => {
    expect(buildMismatch_of(PAGE, undefined)).toBeNull();
  });
});

describe('buildMismatch_tell', () => {
  it('says the calypso daemon is older on the console and over the stage, what to restart in words, dismissible', () => {
    const notes: string[] = [];
    const host: HTMLElement = document.createElement('div');
    buildMismatch_tell('daemon-older', PAGE, stack({ git: '4128890', built: '2026-10-01 09:00' }), (line: string): void => { notes.push(line); }, host);
    expect(notes).toEqual([
      'argus: ARGUS is newer than the calypso daemon, so some controls won\'t work. Restart the calypso daemon.',
      'argus: ARGUS 7bedda5 built 2026-10-03 14:20Z · calypso daemon started with ARGUS 4128890 built 2026-10-01 09:00Z',
    ]);
    expect(notes[0]).toBe(`argus: ${buildMismatch_sentence('daemon-older')}`);
    const notice: HTMLElement | null = host.querySelector('.build-mismatch');
    expect(notice?.textContent).toBe('ARGUS is newer than the calypso daemon, so some controls won\'t work. Restart the calypso daemon.×');
    expect(notice?.querySelector('.stale-page-reload')).toBeNull();
    (notice?.querySelector('.build-mismatch-dismiss') as HTMLButtonElement).click();
    expect(host.querySelector('.build-mismatch')).toBeNull();
  });

  it('gives an older ARGUS its cure as a control in the sentence', () => {
    const host: HTMLElement = document.createElement('div');
    buildMismatch_tell('argus-older', PAGE, stack({ git: '9999999', built: '2026-10-04 08:00' }), (): void => undefined, host);
    expect(host.querySelector('.stale-page-reload')?.textContent).toBe('Refresh');
    expect(host.querySelector('.stale-page-words')?.textContent).toBe('ARGUS is older than the calypso daemon. Refresh to load the new ARGUS.');
  });

  it('says what the calypso daemon started with even when it cannot name the build', () => {
    const notes: string[] = [];
    buildMismatch_tell('daemon-older', PAGE, stack(), (line: string): void => { notes.push(line); }, document.createElement('div'));
    expect(notes[1]).toContain('calypso daemon started with an ARGUS too old to say its build');
  });
});
