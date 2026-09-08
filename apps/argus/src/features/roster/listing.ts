/**
 * @file The listing façade: a pane declares its listing and never wires one.
 *
 * Three panes assembled the same listing by hand — `RosterOrder`, then
 * `ListingHost`, then the chrome lookups, the filter block, the strip
 * observer, the `argus:roster` parse — and then each added an action
 * track, an indication model, a readout and (in one) a selection, again
 * by hand and in two spellings. The parts were shared; the composition
 * was copied, and copied composition drifts. It cost something concrete:
 * the grid gained a track and one row kept its old cell count, and a row
 * one cell short does not leave a gap, it shifts every cell after it.
 *
 * A `Listing` is the composition, owned once. A pane gives it a
 * declaration — traits, key, what a row may do, what its chrome is called
 * — and thereafter calls `rows_set`. The grid template, the caps row and
 * every row's cell count come from that one declaration, action track
 * included, so a pane never states a column count and cannot get it
 * wrong. Two laws of `docs/aegis.adoc` are consequences of the
 * declaration rather than behaviour a pane remembers to implement:
 * `a-row-is-indicated-before-it-is-acted-on` (declared actions mint the
 * track and split click from double-click; no actions, no track, one
 * click) and `a-selection-belongs-to-the-field` (`rows_set` names the
 * field, and a selection lives exactly as long as that name holds).
 *
 * Built OVER the existing parts, additively: `RosterOrder` and
 * `ListingHost` keep their signatures, and no pane is touched here. The
 * panes convert one at a time, and their own spellings die as they do.
 *
 * @module
 */
import { RosterOrder } from './order.js';
import { ListingHost } from './host.js';
import {
  actionCell_build,
  expansion_isOpen,
  expansion_toggle,
  listingRow_build,
  traitColumns_of,
  traitValue_of,
  type Expansion,
  type ListingAction,
  type ListingTrait,
} from './row.js';

/**
 * One group of rows on stage: a listed directory, a query's answer, a
 * study's series. A flat listing passes one.
 *
 * @property key - Names the block, so a repaint can tell blocks apart.
 * @property header - What heads the block, when something does.
 * @property lead - Rows drawn before the ordered rows and outside the
 *   order: never sorted, filtered, counted, selected or given verbs. A
 *   browser's `..` is one.
 * @property rows - The rows the order governs.
 */
export interface ListingBlock<T> {
  key: string;
  header?: HTMLElement;
  lead?: ReadonlyArray<T>;
  rows: ReadonlyArray<T>;
}

/**
 * Where a pane's listing chrome is found.
 *
 * Every pane already follows one convention with a per-pane prefix:
 * `.pane-state` is common, and the mode-frame blocks are `<prefix>-filter`,
 * `<prefix>-select` and `<prefix>-selection-bar`. The façade finds them
 * itself from the root, so the pane writes no lookups.
 *
 * @property root - The element the chrome lives under (the pane, or a
 *   stamped body that carries its own frame).
 * @property prefix - The pane's block prefix (`files`, `runs`, `pacs`).
 */
export interface ListingChrome {
  root: HTMLElement;
  prefix: string;
}

/**
 * What the façade knows when it writes the state line.
 *
 * Typed rather than positional: a list of strings would be one more thing
 * whose order two sides have to agree on.
 *
 * @property filter - The order's own summary (`FILTERED n/m`), or empty.
 * @property selecting - Whether SELECT is on.
 * @property selected - How many rows are selected.
 * @property shown - How many of those are on stage under the filter.
 */
export interface ListingStateParts {
  filter: string;
  selecting: boolean;
  selected: number;
  shown: number;
}

/**
 * The verbs a row may be given, and the track that holds them.
 *
 * Declaring actions is what mints the action track: a fixed column, on
 * every row, reserved whether or not the row is indicated. A listing that
 * declares none has no track and keeps its single click.
 *
 * @property width - The track's CSS grid track (`21em`).
 * @property of - The verbs for one row.
 * @property always - Draw every row's verbs at once rather than on
 *   indication; the click then activates, as with no actions at all.
 */
export interface ListingActions<T> {
  width: string;
  of: (row: T) => ReadonlyArray<ListingAction<T>>;
  always?: boolean;
}

/**
 * A pane's own row-level concerns: state that marks a row rather than a
 * column (a refused read, an arrival), and anything else it wants on the
 * element.
 *
 * @property className - Extra classes for the row element.
 * @property decorate - Runs on the built row: title, dataset, whatever.
 */
export interface ListingRowBuild<T> {
  className?: (row: T) => string;
  decorate?: (element: HTMLElement, row: T) => void;
  /**
   * Extra classes for the GROUP a row heads when the level has a child:
   * the wrapper holding the row and, while the row is open, its level.
   */
  groupClassName?: (row: T) => string;
}

/**
 * What a selection may be told to do.
 *
 * @property verbs - The verbs for the current selection, as key/row pairs
 *   in selection order.
 */
export interface ListingSelection<T> {
  verbs: (rows: ReadonlyArray<[string, T]>) => ReadonlyArray<ListingAction<void>>;
}

/**
 * A level beneath a level: one row's children, listed under it when the
 * row is open.
 *
 * The child's row type is its own and never leaks into the parent's
 * declaration — `level_visit` hands both halves to a visitor generic in
 * that type, which is how the façade builds the child level without
 * either side naming the other's rows. Make one with `listingChild_declare`.
 */
export interface ListingChild<T> {
  level_visit<R>(visitor: <C>(of: (row: T) => ReadonlyArray<C>, declaration: ListingLevel<C>) => R): R;
}

/**
 * Declares a child level.
 *
 * @param of - One row's children.
 * @param declaration - How the children list.
 * @returns The child, ready for a parent's `child`.
 */
export function listingChild_declare<T, C>(
  of: (row: T) => ReadonlyArray<C>,
  declaration: ListingLevel<C>,
): ListingChild<T> {
  return {
    level_visit<R>(visitor: <X>(of: (row: T) => ReadonlyArray<X>, declaration: ListingLevel<X>) => R): R {
      return visitor(of, declaration);
    },
  };
}

/**
 * What every level of a listing declares: the shape of its rows.
 *
 * @property traits - The columns, in cap order; each carries its track.
 * @property key - A row's identity, the string everything else is keyed by.
 * @property actions - The row verbs, when there are any.
 * @property activate - What activating a row does. With a child level the
 *   row also folds open or closed.
 * @property activatable - Whether a row answers a click at all; absent
 *   means every row does.
 * @property indicated - Told when a row is indicated (a regard write).
 * @property row - The pane's own row-level concerns.
 * @property defaultSort - The initial sort, when the level has a natural one.
 * @property child - The level beneath this one, if any.
 */
export interface ListingLevel<T> {
  traits: ReadonlyArray<ListingTrait<T>>;
  key: (row: T) => string;
  actions?: ListingActions<T>;
  activate?: (row: T) => void;
  activatable?: (row: T) => boolean;
  indicated?: (row: T) => void;
  row?: ListingRowBuild<T>;
  defaultSort?: { key: string; dir: 'asc' | 'desc' };
  child?: ListingChild<T>;
}

/**
 * The root level, plus what only the root has: where it mounts, what
 * chrome it binds, whether it selects, how its state line reads.
 *
 * @property mount - The listing region: the frame seats at its head, the
 *   field opens beneath.
 * @property gridHost - Where `--roster-cols` is written. Defaults to the
 *   mount; a pane whose form stands on the same grid outside the mount
 *   names an ancestor of both.
 * @property chrome - The pane's chrome, when it has any to bind.
 * @property caps - Where the caps row lives: once in the frame (`root`),
 *   or minted afresh at the head of every block (`each`).
 * @property selection - Declared when the listing can select.
 * @property state - Composes the state line from the façade's parts; a
 *   pane prepends its own words here. Null leaves the span untouched.
 */
export interface ListingDeclaration<T> extends ListingLevel<T> {
  mount: HTMLElement;
  gridHost?: HTMLElement;
  chrome?: ListingChrome;
  caps?: 'root' | 'each';
  selection?: ListingSelection<T>;
  state?: (parts: ListingStateParts) => string | null;
  /**
   * What the field says when blocks were set but hold no rows: an answer
   * with nothing in it, which is a fact worth a line, as against no answer
   * yet, which is silence. Absent, the field is simply empty.
   */
  empty?: () => HTMLElement;
}

/**
 * Draws a block some other way than the grid — cards, previews. The
 * façade still opens the field, orders the rows and seats the frame; the
 * painter draws what it is given, rows already in order.
 */
export type ListingPainter<T> = (block: ListingBlock<T>, into: HTMLElement) => void;

/** The detail an `argus:roster` event carries. */
type RosterEventDetail =
  | { op: 'sort'; key: string; dir?: 'asc' | 'desc' }
  | { op: 'filter'; text: string };

/**
 * What a parent level asks of the level beneath it, with the child's row
 * type erased.
 */
interface ChildSeat<T> {
  /** Passes the filter text down; every level reads the one strip. */
  filter_set(text: string): void;
  /** Passes a sort down; a key names its level and the others ignore it. */
  sort_set(key: string, dir: 'asc' | 'desc'): void;
  /** Whether any of a row's children survive the filter. */
  survives(parent: T): boolean;
  /** Draws a row's children beneath it. */
  render(parent: T, into: HTMLElement, whole: boolean): void;
  /** Drops everything it held about the rows last drawn. */
  forget(): void;
  /** Sets which rows are open at a depth beneath this seat's level. */
  open_set(depth: number, keys: ReadonlyArray<string>): void;
  /** Closes every row at every depth beneath. */
  open_clear(): void;
  /** The template at a depth beneath this seat's level. */
  template_at(depth: number): string;
}

/** What a level asks of the listing that holds it. */
interface LevelHost {
  /** Repaints the whole listing on the next frame. */
  repaint(): void;
}

/**
 * How a level's click gathers a row while SELECT is on. Only the root
 * level selects; a level beneath has none and its rows indicate or
 * activate as they would otherwise.
 */
type LevelSelect<T> = ((key: string, row: T) => boolean) | null;

/**
 * Computes a level's grid template from its traits and its actions.
 *
 * @param traits - The columns.
 * @param actions - The action track, when declared.
 * @returns The `grid-template-columns` value.
 * @throws {Error} When a trait carries no width, or an uncapped trait
 *   follows a capped one — both are declaration errors that would
 *   otherwise surface as a shifted row.
 */
export function listingTemplate_of<T>(
  traits: ReadonlyArray<ListingTrait<T>>,
  actions?: ListingActions<T>,
): string {
  const tracks: string[] = [];
  let cappedSeen: boolean = false;
  for (const trait of traits) {
    if (trait.width === undefined || trait.width.trim() === '') {
      throw new Error(`listing trait '${trait.key}' declares no width`);
    }
    if (!track_isFixed(trait.width)) {
      throw new Error(`listing trait '${trait.key}' declares a content-sized track '${trait.width.trim()}': a row is its own grid, so a track sized to its content sizes per row and jogs every column after it`);
    }
    if (trait.capped === false) {
      if (cappedSeen) throw new Error(`uncapped listing trait '${trait.key}' must lead the traits`);
    } else {
      cappedSeen = true;
    }
    tracks.push(trait.width.trim());
  }
  if (actions !== undefined) {
    if (!track_isFixed(actions.width)) {
      throw new Error(`listing actions declare a content-sized track '${actions.width.trim()}'`);
    }
    tracks.push(actions.width.trim());
  }
  return tracks.join(' ');
}

/**
 * Whether a track is deterministic: a fixed length, a share of the
 * remaining space (`1fr`), or a `minmax` whose minimum is a fixed length.
 *
 * Not `auto`, not `min-content`, `max-content` or `fit-content`, and not
 * `minmax(0, …)`: on a per-row grid each of those sizes to the row's own
 * content, so a short value narrows the track for that row alone and every
 * column after it jogs — the misalignment a listing exists to prevent.
 *
 * @param track - The declared track.
 * @returns True when the track is the same width on every row.
 */
export function track_isFixed(track: string): boolean {
  const declared: string = track.trim();
  if (/^(auto|min-content|max-content)$/.test(declared) || /^fit-content\(/.test(declared)) return false;
  const minmax: RegExpMatchArray | null = /^minmax\(\s*([^,]+?)\s*,\s*([^)]+?)\s*\)$/.exec(declared);
  if (minmax !== null) {
    const minimum: string = minmax[1] ?? '';
    // A zero minimum is content-sizing in disguise: the track grows with
    // the row's content up to its maximum, which differs row by row.
    return /^(?:[1-9]\d*|0*\.\d*[1-9]\d*|[1-9]\d*\.\d+)(px|em|rem|ch|vw|vh|%)$/.test(minimum);
  }
  return /^(?:\d+\.?\d*|\.\d+)(px|em|rem|ch|vw|vh|%|fr)$/.test(declared);
}

/** The count of leading uncapped traits: the cells the caps row blanks. */
function leadingCells_of<T>(traits: ReadonlyArray<ListingTrait<T>>): number {
  let count: number = 0;
  for (const trait of traits) {
    if (trait.capped !== false) break;
    count += 1;
  }
  return count;
}

/**
 * One level of a listing: its order, its rows on stage, its indication,
 * and the level beneath it. The root listing is one of these with chrome
 * and a selection around it.
 */
class Level<T> {
  private declaration: ListingLevel<T>;
  private readonly host: LevelHost;
  private readonly select: LevelSelect<T>;
  public readonly order: RosterOrder<T>;
  public template: string;
  private readonly child: ChildSeat<T> | null;
  private readonly expansion: Expansion;
  /** Every row on stage, by key. */
  private readonly rowsByKey: Map<string, HTMLElement> = new Map();
  /** Every row's data, by key, for verbs and callbacks. */
  private readonly dataByKey: Map<string, T> = new Map();
  /** Every row's action cell, by key, so indicating fills one. */
  private readonly cellsByKey: Map<string, HTMLElement> = new Map();
  /** Rows drawn outside the order: no verbs, no selection. */
  private readonly leadKeys: Set<string> = new Set();
  private indicated: string | null = null;
  /** How many levels above this one: the root is 0. */
  private readonly depth: number;

  /**
   * @param declaration - The level's shape.
   * @param host - The listing holding it.
   * @param capsInRoot - Whether this level's frame carries a caps row.
   * @param select - Gathers a clicked row while SELECT is on, returning
   *   true when it did; null for a level that never selects.
   * @param depth - How many levels above this one; the root is 0.
   */
  constructor(declaration: ListingLevel<T>, host: LevelHost, capsInRoot: boolean, select: LevelSelect<T>, depth: number = 0) {
    this.declaration = declaration;
    this.host = host;
    this.select = select;
    this.depth = depth;
    this.template = listingTemplate_of(declaration.traits, declaration.actions);
    const capped: ReadonlyArray<ListingTrait<T>> = declaration.traits.filter(
      (trait: ListingTrait<T>): boolean => trait.capped !== false,
    );
    this.order = new RosterOrder<T>(
      traitColumns_of(capped),
      traitValue_of(declaration.traits),
      (): void => this.host.repaint(),
      declaration.defaultSort,
      leadingCells_of(declaration.traits),
      capsInRoot,
    );
    this.expansion = { mode: declaration.child === undefined ? 'replace' : 'fold', open: new Set<string>() };
    this.child = declaration.child === undefined ? null : this.childSeat_build(declaration.child);
    if (this.child !== null) {
      const seat: ChildSeat<T> = this.child;
      this.order.filterChange_observe((text: string): void => seat.filter_set(text));
    }
  }

  /** Builds the level beneath this one, its row type kept to itself. */
  private childSeat_build(child: ListingChild<T>): ChildSeat<T> {
    return child.level_visit(<C>(of: (row: T) => ReadonlyArray<C>, declaration: ListingLevel<C>): ChildSeat<T> => {
      const level: Level<C> = new Level<C>(declaration, this.host, false, null, this.depth + 1);
      return {
        filter_set: (text: string): void => level.filter_set(text),
        sort_set: (key: string, dir: 'asc' | 'desc'): void => level.sort_set(key, dir),
        survives: (parent: T): boolean => level.anyMatch(of(parent)),
        render: (parent: T, into: HTMLElement, whole: boolean): void => {
          const element: HTMLElement = document.createElement('div');
          element.className = 'listing-level';
          // The stylesheet indents by depth, never by which pane this is.
          element.dataset['depth'] = String(this.depth + 1);
          element.style.setProperty('--roster-cols', level.template);
          element.appendChild(level.order.caps_mint());
          level.rows_draw(of(parent), [], element, whole);
          into.appendChild(element);
        },
        forget: (): void => level.forget(),
        open_set: (depth: number, keys: ReadonlyArray<string>): void => level.open_set(depth, keys),
        open_clear: (): void => level.open_clear(),
        template_at: (depth: number): string => level.template_at(depth),
      };
    });
  }

  /**
   * Declares, or withdraws, the row verbs after construction.
   *
   * A surface declares what a row may do once it knows, which is after
   * the pane exists; a browser given no verbs keeps its single click and
   * spends no track. The template follows the declaration.
   *
   * @param actions - The verbs and their track, or null for none.
   */
  public actions_set(actions: ListingActions<T> | null): void {
    this.declaration = { ...this.declaration, ...(actions === null ? { actions: undefined } : { actions }) };
    this.template = listingTemplate_of(this.declaration.traits, this.declaration.actions);
  }

  /** Sets this level's filter text and passes it beneath. */
  public filter_set(text: string): void {
    this.order.filter_set(text, false);
  }

  /** Sorts this level and every level beneath by a key each may ignore. */
  public sort_set(key: string, dir: 'asc' | 'desc'): void {
    this.order.sort_set(key, dir);
    this.child?.sort_set(key, dir);
  }

  /**
   * Sets which rows are open at a depth counted from this level (0 = here).
   *
   * @param depth - Levels beneath this one.
   * @param keys - The keys to hold open there; every other row closes.
   */
  public open_set(depth: number, keys: ReadonlyArray<string>): void {
    if (depth === 0) {
      this.expansion.open.clear();
      if (this.expansion.mode === 'fold') for (const key of keys) this.expansion.open.add(key);
      return;
    }
    this.child?.open_set(depth - 1, keys);
  }

  /** Closes every row at this level and every level beneath. */
  public open_clear(): void {
    this.expansion.open.clear();
    this.child?.open_clear();
  }

  /**
   * The grid template at a depth counted from this level (0 = here).
   *
   * @param depth - Levels beneath this one.
   * @returns The template.
   * @throws {Error} When no level exists at that depth.
   */
  public template_at(depth: number): string {
    if (depth === 0) return this.template;
    if (this.child === null) throw new Error(`no listing level at depth ${this.depth + depth}`);
    return this.child.template_at(depth - 1);
  }

  /** Whether any row of a set survives the filter, at this level or beneath. */
  public anyMatch(rows: ReadonlyArray<T>): boolean {
    return rows.some((row: T): boolean => this.order.matches(row) || (this.child?.survives(row) ?? false));
  }

  /** Whether the filter is empty, so every row is whole. */
  public filter_isEmpty(): boolean {
    return this.order.state_get().filter.length === 0;
  }

  /**
   * The rows the order keeps, in order.
   *
   * @param rows - The rows.
   * @param whole - Whether every row is kept regardless of the filter (the
   *   parent matched, so its children all show).
   * @returns The kept rows, sorted.
   */
  public rows_keep(rows: ReadonlyArray<T>, whole: boolean): T[] {
    const kept: T[] = whole
      ? [...rows]
      : rows.filter((row: T): boolean => this.order.matches(row) || (this.child?.survives(row) ?? false));
    return this.order.sorted(kept);
  }

  /** Drops everything held about the rows last drawn. */
  public forget(): void {
    this.rowsByKey.clear();
    this.dataByKey.clear();
    this.cellsByKey.clear();
    this.leadKeys.clear();
    this.indicated = null;
    this.child?.forget();
  }

  /**
   * Draws lead rows, then the kept rows in order, each open row followed
   * by its children.
   *
   * @param rows - The rows the order governs.
   * @param lead - Rows drawn first and outside the order.
   * @param into - The element rows are appended to.
   * @param whole - Whether every row is kept regardless of the filter.
   * @returns How many governed rows were drawn.
   */
  public rows_draw(rows: ReadonlyArray<T>, lead: ReadonlyArray<T>, into: HTMLElement, whole: boolean): number {
    for (const row of lead) into.appendChild(this.row_build(row, true));
    const kept: T[] = this.rows_keep(rows, whole);
    for (const row of kept) {
      const element: HTMLElement = this.row_build(row, false);
      if (this.child === null) {
        into.appendChild(element);
        continue;
      }
      // A row that heads a level is wrapped with it: the group is the
      // thing that opens and closes, and a stylesheet or a scenario can
      // address "this study and its series" as one element.
      const key: string = this.declaration.key(row);
      const open: boolean = expansion_isOpen(this.expansion, key);
      const group: HTMLElement = document.createElement('div');
      const own: string | undefined = this.declaration.row?.groupClassName?.(row);
      group.className = `listing-group${open ? ' listing-open' : ''}${own === undefined || own === '' ? '' : ` ${own}`}`;
      group.appendChild(element);
      if (open) {
        element.classList.add('listing-open');
        this.child.render(row, group, whole || this.order.matches(row));
      }
      into.appendChild(group);
    }
    return kept.length;
  }

  /**
   * Builds one row: a cell per trait, then the action track when actions
   * are declared, then the pane's own decoration; and wires the click.
   *
   * @param row - The row's data.
   * @param lead - Whether the row stands outside the order.
   * @returns The row element.
   */
  private row_build(row: T, lead: boolean): HTMLElement {
    const declaration: ListingLevel<T> = this.declaration;
    const key: string = declaration.key(row);
    const element: HTMLElement = listingRow_build(row, declaration.traits, {
      className: (data: T): string => {
        const own: string | undefined = declaration.row?.className?.(data);
        return own === undefined || own === '' ? 'listing-row' : `listing-row ${own}`;
      },
      decorate: (built: HTMLElement, data: T): void => {
        built.dataset['key'] = key;
        if (declaration.actions !== undefined) {
          // The track is on EVERY row, lead rows included, and empty until
          // the row is indicated: what changes on indication is what the
          // track holds, never the geometry around it.
          const cell: HTMLSpanElement = document.createElement('span');
          cell.className = 'listing-actions';
          if (!lead && declaration.actions.always === true) {
            cell.replaceChildren(...actionCell_build(data, declaration.actions.of(data)).childNodes);
          }
          built.appendChild(cell);
          this.cellsByKey.set(key, cell);
        }
        declaration.row?.decorate?.(built, data);
      },
    });
    this.rowsByKey.set(key, element);
    this.dataByKey.set(key, row);
    if (lead) this.leadKeys.add(key);
    if (declaration.activatable?.(row) === false) return element;
    element.classList.add('listing-activatable');
    const splits: boolean = !lead && declaration.actions !== undefined && declaration.actions.always !== true;
    element.addEventListener('click', (): void => {
      if (!lead && this.select !== null && this.select(key, row)) return;
      if (!splits) {
        this.row_activate(row, key, lead);
        return;
      }
      // A click says "this one"; a double-click says "go". Only a listing
      // that hides verbs until a row is indicated needs the split.
      this.row_indicate(key);
    });
    if (splits) {
      element.addEventListener('dblclick', (): void => {
        // The click that opened the double-click indicated the row;
        // activating moves on, so the indication goes too.
        this.row_indicate(null);
        this.row_activate(row, key, false);
      });
    }
    return element;
  }

  /** Activates a row: folds it when it has children, and tells the pane. */
  private row_activate(row: T, key: string, lead: boolean): void {
    if (!lead && this.child !== null) {
      expansion_toggle(this.expansion, key);
      this.host.repaint();
    }
    this.declaration.activate?.(row);
  }

  /**
   * Indicates one row: its verbs fill its own track and the previously
   * indicated row's track empties.
   *
   * @param key - The row's key, or null to indicate nothing.
   */
  public row_indicate(key: string | null): void {
    if (this.indicated !== null) {
      this.cellsByKey.get(this.indicated)?.replaceChildren();
      this.rowsByKey.get(this.indicated)?.classList.remove('listing-indicated');
    }
    this.indicated = key;
    if (key === null) return;
    const row: T | undefined = this.dataByKey.get(key);
    const element: HTMLElement | undefined = this.rowsByKey.get(key);
    if (row === undefined || element === undefined || this.leadKeys.has(key)) {
      this.indicated = null;
      return;
    }
    element.classList.add('listing-indicated');
    const cell: HTMLElement | undefined = this.cellsByKey.get(key);
    const offered: ReadonlyArray<ListingAction<T>> = this.declaration.actions?.of(row) ?? [];
    if (cell !== undefined && offered.length > 0) {
      cell.replaceChildren(...actionCell_build(row, offered).childNodes);
    }
    this.declaration.indicated?.(row);
  }

  /** The indicated row's key, or null. */
  public indicated_get(): string | null {
    return this.indicated;
  }

  /**
   * Shows a readout beside an indicated row's verbs; dropped when the
   * operator has moved on.
   *
   * @param key - The row the readout belongs to.
   * @param text - What to say beside the verbs.
   */
  public readout_show(key: string, text: string): void {
    if (this.indicated !== key) return;
    const cell: HTMLElement | undefined = this.cellsByKey.get(key);
    if (cell === undefined) return;
    const readout: HTMLSpanElement = document.createElement('span');
    readout.className = 'listing-readout';
    readout.textContent = text;
    cell.querySelector('.listing-readout')?.remove();
    cell.appendChild(readout);
  }

  /** A row's element, when it is on stage. */
  public row_element(key: string): HTMLElement | null {
    return this.rowsByKey.get(key) ?? null;
  }

  /** The keys of the governed rows on stage. */
  public keys_onStage(): string[] {
    return [...this.rowsByKey.keys()].filter((key: string): boolean => !this.leadKeys.has(key));
  }
}

/**
 * A listing a pane declares into.
 *
 * Owns the frame, the field, the grid template, the action track, the
 * indication, the selection and the state line — everything the panes
 * used to compose for themselves. A pane's listing code is a declaration
 * plus `rows_set`.
 */
export class Listing<T> {
  private readonly declaration: ListingDeclaration<T>;
  private readonly level: Level<T>;
  private readonly host: ListingHost<T>;
  private readonly gridHost: HTMLElement;
  private readonly stateSpan: HTMLElement | null;
  private readonly filterBlock: HTMLElement | null;
  private readonly selectBlock: HTMLElement | null;
  private readonly selectionBar: HTMLElement | null;
  /** What was last given to `rows_set`, repainted on any order change. */
  private blocks: ReadonlyArray<ListingBlock<T>> = [];
  /** The field the rows belong to; a different one is navigation. */
  private field: string | null = null;
  private painter: ListingPainter<T> | null = null;
  private selecting: boolean = false;
  /** The selected rows, by key, kept across renders of the same field. */
  private readonly selection: Map<string, T> = new Map();
  private repaintQueued: boolean = false;

  /**
   * @param declaration - The listing's shape and chrome.
   */
  constructor(declaration: ListingDeclaration<T>) {
    this.declaration = declaration;
    this.gridHost = declaration.gridHost ?? declaration.mount;
    this.level = new Level<T>(
      declaration,
      { repaint: (): void => this.repaint_queue() },
      declaration.caps !== 'each',
      declaration.selection === undefined ? null : (key: string, row: T): boolean => this.selection_gather(key, row),
    );
    this.host = new ListingHost<T>(declaration.mount, this.level.order);
    // The grid is one declaration: track list, caps and cells all read it.
    this.gridHost.style.setProperty('--roster-cols', this.level.template);

    const chrome: ListingChrome | undefined = declaration.chrome;
    this.stateSpan = chrome?.root.querySelector<HTMLElement>('.pane-state') ?? null;
    this.filterBlock = chrome?.root.querySelector<HTMLElement>(`.${chrome.prefix}-filter`) ?? null;
    this.selectBlock = chrome?.root.querySelector<HTMLElement>(`.${chrome.prefix}-select`) ?? null;
    this.selectionBar = chrome?.root.querySelector<HTMLElement>(`.${chrome.prefix}-selection-bar`) ?? null;
    this.filterBlock?.classList.add('rail-off');
    this.filterBlock?.addEventListener('click', (): void => this.filter_toggle());
    this.level.order.stripChange_observe((): void => this.filterBlock_sync());
    this.selectBlock?.addEventListener('click', (): void => this.select_toggle());
    // The language reaches ordering through a DOM event on the pane.
    chrome?.root.addEventListener('argus:roster', (event: Event): void => {
      const detail: RosterEventDetail = (event as CustomEvent<RosterEventDetail>).detail;
      if (detail.op === 'sort') this.level.sort_set(detail.key, detail.dir ?? 'asc');
      else if (detail.text === '') this.level.order.strip_toggle(false);
      else this.level.order.filter_set(detail.text);
    });
    this.filterBlock_sync();
  }

  /**
   * Puts rows on stage.
   *
   * The field names what the rows belong to: the listed path for a
   * browser, a constant for a roster, a query's id. The same field is the
   * same field, so the selection survives a filter and a re-listing; a
   * different field is navigation, so it clears.
   *
   * @param blocks - The rows, in blocks.
   * @param context - The field the rows belong to.
   */
  public rows_set(blocks: ReadonlyArray<ListingBlock<T>>, context: { field: string }): void {
    if (this.field !== null && context.field !== this.field) this.selection.clear();
    this.field = context.field;
    this.blocks = blocks;
    this.render();
  }

  /** Coalesces order changes across every level into one repaint. */
  private repaint_queue(): void {
    if (this.repaintQueued) return;
    this.repaintQueued = true;
    window.requestAnimationFrame((): void => {
      this.repaintQueued = false;
      this.render();
    });
  }

  /** Paints the blocks: frame seated, field opened, rows drawn, state written. */
  private render(): void {
    this.level.forget();
    const field: HTMLElement = this.host.field_open();
    const whole: boolean = this.level.filter_isEmpty();
    let shown: number = 0;
    let total: number = 0;
    const governed: number = this.blocks.reduce((sum: number, block: ListingBlock<T>): number => sum + block.rows.length, 0);
    if (this.blocks.length > 0 && governed === 0 && this.declaration.empty !== undefined) {
      field.appendChild(this.declaration.empty());
    }
    for (const block of this.blocks) {
      const section: HTMLElement = document.createElement('section');
      section.className = 'listing-block';
      section.dataset['key'] = block.key;
      if (block.header !== undefined) section.appendChild(block.header);
      if (this.declaration.caps === 'each') section.appendChild(this.level.order.caps_mint());
      total += block.rows.length;
      if (this.painter !== null) {
        const kept: T[] = this.level.rows_keep(block.rows, whole);
        shown += kept.length;
        this.painter({ ...block, rows: kept }, section);
      } else {
        const rows: HTMLElement = document.createElement('div');
        rows.className = 'listing-rows';
        shown += this.level.rows_draw(block.rows, block.lead ?? [], rows, whole);
        section.appendChild(rows);
      }
      field.appendChild(section);
    }
    this.level.order.counts_set(shown, total);
    this.selection_render();
    this.state_render();
  }

  /**
   * Indicates one row, or nothing.
   *
   * @param key - The row's key, or null.
   */
  public row_indicate(key: string | null): void {
    this.level.row_indicate(key);
  }

  /** The indicated row's key, or null. */
  public indicated_get(): string | null {
    return this.level.indicated_get();
  }

  /**
   * Shows a readout beside an indicated row's verbs.
   *
   * @param key - The row the readout belongs to.
   * @param text - What to say.
   */
  public readout_show(key: string, text: string): void {
    this.level.readout_show(key, text);
  }

  /**
   * A row's element while it is on stage, for a pane that marks rows
   * between renders (an arrival pulse).
   *
   * @param key - The row's key.
   * @returns The element, or null when the row is not on stage.
   */
  public row_element(key: string): HTMLElement | null {
    return this.level.row_element(key);
  }

  /**
   * The grid template a level's traits declare, for a form that stands on it.
   *
   * @param depth - Which level: 0 for the root, 1 for its child, and so on.
   * @returns The template.
   */
  public template_get(depth: number = 0): string {
    return this.level.template_at(depth);
  }

  /** The field on stage, or null before the first render — for a pane that seats a wait in it. */
  public field_get(): HTMLElement | null {
    return this.host.field_get();
  }

  /**
   * Holds open exactly these rows at a depth, and repaints when rows are
   * on stage. A level with one row opens itself this way; a cohort still
   * arrives folded.
   *
   * @param depth - Which level: 0 for the root, 1 for its child, and so on.
   * @param keys - The keys to hold open there.
   */
  public open_set(depth: number, keys: ReadonlyArray<string>): void {
    this.level.open_set(depth, keys);
    if (this.field !== null) this.render();
  }

  /** Closes every row at every level. Takes effect at the next render. */
  public open_clear(): void {
    this.level.open_clear();
  }

  /**
   * Draws blocks another way, or `null` to return to the grid. A painted
   * block has no grid, so its rows carry no track, no indication and no
   * select-click; the painter owns what a click means. Takes effect at the
   * next `rows_set`: the pane decides when the field is repainted, since
   * something else may be standing on it.
   *
   * @param paint - The painter, or null.
   */
  public painter_set(paint: ListingPainter<T> | null): void {
    this.painter = paint;
  }

  /**
   * Declares, or withdraws, the row verbs after construction: the track
   * is minted or dropped, the template rewritten, and the rows on stage
   * repainted to match.
   *
   * @param actions - The verbs and their track, or null for none.
   */
  public actions_declare(actions: ListingActions<T> | null): void {
    this.level.actions_set(actions);
    this.gridHost.style.setProperty('--roster-cols', this.level.template);
    if (this.field !== null) this.render();
  }

  /** Shows or hides the filter strip (the mode frame's FILTER, or the language). */
  public filter_toggle(open?: boolean): void {
    this.level.order.strip_toggle(open);
  }

  /** The FILTER block reads the strip's state, like every mode block. */
  private filterBlock_sync(): void {
    if (this.filterBlock === null) return;
    const on: boolean = this.level.order.strip_isOpen();
    this.filterBlock.textContent = on ? 'FILTER ON' : 'FILTER OFF';
    this.filterBlock.classList.toggle('rail-off', !on);
  }

  /**
   * Turns SELECT on or off. Turning it off clears nothing: the selection
   * is the field's until the field changes.
   *
   * @param on - Whether to select; omitted flips the mode.
   */
  public select_toggle(on?: boolean): void {
    if (this.declaration.selection === undefined) return;
    this.selecting = on ?? !this.selecting;
    if (this.level.indicated_get() !== null) this.level.row_indicate(null);
    this.declaration.mount.classList.toggle('listing-selecting', this.selecting);
    this.selectBlock?.classList.toggle('rail-off', !this.selecting);
    if (this.selectBlock !== null) this.selectBlock.textContent = this.selecting ? 'SELECT ON' : 'SELECT OFF';
    this.selection_render();
    this.state_render();
  }

  /** Whether SELECT is on. */
  public select_isOn(): boolean {
    return this.selecting;
  }

  /** The selected keys, in selection order. */
  public selection_get(): string[] {
    return [...this.selection.keys()];
  }

  /**
   * A row was clicked: while SELECT is on, toggles its membership of the
   * selection and answers true; otherwise answers false and the click
   * means what it would have meant.
   */
  private selection_gather(key: string, row: T): boolean {
    if (!this.selecting) return false;
    if (this.selection.has(key)) this.selection.delete(key);
    else this.selection.set(key, row);
    this.selection_render();
    this.state_render();
    return true;
  }

  /** Paints the selection: the marked rows, and the bar's verbs. */
  private selection_render(): void {
    for (const key of this.level.keys_onStage()) {
      this.level.row_element(key)?.classList.toggle('listing-selected', this.selection.has(key));
    }
    const bar: HTMLElement | null = this.selectionBar;
    if (bar === null) return;
    const rows: Array<[string, T]> = [...this.selection.entries()];
    const offered: ReadonlyArray<ListingAction<void>> =
      this.selecting && rows.length > 0 ? this.declaration.selection?.verbs(rows) ?? [] : [];
    bar.replaceChildren(...(offered.length === 0 ? [] : actionCell_build<void>(undefined, offered).childNodes));
    bar.hidden = offered.length === 0;
  }

  /** How many selected rows are on stage under the current filter. */
  private selectionShown_count(): number {
    let shown: number = 0;
    for (const key of this.selection.keys()) {
      if (this.level.row_element(key) !== null) shown += 1;
    }
    return shown;
  }

  /** Rewrites the state line from the façade's parts, through the composer. */
  public state_refresh(): void {
    this.state_render();
  }

  private state_render(): void {
    if (this.stateSpan === null) return;
    const parts: ListingStateParts = {
      filter: this.level.order.summary(),
      selecting: this.selecting,
      selected: this.selection.size,
      shown: this.selectionShown_count(),
    };
    const text: string | null =
      this.declaration.state !== undefined ? this.declaration.state(parts) : listingState_compose(parts);
    if (text === null) return;
    this.stateSpan.textContent = text;
  }
}

/**
 * The default state line: SELECT while selecting, the filter's summary,
 * and how many are selected — with how many of those are on stage when a
 * filter hides some, since a verb acts on the whole selection.
 *
 * @param parts - The façade's parts.
 * @returns The line, empty when there is nothing to say.
 */
export function listingState_compose(parts: ListingStateParts): string {
  const words: string[] = [];
  if (parts.selecting) words.push('SELECT');
  if (parts.filter !== '') words.push(parts.filter);
  if (parts.selected > 0) {
    words.push(
      parts.shown === parts.selected
        ? `${parts.selected} SELECTED`
        : `${parts.selected} SELECTED · ${parts.shown} SHOWN`,
    );
  }
  return words.join(' · ');
}
