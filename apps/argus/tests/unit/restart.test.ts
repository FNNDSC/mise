/**
 * @jest-environment jsdom
 */
/**
 * @file The restart question says what a restart would cut off right now,
 * and answers to YES / NO and Enter / Esc without the keys reaching the stage.
 */
import { describe, it, expect } from '@jest/globals';
import { closingWords_of, restartCuts_of, restartQuestion_build, RESTART_QUESTION } from '../../src/app/restart.js';

describe('restartCuts_of', () => {
  it('names nothing when nothing is live', () => {
    expect(restartCuts_of({ running: null, unsaved: [], others: [] })).toEqual([]);
  });

  it('names the running command, each unsaved edit, and the other surfaces by kind', () => {
    expect(restartCuts_of({
      running: 'pacs pull 22119730',
      unsaved: ['/home/rudolphpienaar/me.txt'],
      others: [{ id: 'a', kind: 'browser' }, { id: 'b', kind: 'chell' }, { id: 'c', kind: 'browser' }],
    })).toEqual([
      'the running command: pacs pull 22119730',
      'an unsaved edit in /home/rudolphpienaar/me.txt',
      '2 other browsers and 1 chell, which will be disconnected',
    ]);
  });
});

describe('closingWords_of', () => {
  it('says why the daemon went, in words for another browser', () => {
    expect(closingWords_of('restart')).toMatch(/restarting \(asked from another browser or surface\)/);
    expect(closingWords_of('end')).toMatch(/ended by an administrator/);
    expect(closingWords_of('stop')).toBe('The calypso daemon stopped.');
  });
});

describe('restartQuestion_build', () => {
  it('asks in words, lists the cuts, and answers YES / NO once', () => {
    const answers: boolean[] = [];
    const question: HTMLDivElement = restartQuestion_build(['an unsaved edit in me.txt'], (yes: boolean): void => { answers.push(yes); });
    document.body.append(question);
    expect(question.textContent).toContain(RESTART_QUESTION);
    expect(question.querySelector('.restart-cuts')?.textContent).toContain('This will cut off:an unsaved edit in me.txt');
    (question.querySelector('.restart-no') as HTMLButtonElement).click();
    (question.querySelector('.restart-yes') as HTMLButtonElement).click();
    expect(answers).toEqual([false]);
    expect(document.body.contains(question)).toBe(false);
  });

  it('takes Enter as yes and Esc as no, keeping both from the stage', () => {
    const answers: boolean[] = [];
    let reachedStage: number = 0;
    const stage = (): void => { reachedStage++; };
    document.addEventListener('keydown', stage);
    const enter: HTMLDivElement = restartQuestion_build([], (yes: boolean): void => { answers.push(yes); });
    document.body.append(enter);
    enter.querySelector('.restart-yes')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    const esc: HTMLDivElement = restartQuestion_build([], (yes: boolean): void => { answers.push(yes); });
    document.body.append(esc);
    esc.querySelector('.restart-yes')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    document.removeEventListener('keydown', stage);
    expect(answers).toEqual([true, false]);
    expect(reachedStage).toBe(0);
    expect(esc.querySelector('.restart-cuts')).toBeNull();
  });
});
