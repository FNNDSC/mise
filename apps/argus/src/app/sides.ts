/**
 * @file The four sides, once.
 *
 * A pane is split, moved, focused and resized by a side — left, right,
 * above, below — and that one fact wears four spellings on the way through
 * the surface: the layout's axis and place (`row`/`col`, `before`/`after`),
 * the drawer capsule's data attributes, the arrow key, the focus verb's
 * word (`up`/`down`), the edge a move cannot pass. They were spelled in
 * seventeen places. This table is the one source; the aegis lint
 * (a-fact-has-one-source) holds every other file to it.
 *
 * @module
 */

/** A side of a pane, as the surface names it. */
export type Side = 'left' | 'right' | 'above' | 'below';
/** The layout's axis: `col` splits side by side, `row` stacks. */
export type Axis = 'row' | 'col';
/** Which half of a split: `before` is left or above. */
export type Place = 'before' | 'after';
/** The word `pane focus` takes (the screen's own directions). */
export type FocusWord = 'left' | 'right' | 'up' | 'down';

/** Everything one side implies. */
export interface SideFacts {
  axis: Axis;
  place: Place;
  focusWord: FocusWord;
  arrow: 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown';
  /** The edge a pane already stands at, for a move refused by name. */
  edge: 'leftmost' | 'rightmost' | 'topmost' | 'bottommost';
}

/** The table. */
export const SIDES: Readonly<Record<Side, SideFacts>> = {
  left: { axis: 'col', place: 'before', focusWord: 'left', arrow: 'ArrowLeft', edge: 'leftmost' },
  right: { axis: 'col', place: 'after', focusWord: 'right', arrow: 'ArrowRight', edge: 'rightmost' },
  above: { axis: 'row', place: 'before', focusWord: 'up', arrow: 'ArrowUp', edge: 'topmost' },
  below: { axis: 'row', place: 'after', focusWord: 'down', arrow: 'ArrowDown', edge: 'bottommost' },
};

/** The sides in the drawer's order. */
export const SIDE_LIST: ReadonlyArray<Side> = ['left', 'right', 'above', 'below'];

/**
 * Whether a word names a side.
 *
 * @param word - Any string.
 * @returns True for left, right, above, below.
 */
export function side_is(word: string): word is Side {
  return word === 'left' || word === 'right' || word === 'above' || word === 'below';
}

/**
 * The side a layout position names.
 *
 * @param axis - The split's axis.
 * @param before - Whether the pane takes the first half.
 * @returns The side.
 */
export function side_of(axis: Axis, before: boolean): Side {
  return axis === 'row' ? (before ? 'above' : 'below') : (before ? 'left' : 'right');
}

/**
 * The side a drawer capsule's data attributes name.
 *
 * @param split - `data-split`: `row` or `col`.
 * @param place - `data-place`: `before` or `after`.
 * @returns The side, or null for anything else.
 */
export function side_ofPlace(split: string | undefined, place: string | undefined): Side | null {
  if ((split !== 'row' && split !== 'col') || (place !== 'before' && place !== 'after')) return null;
  return side_of(split, place === 'before');
}

/**
 * The side a focus word names (`up` is above, `down` is below).
 *
 * @param word - `left`, `right`, `up`, `down`.
 * @returns The side, or null.
 */
export function side_ofFocusWord(word: string): Side | null {
  return SIDE_LIST.find((side: Side): boolean => SIDES[side].focusWord === word) ?? null;
}

/**
 * The side an arrow key names.
 *
 * @param key - A KeyboardEvent.key.
 * @returns The side, or null when the key is not an arrow.
 */
export function side_ofArrow(key: string): Side | null {
  return SIDE_LIST.find((side: Side): boolean => SIDES[side].arrow === key) ?? null;
}

/**
 * The place a boolean names, for records that keep `before`.
 *
 * @param before - Whether the first half.
 * @returns `before` or `after`.
 */
export function place_of(before: boolean): Place {
  return before ? 'before' : 'after';
}

/**
 * The drawer capsule that splits or moves to a side.
 *
 * @param side - The side.
 * @returns A selector for the capsule under a drawer.
 */
export function splitSelector_of(side: Side): string {
  return `[data-split="${SIDES[side].axis}"][data-place="${SIDES[side].place}"]`;
}
