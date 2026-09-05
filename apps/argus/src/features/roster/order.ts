/**
 * @file Roster ordering: per-column sort and a filter strip, shared by every
 * tabular pane (the files listing, the feed roster).
 *
 * The column caps ARE the sort control — the table's own frame, touched to
 * sort, touched again to reverse (machinery at the frame of the thing it
 * governs). Filtering is a mode, so its strip is summoned from the pane
 * drawer (FILTER) or the language, and the pane's title bar carries the
 * resulting STATE (`FILTERED 12/695`) — state on a bar is lawful.
 *
 * Runs entirely over resident rows: no wire traffic, instant.
 *
 * @module
 */

/** One sortable, filterable column. */
export interface RosterColumn {
  key: string;
  label: string;
}

/** The order state a pane can serialize. */
export interface RosterOrderState {
  sortKey: string | null;
  sortDir: 'asc' | 'desc';
  filter: string;
}

/** Row accessors the pane provides: a comparable value per column key. */
export type RosterValue_of<T> = (row: T, key: string) => string | number;

/**
 * Sort + filter state with its DOM pieces: caps rows and the filter strip.
 * Mount `root` at the head of the pane's listing region. A flat listing
 * keeps its caps in `root`; a grouped one mints a row per group instead.
 */
export class RosterOrder<T> {
  public readonly root: HTMLElement;
  /**
   * Every caps row bound to this state. A flat listing has one; a grouped
   * listing heads each group with its own, all reading the same sort.
   */
  private readonly capsRows: HTMLElement[] = [];
  private readonly strip: HTMLElement;
  private readonly input: HTMLInputElement;
  private readonly columns: RosterColumn[];
  private readonly value_of: RosterValue_of<T>;
  private readonly onChange: () => void;
  private readonly leadingCells: number;
  private state: RosterOrderState = { sortKey: null, sortDir: 'asc', filter: '' };
  private changeQueued: boolean = false;

  /** Coalesces state changes into one re-render per frame. */
  private change_emit(): void {
    if (this.changeQueued) return;
    this.changeQueued = true;
    window.requestAnimationFrame((): void => {
      this.changeQueued = false;
      this.onChange();
    });
  }

  /**
   * Ensures the caps + strip stand at the head of `host` WITHOUT being
   * re-inserted (a re-insert blurs the filter input mid-word), then clears
   * everything after them so the pane can paint fresh rows.
   *
   * @param host - The listing region.
   */
  public host_prepare(host: HTMLElement): void {
    if (this.root.parentElement !== host) host.prepend(this.root);
    for (const child of [...host.children]) {
      if (child !== this.root) child.remove();
    }
  }
  private shown: number = 0;
  private total: number = 0;

  /**
   * @param columns - The columns, in cap order.
   * @param value_of - Comparable value of a row under a column key.
   * @param onChange - Called after any state change; the pane re-renders.
   * @param defaultSort - The initial sort, when the roster has a natural one.
   * @param leadingCells - Cells the rows spend before the first column.
   * @param capsInRoot - Whether the frame carries a caps row of its own.
   *   False for a grouped listing, whose caps are minted per group; the
   *   frame then carries the filter strip alone.
   */
  constructor(
    columns: RosterColumn[],
    value_of: RosterValue_of<T>,
    onChange: () => void,
    defaultSort?: { key: string; dir: 'asc' | 'desc' },
    leadingCells: number = 0,
    capsInRoot: boolean = true,
  ) {
    this.columns = columns;
    this.value_of = value_of;
    this.onChange = onChange;
    if (defaultSort !== undefined) {
      this.state = { ...this.state, sortKey: defaultSort.key, sortDir: defaultSort.dir };
    }
    this.leadingCells = leadingCells;
    this.root = document.createElement('div');
    this.root.className = 'roster-order';
    this.strip = document.createElement('div');
    this.strip.className = 'roster-filter';
    this.strip.hidden = true;
    const glyph: HTMLSpanElement = document.createElement('span');
    glyph.className = 'roster-filter-glyph';
    glyph.textContent = 'FILTER :';
    this.input = document.createElement('input');
    this.input.className = 'roster-filter-input';
    this.input.placeholder = 'text, or column:text (e.g. owner:<user> status:error)';
    this.input.setAttribute('autocomplete', 'off');
    this.input.addEventListener('input', (): void => this.filter_set(this.input.value, false));
    this.input.addEventListener('keydown', (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        this.strip_toggle(false);
      }
    });
    this.strip.append(glyph, this.input);
    if (capsInRoot) this.root.appendChild(this.caps_mint());
    this.root.appendChild(this.strip);
    this.caps_paint();
  }

  /**
   * Mints a caps row over this state.
   *
   * A grouped listing — a PACS query's studies, each heading its own series
   * — calls this once per group, so every group's caps come from the same
   * column declaration and light together under the same sort. The caller
   * mounts what it gets; rows that leave the document are dropped at the
   * next paint.
   *
   * @returns The caps row, already painted.
   */
  public caps_mint(): HTMLElement {
    const caps: HTMLElement = document.createElement('div');
    caps.className = 'roster-caps';
    // The caps row is the SAME grid as the rows it heads; columns the rows
    // spend on glyphs get empty cells so every cap sits over its column.
    for (let i = 0; i < this.leadingCells; i++) caps.appendChild(document.createElement('span'));
    for (const column of this.columns) {
      const cap: HTMLButtonElement = document.createElement('button');
      cap.className = 'roster-cap';
      cap.dataset['key'] = column.key;
      cap.title = `sort by ${column.label.toLowerCase()} (again to reverse)`;
      cap.addEventListener('click', (): void => this.sort_toggle(column.key));
      caps.appendChild(cap);
    }
    this.capsRows.push(caps);
    this.caps_paint();
    return caps;
  }

  /** @returns The current state, for serialization. */
  public state_get(): RosterOrderState {
    return { ...this.state };
  }

  /** Sorts by a column; the same column again reverses. */
  public sort_toggle(key: string): void {
    if (this.state.sortKey === key) {
      this.sort_set(key, this.state.sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      this.sort_set(key, 'asc');
    }
  }

  public sort_set(key: string, dir: 'asc' | 'desc'): void {
    if (!this.columns.some((column: RosterColumn): boolean => column.key === key)) return;
    this.state = { ...this.state, sortKey: key, sortDir: dir };
    this.caps_paint();
    this.change_emit();
  }

  /** Called whenever the filter text changes (a second level reads it). */
  private onFilter: ((text: string) => void) | null = null;

  /**
   * Registers the listener told whenever the filter text changes.
   *
   * A listing of LEVELS keeps one order per level and one strip; the levels
   * below the strip's owner learn the text this way.
   *
   * @param listener - The listener.
   */
  public filterChange_observe(listener: (text: string) => void): void {
    this.onFilter = listener;
  }

  /** Sets the filter text; `syncInput` also writes it into the strip. */
  public filter_set(text: string, syncInput: boolean = true): void {
    this.state = { ...this.state, filter: text };
    this.onFilter?.(text);
    if (syncInput) this.input.value = text;
    if (text.length > 0 && this.strip.hidden) {
      this.strip.hidden = false;
      this.onStrip?.();
    }
    this.change_emit();
  }

  /** Shows or hides the filter strip; showing focuses the input. */
  public strip_toggle(open?: boolean): void {
    const next: boolean = open ?? this.strip.hidden;
    this.strip.hidden = !next;
    if (next) {
      this.input.focus();
    } else if (this.state.filter.length > 0) {
      // Closing the strip clears the filter: hidden state would be a lie.
      this.filter_set('');
    }
    this.onStrip?.();
  }

  /** Whether the filter strip is on stage. */
  public strip_isOpen(): boolean {
    return !this.strip.hidden;
  }

  /** Called whenever the strip opens or closes (a FILTER block reads it). */
  private onStrip: (() => void) | null = null;

  /**
   * Registers the listener told whenever the strip opens or closes.
   *
   * @param listener - The listener.
   */
  public stripChange_observe(listener: () => void): void {
    this.onStrip = listener;
  }

  /**
   * Whether a row passes the current filter.
   *
   * Exposed for a listing of LEVELS, where a parent survives because one of
   * its children matched — a rule `apply` cannot express, since it knows
   * only its own rows.
   *
   * @param row - The row.
   * @returns True when the filter keeps it.
   */
  public matches(row: T): boolean {
    return this.terms_parse().every((term: { key: string | null; text: string }): boolean => {
      const haystack: string =
        term.key !== null
          ? String(this.value_of(row, term.key)).toLowerCase()
          : this.columns.map((column: RosterColumn): string => String(this.value_of(row, column.key))).join(' ').toLowerCase();
      return haystack.includes(term.text);
    });
  }

  /**
   * Sorts without filtering.
   *
   * @param rows - The rows.
   * @returns A sorted copy.
   */
  public sorted(rows: T[]): T[] {
    const kept: T[] = [...rows];
    const key: string | null = this.state.sortKey;
    if (key === null) return kept;
    const sign: number = this.state.sortDir === 'asc' ? 1 : -1;
    kept.sort((a: T, b: T): number => {
      const va: string | number = this.value_of(a, key);
      const vb: string | number = this.value_of(b, key);
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * sign;
      return String(va).localeCompare(String(vb), undefined, { numeric: true, sensitivity: 'base' }) * sign;
    });
    return kept;
  }

  /**
   * Records what the pane actually showed, when it decided that itself.
   *
   * A grouped listing counts across its groups, so `apply`'s own tally would
   * describe one group rather than the answer.
   *
   * @param shown - Rows on stage.
   * @param total - Rows there are.
   */
  public counts_set(shown: number, total: number): void {
    this.shown = shown;
    this.total = total;
  }

  /** The filter's terms: a bare word, or `column:text` naming a column. */
  private terms_parse(): Array<{ key: string | null; text: string }> {
    return this.state.filter
      .toLowerCase()
      .split(/\s+/)
      .filter((term: string): boolean => term.length > 0)
      .map((term: string): { key: string | null; text: string } => {
        const colon: number = term.indexOf(':');
        if (colon > 0) {
          const key: string = term.slice(0, colon);
          if (this.columns.some((column: RosterColumn): boolean => column.key === key)) {
            return { key, text: term.slice(colon + 1) };
          }
        }
        return { key: null, text: term };
      });
  }

  /** Applies filter then sort. Records shown/total for the summary. */
  public apply(rows: T[]): T[] {
    const kept: T[] = this.sorted(rows.filter((row: T): boolean => this.matches(row)));
    this.shown = kept.length;
    this.total = rows.length;
    return kept;
  }

  /** The state line for the pane's title bar (empty when nothing to say). */
  public summary(): string {
    const parts: string[] = [];
    if (this.state.filter.length > 0) parts.push(`FILTERED ${this.shown}/${this.total}`);
    return parts.join(' · ');
  }

  /**
   * Paints every caps row: the active column lit, with its direction glyph.
   *
   * A repaint first drops rows that have left the document, so a pane that
   * mints fresh caps on each render does not accumulate them.
   */
  private caps_paint(): void {
    const live: HTMLElement[] = this.capsRows.filter(
      (caps: HTMLElement): boolean => caps.parentElement === null || caps.isConnected,
    );
    this.capsRows.length = 0;
    this.capsRows.push(...live);
    for (const caps of this.capsRows) {
      for (const cap of caps.querySelectorAll<HTMLElement>('.roster-cap')) {
        const key: string = cap.dataset['key'] ?? '';
        const column: RosterColumn | undefined = this.columns.find((c: RosterColumn): boolean => c.key === key);
        const active: boolean = key === this.state.sortKey;
        cap.classList.toggle('roster-active', active);
        cap.textContent = `${column?.label ?? key}${active ? (this.state.sortDir === 'asc' ? ' ▲' : ' ▼') : ''}`;
      }
    }
  }
}
