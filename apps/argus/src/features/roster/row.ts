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

/** What a row's work is doing, and how far along it is. */
export interface ListingProgress {
  /** Units settled — finished, errored or cancelled; they will not change again. */
  done: number;
  /** Units known. Zero means nothing has been scheduled, not that nothing exists. */
  total: number;
  /** Whether the work errored, which a count alone cannot say. */
  failed?: boolean;
}

/**
 * Sums progress across a level's children.
 *
 * A study's progress is its series', a patient's is its studies'. The rule
 * is deliberately plain addition: an average would let one finished series
 * of a hundred files outweigh a stalled one of ten thousand.
 *
 * @param parts - The children's progress.
 * @returns Their total, failed when any child failed.
 */
export function progress_aggregate(parts: ReadonlyArray<ListingProgress>): ListingProgress {
  let done: number = 0;
  let total: number = 0;
  let failed: boolean = false;
  for (const part of parts) {
    done += part.done;
    total += part.total;
    failed = failed || part.failed === true;
  }
  return { done, total, ...(failed ? { failed: true } : {}) };
}

/**
 * Builds a progress track.
 *
 * A row whose work has not started still gets a track, dimmed. Absence of
 * a bar reads as "no such thing"; a dim track reads as "nothing has
 * happened yet", which is the truth and the more useful of the two.
 *
 * @param progress - The row's progress, or null when it has no work at all.
 * @returns The track element.
 */
export function progressCell_build(progress: ListingProgress | null): HTMLElement {
  const track: HTMLSpanElement = document.createElement('span');
  track.className = 'listing-progress';
  if (progress === null || progress.total === 0) {
    track.classList.add('listing-progress-idle');
    track.title = progress === null ? 'no work' : 'nothing scheduled yet';
    return track;
  }

  const fraction: number = Math.min(1, progress.done / progress.total);
  const settled: boolean = progress.done >= progress.total;
  track.classList.add(
    progress.failed === true ? 'listing-progress-failed'
      : settled ? 'listing-progress-done' : 'listing-progress-running',
  );
  track.title = `${progress.done}/${progress.total}`;

  const fill: HTMLSpanElement = document.createElement('span');
  fill.className = 'listing-progress-fill';
  fill.style.width = `${Math.round(fraction * 100)}%`;
  track.appendChild(fill);
  return track;
}

/**
 * One thing a row can be told to do.
 *
 * Actions are not traits. A trait says what a row *is* under some column;
 * an action is a verb the operator may apply to it, and it sits outside
 * the column grid because it answers to no cap.
 */
export interface ListingAction<T> {
  /** What the capsule says. */
  label: string;
  /** What pressing it does. */
  run: (row: T) => void;
  /** Whether this row is offered it at all; absent means always. */
  offered?: (row: T) => boolean;
  /** Whether it is offered but refused, with the capsule shown disabled. */
  disabled?: (row: T) => boolean;
}

/**
 * Builds a row's action capsules.
 *
 * @param row - The row's data.
 * @param actions - The verbs it may be given.
 * @returns A cell holding the capsules, empty when none are offered.
 */
export function actionCell_build<T>(row: T, actions: ReadonlyArray<ListingAction<T>>): HTMLElement {
  const cell: HTMLSpanElement = document.createElement('span');
  cell.className = 'listing-actions';
  for (const action of actions) {
    if (action.offered !== undefined && !action.offered(row)) continue;
    const capsule: HTMLButtonElement = document.createElement('button');
    capsule.className = 'listing-action';
    capsule.textContent = action.label;
    if (action.disabled?.(row) === true) capsule.disabled = true;
    capsule.addEventListener('click', (event: Event): void => {
      // A row's own activation is a different gesture from its actions.
      event.stopPropagation();
      action.run(row);
    });
    cell.appendChild(capsule);
  }
  return cell;
}

/**
 * How activating a row behaves.
 *
 * `replace` leaves the parent behind — entering a directory, opening a
 * feed. `fold` keeps the parent on stage with the child listing inside it,
 * which is what a study does with its series. Same model, different mode.
 */
export type ExpansionMode = 'replace' | 'fold';

/** Which rows of a folding listing are currently open. */
export interface Expansion {
  mode: ExpansionMode;
  /** The open rows' keys. Always empty under `replace`, which keeps none. */
  open: Set<string>;
}

/**
 * Whether a row is showing its children.
 *
 * @param expansion - The listing's expansion state.
 * @param key - The row's key.
 * @returns True when the row's children are on stage beneath it.
 */
export function expansion_isOpen(expansion: Expansion, key: string): boolean {
  return expansion.mode === 'fold' && expansion.open.has(key);
}

/**
 * Activates a row: under `fold` its children toggle in place, under
 * `replace` nothing folds because the parent is left behind entirely.
 *
 * @param expansion - The listing's expansion state, mutated in place.
 * @param key - The row's key.
 * @returns Whether the row is open afterwards.
 */
export function expansion_toggle(expansion: Expansion, key: string): boolean {
  if (expansion.mode !== 'fold') return false;
  if (expansion.open.delete(key)) return false;
  expansion.open.add(key);
  return true;
}
