/**
 * @file The verbs on a pane as a thing on the stage: its bar speaks for a
 * moment, it moves to a side, its split flips, its boundary steps. The
 * drawer's capsules and the typed `pane …` sentences both come here.
 */
import { DRAWER_CHORDS, type DrawerChord } from '../console/argusLang.js';
import { barState_set } from '../features/roster/bar.js';
import type { HostContext } from './hostContext.js';
import type { MoveRefusal } from './layout.js';
import { SIDES, type Side } from './sides.js';

/** How long a bar carries a control's answer before what stood there returns. */
export const BAR_NOTE_MS: number = 4000;

/** The verbs a wired host has on its panes. */
export interface PaneVerbs {
  /**
   * A pane's bar carries a control's answer for a moment, then what stood
   * there returns (aegis.adoc: a-pill-answers-on-its-own-bar).
   *
   * @param paneId - The pane whose bar speaks.
   * @param text - The answer.
   */
  bar_note: (paneId: string, text: string) => void;
  /**
   * Moves a pane to a side (aegis.adoc: a-pane-can-be-moved). The mover
   * keeps focus and its bar says so; a refusal is named.
   *
   * @param paneId - The pane that moves.
   * @param side - Where it goes.
   * @returns The readout: what happened, or why not.
   */
  move: (paneId: string, side: Side) => string;
  /** Flips the axis of the split a pane stands in (the drawer's Space, `pane flip`). */
  flip: (paneId: string) => string;
  /** Moves the boundary beside a pane a step (Ctrl-arrow, `pane resize`). */
  resize: (paneId: string, side: Side, step: number) => string;
  /** The chords a capsule answers to, for its title: `[keys % l]`. */
  chordKeys_of: (selector: string, move: boolean) => string;
}

/**
 * Wires the pane verbs to a host.
 *
 * @param context - The layout the panes stand in, their mounts, the sound.
 * @returns The verbs.
 */
export function paneVerbs_wire(context: Pick<HostContext, 'layout' | 'paneInstance_get' | 'sound'>): PaneVerbs {
  const notes: WeakMap<HTMLElement, ReturnType<typeof setTimeout>> = new WeakMap();
  const bar_note = (paneId: string, text: string): void => {
    const bar: HTMLElement | null = context.paneInstance_get(paneId)?.mount.querySelector<HTMLElement>('.pane-state') ?? null;
    if (bar === null) return;
    const pending: ReturnType<typeof setTimeout> | undefined = notes.get(bar);
    if (pending !== undefined) clearTimeout(pending);
    const stood: { text: string; className: string } = { text: bar.textContent ?? '', className: bar.className };
    barState_set(bar, 'note', text);
    notes.set(bar, setTimeout((): void => {
      notes.delete(bar);
      // Something else may have written the bar meanwhile; that stands.
      if (bar.textContent !== text) return;
      bar.className = stood.className;
      bar.textContent = stood.text;
    }, BAR_NOTE_MS));
  };
  const move = (paneId: string, side: Side): string => {
    const moved: true | MoveRefusal = context.layout.leaf_move(paneId, side);
    if (moved === 'lone') return 'pane move: the only pane on stage';
    if (moved === 'edge') return `pane move ${side}: already ${SIDES[side].edge}`;
    bar_note(paneId, `MOVED ${side.toUpperCase()}`);
    context.sound('audio3');
    return `moved ${side}`;
  };
  const flip = (paneId: string): string => {
    if (!context.layout.leaf_flip(paneId)) return 'pane flip: the only pane on stage';
    bar_note(paneId, 'FLIPPED');
    context.sound('audio3');
    return 'flipped';
  };
  const resize = (paneId: string, side: Side, step: number): string => {
    if (!context.layout.leaf_resize(paneId, side, step)) return `pane resize ${SIDES[side].focusWord}: no boundary that way`;
    return `resized ${SIDES[side].focusWord}`;
  };
  const chordKeys_of = (selector: string, move: boolean): string => {
    const keys: string[] = DRAWER_CHORDS
      .filter((chord: DrawerChord): boolean => chord.selector === selector && (chord.move === true) === move)
      .map((chord: DrawerChord): string => chord.key);
    return keys.length === 0 ? '' : ` [keys ${keys.join(' ')}]`;
  };
  return { bar_note, move, flip, resize, chordKeys_of };
}
