/**
 * @file Listing traits: a column declared once.
 *
 * A tabular pane used to say what its columns were twice — once to
 * `RosterOrder`, which draws the caps and sorts by them, and again in the
 * code that emitted each cell. The two could not drift visibly, because
 * the grid would break, but they could drift in meaning: a cap could say
 * one thing while the cell beneath it showed another.
 *
 * A trait is the single declaration. It carries the cap's label, the cell's
 * class, what the cell holds, and how two rows compare under it.
 *
 * What a trait is NOT: per-row state. `files-denied`, `feedlist-arrived`
 * and the rest mark a row, not a column, and forcing them through the
 * column model would say something false about them. They stay with the
 * pane, applied by a decorator.
 *
 * Dependency-free so it can be unit tested; the engine graph and the DOM
 * panels around it cannot be loaded under jest.
 *
 * @module
 */

/** One column of a listing, declared once for both cap and cell. */
export interface ListingTrait<T> {
  /** Matches the cap's key, so sorting and rendering cannot disagree. */
  key: string;
  /** What the cap says. */
  label: string;
  /** The cell's class, as the stylesheet's column rules expect. */
  className: string;
  /** What the cell holds: text, or an element the pane builds itself. */
  cell: (row: T) => string | HTMLElement;
  /**
   * The comparable value under this column. Defaults to the cell's text
   * when the cell is a plain string, so a column only declares this when
   * its display and its order genuinely differ — a size shown as `1.2 MB`
   * sorting by bytes, a date shown short sorting by its full stamp.
   */
  compare?: (row: T) => string | number;
}

/** The caps a set of traits declares, in order. */
export function traitColumns_of<T>(
  traits: ReadonlyArray<ListingTrait<T>>,
): Array<{ key: string; label: string }> {
  return traits.map((trait: ListingTrait<T>): { key: string; label: string } => ({
    key: trait.key,
    label: trait.label,
  }));
}

/**
 * The comparator a set of traits declares.
 *
 * @param traits - The columns.
 * @returns A `value_of` for `RosterOrder`, falling back to the cell's own
 *   text when a trait declares no separate ordering.
 */
export function traitValue_of<T>(
  traits: ReadonlyArray<ListingTrait<T>>,
): (row: T, key: string) => string | number {
  const byKey: Map<string, ListingTrait<T>> = new Map(
    traits.map((trait: ListingTrait<T>): [string, ListingTrait<T>] => [trait.key, trait]),
  );
  return (row: T, key: string): string | number => {
    const trait: ListingTrait<T> | undefined = byKey.get(key);
    if (trait === undefined) return '';
    if (trait.compare !== undefined) return trait.compare(row);
    const held: string | HTMLElement = trait.cell(row);
    // An element cell with no declared ordering sorts by its text, which
    // is what the operator can actually see.
    return typeof held === 'string' ? held : held.textContent ?? '';
  };
}

/** How a pane builds one row from its traits. */
export interface RowBuild<T> {
  /** The row element's own classes, state included. */
  className: (row: T) => string;
  /** Cells the pane emits before the first trait, e.g. a type glyph. */
  leading?: (row: T) => HTMLElement[];
  /** Anything else the pane wants on the row: title, dataset, listeners. */
  decorate?: (element: HTMLElement, row: T) => void;
}

/**
 * Builds one row: the leading cells, then a cell per trait, in order.
 *
 * @param row - The row's data.
 * @param traits - The columns, in cap order.
 * @param build - The pane's own row-level concerns.
 * @returns The row element.
 */
export function listingRow_build<T>(
  row: T,
  traits: ReadonlyArray<ListingTrait<T>>,
  build: RowBuild<T>,
): HTMLElement {
  const element: HTMLElement = document.createElement('div');
  element.className = build.className(row);
  for (const cell of build.leading?.(row) ?? []) element.appendChild(cell);
  for (const trait of traits) {
    const held: string | HTMLElement = trait.cell(row);
    if (typeof held !== 'string') {
      element.appendChild(held);
      continue;
    }
    const cell: HTMLSpanElement = document.createElement('span');
    cell.className = trait.className;
    cell.textContent = held;
    element.appendChild(cell);
  }
  build.decorate?.(element, row);
  return element;
}
