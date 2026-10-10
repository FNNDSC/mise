/**
 * @jest-environment jsdom
 * @file Focus names a pane on stage (#816): a tree that loses the focused
 * pane hands focus to its first leaf, so a spawn from the focused pane
 * always has a host.
 */
import { describe, it, expect, beforeEach } from '@jest/globals';
import { LayoutManager, type LayoutNode } from '../../src/app/layout.js';

const mount = (): HTMLElement => document.createElement('div');

describe('LayoutManager focus', () => {
  let root: HTMLElement;
  let layout: LayoutManager;
  beforeEach(() => {
    document.body.innerHTML = '';
    root = document.createElement('div');
    document.body.appendChild(root);
    layout = new LayoutManager(root, new Map([['a', mount()], ['b', mount()], ['c', mount()]]));
    layout.preset_register('ab', (): LayoutNode => ({ dir: 'col', ratio: 0.5, first: { pane: 'a' }, second: { pane: 'b' } }));
    layout.preset_register('c', (): LayoutNode => ({ pane: 'c' }));
  });

  it('hands focus to the first leaf when the focused pane leaves the stage', () => {
    layout.preset_apply('ab');
    layout.focus_set('b');
    expect(layout.focused_get()).toBe('b');
    layout.preset_apply('c');
    expect(layout.focused_get()).toBe('c');
    expect(document.body.dataset['focus']).toBe('c');
  });

  it('keeps focus on a pane that stays, and remembers the one that left for ;', () => {
    layout.preset_apply('ab');
    layout.focus_set('b');
    layout.leaf_close('a');
    expect(layout.focused_get()).toBe('b');
    layout.preset_apply('c');
    layout.preset_apply('ab');
    // back on ab, focus lands on its first leaf; the pane that left (c) is the last pane
    expect(layout.focused_get()).toBe('a');
    expect(layout.focus_last()).toBeNull();
  });

  it('a spawn from the focused pane has a host after a preset change', () => {
    layout.preset_apply('ab');
    layout.focus_set('b');
    layout.preset_apply('c');
    const host: string = layout.focused_get() ?? 'none';
    layout.mount_register('d', mount());
    expect(layout.leaf_split(host, 'col', 'd', false)).toBe(true);
    expect(layout.panes_shown()).toEqual(['c', 'd']);
  });

  it('returns ; to the pane a split was made from, and to where a moved pane came from', () => {
    layout.mount_register('d', mount());
    layout.preset_apply('ab');
    layout.focus_set('b');
    expect(layout.leaf_split('b', 'col', 'd', false)).toBe(true);
    expect(layout.focused_get()).toBe('d');
    expect(layout.focus_last()).toBe('b');
    expect(layout.focused_get()).toBe('b');
    layout.focus_set('a');
    layout.leaf_move('d', 'left');
    expect(layout.focused_get()).toBe('d');
    expect(layout.focus_last()).toBe('a');
  });
});

