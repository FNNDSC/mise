/**
 * @jest-environment jsdom
 *
 * @file The keys: Esc retreats one level a press, the topmost transient
 * first and silently for the command line; a chord with a drawer open
 * presses one capsule or moves focus; Ctrl-B is the prefix everywhere.
 */
import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { keys_wire, type KeyHooks } from '../../src/app/keys.js';
import type { ArgusHost } from '../../src/console/argusLang.js';
import type { HostContext } from '../../src/app/hostContext.js';
import type { LayoutManager } from '../../src/app/layout.js';
import { PanelRoster, type PaneInstance } from '../../src/app/panes.js';

interface Recorded {
  sounds: string[];
  lines: string[];
  focused: string[];
  closed: number;
  errands: number;
  paletteOpened: number;
  paletteClosed: number;
  alone: string[];
}

function host_make(overrides: Partial<KeyHooks> = {}, flags: { paletteOpen?: boolean; errand?: boolean; focus?: string | null } = {}): { detach: () => void; r: Recorded; drawer: HTMLElement } {
  document.body.innerHTML = '<div id="layout-root"><div id="pane-files"><div class="pane-drawer" hidden><button class="drawer-close">x</button><button class="drawer-mode" data-mode="move">MOVE</button><button class="drawer-mode" data-mode="split">SPLIT</button></div></div></div><div id="gutter-panes"></div><div id="console-drawer" hidden></div>';
  const drawer: HTMLElement = document.querySelector('.pane-drawer') as HTMLElement;
  const r: Recorded = { sounds: [], lines: [], focused: [], closed: 0, errands: 0, paletteOpened: 0, paletteClosed: 0, alone: [] };
  const shown: string[] = ['files', 'empty-1'];
  let focus: string | null = flags.focus === undefined ? 'files' : flags.focus;
  const layout = {
    panes_shown: (): string[] => shown,
    focused_get: (): string | null => focus,
    focus_set: (id: string): boolean => { focus = id; r.focused.push(id); return true; },
    focus_last: (): string | null => 'empty-1',
    tree_set: (): void => {},
  } as unknown as LayoutManager;
  const context = {
    layout,
    panels: new PanelRoster(),
    paneInstance_get: (id: string): PaneInstance | undefined => (id === 'files' ? { id, kind: 'files', mount: document.getElementById('pane-files') as HTMLElement } : undefined),
    terminal: { ask_abandon: (): boolean => false, ask_isOpen: (): boolean => false, line_run: (line: string): void => { r.lines.push(line); } },
    sound: (id: string): void => { r.sounds.push(id); },
  } as unknown as Pick<HostContext, 'layout' | 'panels' | 'paneInstance_get' | 'terminal' | 'sound'>;
  let paletteOpen: boolean = flags.paletteOpen === true;
  let errand: boolean = flags.errand === true;
  const hooks: KeyHooks = {
    palette_isOpen: (): boolean => paletteOpen,
    palette_open: (): void => { paletteOpen = true; r.paletteOpened += 1; },
    palette_close: (): void => { paletteOpen = false; r.paletteClosed += 1; },
    errand_abandon: (): boolean => { if (!errand) return false; errand = false; r.errands += 1; return true; },
    dive_leave: (): boolean => false,
    overlay_escape: (): boolean => false,
    drawers_close: (): boolean => { const was: boolean = !drawer.hidden; drawer.hidden = true; if (was) r.closed += 1; return was; },
    modeFrames_close: (): boolean => false,
    consoleFocused: (): boolean => false,
    console_release: (): void => {},
    verbs: { bar_note: (): void => {}, flip: (): string => 'flipped', resize: (): string => 'resized' },
    host: (): ArgusHost => ({ focused_get: (): string | null => focus, focus_set: (id: string): boolean => { focus = id; r.focused.push(id); return true; }, panes_shown: (): string[] => shown } as unknown as ArgusHost),
    stage_alone: (id: string): void => { r.alone.push(id); },
    element_require: (id: string): HTMLElement => document.getElementById(id) as HTMLElement,
    ...overrides,
  };
  return { detach: keys_wire(context, hooks), r, drawer };
}

const press = (key: string, extra: KeyboardEventInit = {}): KeyboardEvent => {
  const event: KeyboardEvent = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...extra });
  window.dispatchEvent(event);
  return event;
};

let detach: () => void = (): void => {};
beforeEach((): void => { detach = (): void => {}; });
afterEach((): void => { detach(); });

describe('keys_wire', () => {
  it('Esc closes the command line first, silently, then abandons an errand with a sound', () => {
    const host = host_make({}, { paletteOpen: true, errand: true });
    detach = host.detach;
    press('Escape');
    expect(host.r.paletteClosed).toBe(1);
    expect(host.r.errands).toBe(0);
    expect(host.r.sounds).toEqual([]);
    press('Escape');
    expect(host.r.errands).toBe(1);
    expect(host.r.sounds).toEqual(['audio3']);
  });

  it('Esc closes an open drawer as one level, and nothing when nothing stands', () => {
    const host = host_make();
    detach = host.detach;
    host.drawer.hidden = false;
    press('Escape');
    expect(host.r.closed).toBe(1);
    expect(host.r.sounds).toEqual(['audio3']);
    press('Escape');
    expect(host.r.sounds).toEqual(['audio3']);
  });

  it('with a drawer open, o cycles focus, ? asks the keys, and a chord presses its capsule', () => {
    const host = host_make();
    detach = host.detach;
    host.drawer.hidden = false;
    expect(press('o').defaultPrevented).toBe(true);
    expect(host.r.focused).toEqual(['empty-1']);
    expect(host.drawer.hidden).toBe(true);
    host.drawer.hidden = false;
    press('?');
    expect(host.r.lines).toEqual(['argus keys']);
    host.drawer.hidden = false;
    let pressed: number = 0;
    (host.drawer.querySelector('.drawer-close') as HTMLButtonElement).addEventListener('click', (): void => { pressed += 1; });
    expect(press('x').defaultPrevented).toBe(true);
    expect(pressed).toBe(1);
  });

  it('! breaks the focused pane out alone when more than one is on stage', () => {
    const host = host_make();
    detach = host.detach;
    host.drawer.hidden = false;
    press('!');
    expect(host.r.alone).toEqual(['files']);
  });

  it('a key typed into a line is never a chord', () => {
    const host = host_make();
    detach = host.detach;
    host.drawer.hidden = false;
    const input: HTMLInputElement = document.createElement('input');
    document.body.append(input);
    const event: KeyboardEvent = new KeyboardEvent('keydown', { key: 'o', bubbles: true, cancelable: true });
    input.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(host.r.focused).toEqual([]);
  });

  it('Ctrl-B opens the focused pane\'s drawer, and again opens the command line', () => {
    const host = host_make();
    detach = host.detach;
    const first: KeyboardEvent = press('b', { ctrlKey: true });
    expect(first.defaultPrevented).toBe(true);
    expect(host.drawer.hidden).toBe(false);
    expect(host.r.sounds).toEqual(['audio3']);
    press('b', { ctrlKey: true });
    expect(host.drawer.hidden).toBe(true);
    expect(host.r.paletteOpened).toBe(1);
  });

  describe('the keys reach the frame and the rows (a-frame-is-reachable-by-keys)', () => {
    // jsdom lays nothing out: every element counts as shown for these.
    const shown = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetParent');
    beforeEach((): void => {
      Object.defineProperty(HTMLElement.prototype, 'offsetParent', { configurable: true, get(): Element | null { return document.body; } });
      // Nor does it scroll.
      HTMLElement.prototype.scrollIntoView ??= function scrollIntoView(): void {};
    });
    afterEach((): void => { if (shown !== undefined) Object.defineProperty(HTMLElement.prototype, 'offsetParent', shown); });

    const pane_fill = (): { rows: HTMLElement[]; verbs: HTMLButtonElement[] } => {
      const mount: HTMLElement = document.getElementById('pane-files') as HTMLElement;
      mount.classList.add('workspace-pane');
      mount.insertAdjacentHTML('beforeend', '<div class="listing"><div class="listing-row" data-k="a"><span class="listing-control">▶</span>a</div><div class="listing-row" data-k="b">b</div><div class="listing-row" data-k="c">c</div></div><div class="mode-frame"><button>LIST</button><button>HOME</button></div>');
      return { rows: [...mount.querySelectorAll<HTMLElement>('.listing-row')], verbs: [...mount.querySelectorAll<HTMLButtonElement>('.mode-frame button')] };
    };

    it('the arrows move a row cursor over the focused pane\'s listing, Home and End to the ends', () => {
      const host = host_make();
      detach = host.detach;
      const { rows } = pane_fill();
      expect(press('ArrowDown').defaultPrevented).toBe(true);
      expect(rows[0]?.classList.contains('listing-cursor')).toBe(true);
      press('ArrowDown');
      expect(rows.map((row) => row.classList.contains('listing-cursor'))).toEqual([false, true, false]);
      press('End');
      expect(rows[2]?.classList.contains('listing-cursor')).toBe(true);
      press('Home');
      expect(rows[0]?.classList.contains('listing-cursor')).toBe(true);
    });

    it('Enter presses the row; on an indicated row it goes, through the control cell where there is one', () => {
      const host = host_make();
      detach = host.detach;
      const { rows } = pane_fill();
      const seen: string[] = [];
      rows[0]?.addEventListener('click', (event: Event): void => { seen.push((event.target as HTMLElement).classList.contains('listing-control') ? 'control' : 'row'); });
      rows[1]?.addEventListener('dblclick', (): void => { seen.push('go b'); });
      press('ArrowDown');
      press('Enter');
      expect(seen).toEqual(['row']);
      rows[0]?.classList.add('listing-indicated');
      press('Enter');
      expect(seen).toEqual(['row', 'control']);
      press('ArrowDown');
      rows[1]?.classList.add('listing-indicated');
      press('Enter');
      expect(seen).toEqual(['row', 'control', 'go b']);
    });

    it('→ takes the keys into the frame, the arrows walk its verbs, ← gives them back', () => {
      const host = host_make();
      detach = host.detach;
      const { verbs } = pane_fill();
      press('ArrowRight');
      expect(document.activeElement).toBe(verbs[0]);
      expect((document.getElementById('pane-files') as HTMLElement).dataset['modes']).toBe('open');
      press('ArrowDown');
      expect(document.activeElement).toBe(verbs[1]);
      press('ArrowLeft');
      expect(document.activeElement).toBe(document.body);
    });

    it('Ctrl-B r enters the frame; Ctrl-B & closes every pane', () => {
      const host = host_make();
      detach = host.detach;
      const { verbs } = pane_fill();
      host.drawer.hidden = false;
      press('r');
      expect(document.activeElement).toBe(verbs[0]);
      (document.activeElement as HTMLElement).blur();
      host.drawer.hidden = false;
      press('&');
      expect(host.r.lines).toEqual(['pane close all']);
    });

    it('a key aimed at a line or a button is left to it; Esc gives a pane\'s line back to the stage', () => {
      const host = host_make();
      detach = host.detach;
      const { rows } = pane_fill();
      const input: HTMLInputElement = document.createElement('input');
      (document.getElementById('pane-files') as HTMLElement).append(input);
      input.focus();
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
      expect(rows.some((row) => row.classList.contains('listing-cursor'))).toBe(false);
      press('Escape');
      expect(document.activeElement).toBe(document.body);
      press('ArrowDown');
      expect(rows[0]?.classList.contains('listing-cursor')).toBe(true);
    });
  });
});
