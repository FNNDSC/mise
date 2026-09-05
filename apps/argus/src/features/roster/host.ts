/**
 * @file The listing host: a frame that stays, a field that scrolls.
 *
 * The files listing and the runs roster arrived at the same arrangement
 * separately — mount a `RosterOrder` frame, append a scrolling field
 * beneath it, fill the field with rows. Because they arrived separately
 * the arrangement is copy, so a fix to one had to be written again for
 * the other, and the stylesheet carried two field rules that differed by
 * a `padding-right`.
 *
 * The caps and the filter strip are the pane's own chrome, not part of
 * its scroll. A scrollbar running up behind its own column headers reads
 * the wrong boundary, and a frame inside the scroll must paint over
 * whatever passes beneath it — which is how a sticky frame came to cover
 * a row's trailing cell.
 *
 * Deliberately narrow. The panes' state lines and empty states look alike
 * but are not: the files bar toggles one class and joins parts, the runs
 * bar swaps among three and stays silent while a graph is on stage.
 * Pulling those together would change behaviour, so they stay where they
 * are until there is a reason beyond resemblance.
 *
 * @module
 */
import type { RosterOrder } from './order.js';

/**
 * A pane's listing region: the frame, and the scrolling field beneath it.
 *
 * Owns no rows, no columns and no state line. A caller opens a field and
 * fills it however it likes.
 */
export class ListingHost<T> {
  private readonly container: HTMLElement;
  private readonly order: RosterOrder<T>;
  private field: HTMLElement | null = null;

  /**
   * @param container - The pane's listing region.
   * @param order - The pane's sort and filter state, whose root is the frame.
   */
  constructor(container: HTMLElement, order: RosterOrder<T>) {
    this.container = container;
    this.order = order;
  }

  /**
   * Seats the frame and opens an empty field beneath it.
   *
   * `host_prepare` clears everything after the frame, so the field is made
   * fresh on each render; the frame itself is never re-inserted, which
   * would blur the filter input mid-word.
   *
   * @returns The element rows are appended to.
   */
  public field_open(): HTMLElement {
    this.order.host_prepare(this.container);
    const field: HTMLElement = document.createElement('div');
    field.className = 'listing-field';
    this.container.appendChild(field);
    this.field = field;
    return field;
  }

  /** The field currently on stage, or null before the first render. */
  public field_get(): HTMLElement | null {
    return this.field;
  }
}
