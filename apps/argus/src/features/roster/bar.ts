/**
 * @file A pane bar's state, once.
 *
 * Every pane's bar carries one state at a time — live, settled, stale,
 * waiting, a note, a refusal — as a class on `.pane-state` beside its
 * words. Seven places spelled the list of classes to clear before setting
 * one, each a little differently, so a new state (`state-note`, S2 of the
 * pane-move epic) had to be added by hand wherever a bar was written.
 * This is the one list and the one writer (aegis.adoc:
 * a-fact-has-one-source).
 *
 * @module
 */

/** The states a bar can wear. */
export type BarState = 'live' | 'settled' | 'stale' | 'wait' | 'note' | 'refused';

/** Every state's class, so a writer can clear them all. */
export const BAR_STATE_CLASSES: ReadonlyArray<string> = ['state-live', 'state-settled', 'state-stale', 'state-wait', 'state-note', 'state-refused'];

/**
 * Writes a bar's state: every state class cleared, the one asked for set,
 * the words replaced when given.
 *
 * @param bar - The `.pane-state` element, or null for a pane without one.
 * @param state - The state to wear, or null for none.
 * @param text - The bar's words; absent, the words stand.
 */
export function barState_set(bar: HTMLElement | null, state: BarState | null, text?: string): void {
  if (bar === null) return;
  bar.classList.remove(...BAR_STATE_CLASSES);
  if (state !== null) bar.classList.add(`state-${state}`);
  if (text !== undefined) bar.textContent = text;
}

/**
 * Clears one state from a bar, leaving any other.
 *
 * @param bar - The `.pane-state` element, or null.
 * @param state - The state to take off.
 */
export function barState_clear(bar: HTMLElement | null, state: BarState): void {
  bar?.classList.remove(`state-${state}`);
}

/**
 * Puts one state on or takes it off, leaving any other: a mark that rides
 * beside the standing state (the files pane's STALE beside its CWD line).
 *
 * @param bar - The `.pane-state` element, or null.
 * @param state - The state.
 * @param on - Whether it is worn.
 */
export function barState_toggle(bar: HTMLElement | null, state: BarState, on: boolean): void {
  bar?.classList.toggle(`state-${state}`, on);
}

/**
 * Whether a bar wears a state.
 *
 * @param bar - The `.pane-state` element, or null.
 * @param state - The state asked about.
 * @returns True when it does.
 */
export function barState_is(bar: HTMLElement | null, state: BarState): boolean {
  return bar?.classList.contains(`state-${state}`) ?? false;
}
