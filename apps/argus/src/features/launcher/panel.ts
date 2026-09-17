/**
 * @file The LAUNCHER: where a session begins when nothing is open.
 *
 * A first screen has three questions to answer — where am I, what can I do,
 * what happens next — and the resting workspace answered none of them at
 * once: a gutter, a header of instruments, a half-open console and a file
 * listing all said "start here", so none of them did.
 *
 * The launcher answers them as blocks, which is what this frame is made of.
 * One block per domain, each carrying what that domain holds right now and
 * ending in the verb that opens it. A block's rows are doors: pressing one
 * lands exactly there, so the screen is a set of ways back into recent work
 * rather than a menu of places to go hunting.
 *
 * Every colour here is a palette token, and the type on it is the frame's
 * own black-on-hue, so the smoke suite's contrast gate holds it to WCAG AA
 * in all five schemes like any other surface. Nothing is faded to make it
 * look quiet: a translucent chevron is a failed pairing waiting to happen.
 *
 * @module
 */

/** One row of a tile: a thing that exists, and what pressing it opens. */
export interface LauncherRow {
  /** What the row reads. */
  text: string;
  /** Marked as arrived since the operator was last here. */
  arrived?: boolean;
  /** Carries the error hue: something on it failed. */
  errored?: boolean;
  /** What a press does; a row without one is a readout. */
  open?: () => void;
}

/** One figure on a tile's head: a count, a state, or a filter. */
export interface LauncherFigure {
  text: string;
  /** Carries the error hue (and, with `open`, filters to it). */
  errored?: boolean;
  open?: () => void;
}

/** One domain's block. */
export interface LauncherTile {
  /** Stable identity, and the gutter number it answers to. */
  key: string;
  name: string;
  /** The palette token the block is painted in, e.g. `--harvestgold`. */
  hue: string;
  /** The keyboard numeral that presses it. */
  numeral: string;
  figures: ReadonlyArray<LauncherFigure>;
  rows: ReadonlyArray<LauncherRow>;
  /** What the block's own press does, read as the verb it is. */
  verb: string;
  enter: () => void;
}

/** What the launcher asks of the surface. */
export interface LauncherHost {
  /** The tiles to paint, in reading order; the first is the wide block. */
  tiles: () => Promise<ReadonlyArray<LauncherTile>>;
  /** Whether a session starts here, and setting it. */
  startHere_get: () => boolean;
  startHere_set: (on: boolean) => void;
}

/** The launcher pane. */
export class LauncherPanel {
  private readonly grid: HTMLElement;
  private readonly startHere: HTMLButtonElement;
  private readonly host: LauncherHost;
  /** Painting is asynchronous; a later paint must not be overtaken by an earlier. */
  private paintId: number = 0;

  /**
   * @param mount - The pane root, stamped from `tpl-pane-launcher`.
   * @param host - The surface's answers.
   */
  constructor(mount: HTMLElement, host: LauncherHost) {
    this.host = host;
    this.grid = mount.querySelector<HTMLElement>('.launcher-grid') as HTMLElement;
    this.startHere = mount.querySelector<HTMLButtonElement>('.launcher-start') as HTMLButtonElement;
    this.startHere.addEventListener('click', (): void => {
      this.host.startHere_set(!this.host.startHere_get());
      this.startHere_render();
    });
    this.startHere_render();
  }

  /** Repaints from the surface's current facts. */
  public render(): void {
    const id: number = ++this.paintId;
    void this.host.tiles()
      .then((tiles: ReadonlyArray<LauncherTile>): void => {
        if (id !== this.paintId || !this.grid.isConnected) return;
        this.grid.replaceChildren(...tiles.map((tile: LauncherTile, index: number): HTMLElement =>
          this.tile_build(tile, index === 0)));
        this.startHere_render();
      })
      .catch((): void => {
        // A session that cannot answer yet is not a reason to show nothing:
        // the blocks still say what they are and still open their domains.
        if (id !== this.paintId || !this.grid.isConnected) return;
        this.grid.replaceChildren();
      });
  }

  /** Presses the tile a numeral names, for the keyboard. */
  public numeral_press(numeral: string): boolean {
    const tile: HTMLElement | null = this.grid.querySelector<HTMLElement>(`[data-numeral="${numeral}"]`);
    if (tile === null) return false;
    tile.click();
    return true;
  }

  /** The START HERE capsule reads its own state, as every mode control does. */
  private startHere_render(): void {
    const on: boolean = this.host.startHere_get();
    this.startHere.textContent = on ? 'START HERE · ON' : 'START HERE · OFF';
    this.startHere.classList.toggle('pacs-capsule-off', !on);
  }

  /**
   * One block: its name and figures on a bar, its rows beneath, the verb at
   * its foot. The first block is wide, because the domain with the most to
   * say should say it.
   *
   * @param tile - The domain's facts.
   * @param wide - Whether this block takes two columns.
   * @returns The block.
   */
  private tile_build(tile: LauncherTile, wide: boolean): HTMLElement {
    const block: HTMLButtonElement = document.createElement('button');
    block.className = `launcher-tile${wide ? ' launcher-tile-wide' : ''}`;
    block.style.setProperty('--tile-hue', `var(${tile.hue})`);
    block.dataset['numeral'] = tile.numeral;
    block.title = tile.verb;
    block.addEventListener('click', (event: Event): void => {
      // A press inside a row or a figure is that row's, not the block's.
      if (event.target instanceof Element && event.target.closest('.launcher-row, .launcher-figure') !== null) return;
      tile.enter();
    });

    const head: HTMLElement = document.createElement('span');
    head.className = 'launcher-head';
    const name: HTMLElement = document.createElement('span');
    name.className = 'launcher-name';
    name.textContent = tile.name;
    const numeral: HTMLElement = document.createElement('span');
    numeral.className = 'launcher-numeral';
    numeral.textContent = tile.numeral;
    head.append(name);
    for (const figure of tile.figures) {
      const chip: HTMLElement = document.createElement(figure.open === undefined ? 'span' : 'button');
      chip.className = `launcher-figure${figure.errored === true ? ' launcher-figure-errored' : ''}`;
      chip.textContent = figure.text;
      if (figure.open !== undefined) {
        const open: () => void = figure.open;
        chip.addEventListener('click', (event: Event): void => { event.stopPropagation(); open(); });
      }
      head.appendChild(chip);
    }
    head.appendChild(numeral);

    const rule: HTMLElement = document.createElement('span');
    rule.className = 'launcher-rule';

    const rows: HTMLElement = document.createElement('span');
    rows.className = 'launcher-rows';
    for (const row of tile.rows) {
      const element: HTMLElement = document.createElement(row.open === undefined ? 'span' : 'button');
      element.className = `launcher-row${row.arrived === true ? ' launcher-row-arrived' : ''}`;
      const dot: HTMLElement = document.createElement('span');
      dot.className = `launcher-dot${row.errored === true ? ' launcher-dot-errored' : ''}`;
      const text: HTMLElement = document.createElement('span');
      text.className = 'launcher-row-text';
      text.textContent = row.text;
      element.append(dot, text);
      if (row.open !== undefined) {
        const open: () => void = row.open;
        const go: HTMLElement = document.createElement('span');
        go.className = 'launcher-go';
        go.textContent = '›';
        element.appendChild(go);
        element.addEventListener('click', (event: Event): void => { event.stopPropagation(); open(); });
      }
      rows.appendChild(element);
    }

    const verb: HTMLElement = document.createElement('span');
    verb.className = 'launcher-verb';
    verb.textContent = tile.verb;

    block.append(head, rule, rows, verb);
    return block;
  }
}
