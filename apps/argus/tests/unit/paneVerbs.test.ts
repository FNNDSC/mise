/**
 * @jest-environment jsdom
 *
 * @file The pane verbs: a bar note that returns what stood, a move that
 * names its refusal, a flip, a resize, and the chord keys for a title.
 */
import { describe, it, expect, jest } from '@jest/globals';
import { BAR_NOTE_MS, paneVerbs_wire, type PaneVerbs } from '../../src/app/paneVerbs.js';
import type { LayoutManager } from '../../src/app/layout.js';
import type { PaneInstance } from '../../src/app/panes.js';

function host_make(layout: Partial<Record<'leaf_move' | 'leaf_flip' | 'leaf_resize', unknown>>): { verbs: PaneVerbs; bar: HTMLElement; sounds: string[] } {
  document.body.innerHTML = '<div id="pane"><span class="pane-state state-settled">WHOLE</span></div>';
  const mount: HTMLElement = document.getElementById('pane') as HTMLElement;
  const bar: HTMLElement = mount.querySelector('.pane-state') as HTMLElement;
  const sounds: string[] = [];
  const verbs: PaneVerbs = paneVerbs_wire({
    layout: layout as unknown as LayoutManager,
    paneInstance_get: (id: string): PaneInstance | undefined => (id === 'p' ? { id, kind: 'files', mount } : undefined),
    sound: (audioId: string): void => { sounds.push(audioId); },
  });
  return { verbs, bar, sounds };
}

describe('paneVerbs_wire', () => {
  it('a bar note holds the answer, then what stood there returns', () => {
    jest.useFakeTimers();
    const { verbs, bar } = host_make({});
    verbs.bar_note('p', 'MOVED LEFT');
    expect(bar.textContent).toBe('MOVED LEFT');
    expect(bar.classList.contains('state-note')).toBe(true);
    jest.advanceTimersByTime(BAR_NOTE_MS);
    expect(bar.textContent).toBe('WHOLE');
    expect(bar.classList.contains('state-settled')).toBe(true);
    // A pane with no bar is left alone.
    verbs.bar_note('nowhere', 'x');
    jest.useRealTimers();
  });

  it('a later writer wins over the note returning', () => {
    jest.useFakeTimers();
    const { verbs, bar } = host_make({});
    verbs.bar_note('p', 'FLIPPED');
    bar.textContent = 'LANDING';
    jest.advanceTimersByTime(BAR_NOTE_MS);
    expect(bar.textContent).toBe('LANDING');
    jest.useRealTimers();
  });

  it('a move says what happened or why not, and sounds only when it moved', () => {
    const answers: Array<true | 'lone' | 'edge'> = [true, 'lone', 'edge'];
    const { verbs, bar, sounds } = host_make({ leaf_move: (): true | 'lone' | 'edge' => answers.shift() ?? true });
    expect(verbs.move('p', 'left')).toBe('moved left');
    expect(bar.textContent).toBe('MOVED LEFT');
    expect(verbs.move('p', 'left')).toBe('pane move: the only pane on stage');
    expect(verbs.move('p', 'right')).toBe('pane move right: already rightmost');
    expect(sounds).toEqual(['audio3']);
  });

  it('a flip and a resize answer the same way', () => {
    const { verbs, sounds } = host_make({ leaf_flip: (): boolean => true, leaf_resize: (): boolean => false });
    expect(verbs.flip('p')).toBe('flipped');
    expect(verbs.resize('p', 'above', 1)).toBe('pane resize up: no boundary that way');
    expect(sounds).toEqual(['audio3']);
    const refused = host_make({ leaf_flip: (): boolean => false, leaf_resize: (): boolean => true });
    expect(refused.verbs.flip('p')).toBe('pane flip: the only pane on stage');
    expect(refused.verbs.resize('p', 'left', -1)).toBe('resized left');
  });

  it('names the chord keys for a capsule, or nothing', () => {
    const { verbs } = host_make({});
    expect(verbs.chordKeys_of('.drawer-close', false)).toMatch(/^ \[keys .+\]$/);
    expect(verbs.chordKeys_of('.no-such-capsule', false)).toBe('');
  });
});
