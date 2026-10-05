/**
 * @file The GAMES pane: a canvas the showpieces and the arcade run on.
 *
 * The kernel's `sl`, `cmatrix`, `rain`, `asciiquarium`, `tetris` and
 * `snake` answer a `games.show` model naming a program; this pane runs it.
 * The pane owns the canvas (a cell grid of monospace glyphs, lit in the
 * theme's hues), the clock (one `step` per tick, one `draw` per frame, the
 * clock stopped while the pane is hidden or paused) and the keyboard (the
 * field takes it when a game starts or is clicked, Esc gives it back —
 * focus-stays-in-the-field, as the image pane). A program owns its state
 * and its picture only (`program.ts`).
 *
 * @module
 */
import type { GameProgram, Grid, Palette, ProgramName } from './program.js';
import { sl_make, cmatrix_make, rain_make, aquarium_make } from './shows.js';
import { tetris_make, snake_make } from './arcade.js';

/** The factories by the kernel's program name. */
export const PROGRAMS: Record<ProgramName, () => GameProgram> = {
  sl: sl_make,
  cmatrix: cmatrix_make,
  rain: rain_make,
  aquarium: aquarium_make,
  tetris: tetris_make,
  snake: snake_make,
};

/** Whether a word names a program. */
export function program_isName(word: string): word is ProgramName {
  return word in PROGRAMS;
}

/** The glyph cell's bounds, in pixels; the cell itself is sized to the field. */
const CELL_MIN: number = 8;
const CELL_MAX: number = 26;
/** A cell is this much taller than wide (a monospace glyph's shape). */
const CELL_ASPECT: number = 1.8;
/** The field is sized for about this many columns, and at least this many rows. */
const COLS_WANTED: number = 100;
const ROWS_LEAST: number = 24;

/** The glyph cell for a field: about a hundred columns across, never fewer rows than the arcade needs, within a legible range. */
export function cell_of(width: number, height: number): { w: number; h: number } {
  let w: number = Math.floor(width / COLS_WANTED);
  if (height / (w * CELL_ASPECT) < ROWS_LEAST) w = Math.floor(height / ROWS_LEAST / CELL_ASPECT);
  w = Math.max(CELL_MIN, Math.min(CELL_MAX, w));
  return { w, h: Math.round(w * CELL_ASPECT) };
}

/** The GAMES pane's controller. */
export class GamesPanel {
  private readonly pane: HTMLElement;
  private readonly field: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly state: HTMLElement | null;
  private readonly focusMark: HTMLElement;
  private readonly pausePill: HTMLElement;
  private program: GameProgram | null = null;
  private name: ProgramName | null = null;
  private paused: boolean = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private frame: number | null = null;
  private readonly observer: ResizeObserver | null;

  /**
   * @param mount - The stamped pane element (`tpl-pane-games`).
   */
  constructor(mount: HTMLElement) {
    this.pane = mount;
    this.field = element_find(mount, '.games-field');
    this.canvas = element_find(mount, '.games-canvas') as HTMLCanvasElement;
    this.state = mount.querySelector<HTMLElement>('.pane-state');
    this.focusMark = element_find(mount, '.games-focus');
    this.pausePill = element_find(mount, '.games-pause');
    this.field.tabIndex = 0;
    this.pausePill.addEventListener('click', (): void => this.pause_toggle());
    element_find(mount, '.games-restart').addEventListener('click', (): void => { if (this.name !== null) this.program_run(this.name); });
    this.field.addEventListener('mousedown', (): void => { this.field.focus(); this.focusMark_paint(true); });
    this.field.addEventListener('focusin', (): void => this.focusMark_paint(true));
    this.field.addEventListener('focusout', (event: FocusEvent): void => {
      if (!(event.relatedTarget instanceof Node) || !this.field.contains(event.relatedTarget)) this.focusMark_paint(false);
    });
    this.field.addEventListener('keydown', (event: KeyboardEvent): void => this.key_handle(event));
    this.observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver((): void => this.draw());
    this.observer?.observe(this.field);
  }

  /** Starts a program over (or a new one); a game takes the keyboard. */
  public program_run(name: ProgramName): void {
    this.name = name;
    this.program = PROGRAMS[name]();
    this.paused = false;
    this.pausePill.textContent = 'PAUSE';
    this.clock_start();
    if (this.program.key !== undefined) { this.field.focus(); this.focusMark_paint(true); }
    this.draw();
  }

  /** The program on the canvas, by name. */
  public program_name(): ProgramName | null {
    return this.name;
  }

  /** Whether the clock is stopped by the operator. */
  public paused_is(): boolean {
    return this.paused;
  }

  /** Pauses or resumes the clock. */
  public pause_toggle(): void {
    if (this.program === null) return;
    this.paused = !this.paused;
    this.pausePill.textContent = this.paused ? 'RESUME' : 'PAUSE';
    if (this.paused) this.clock_stop(); else this.clock_start();
    this.state_paint();
  }

  /** Whether the field holds the keyboard. */
  public field_hasFocus(): boolean {
    return document.activeElement instanceof Node && this.field.contains(document.activeElement);
  }

  /** Gives the keyboard back. */
  public field_release(): boolean {
    if (!this.field_hasFocus()) return false;
    (document.activeElement as HTMLElement).blur();
    this.focusMark_paint(false);
    return true;
  }

  /** Stops the clock and lets the canvas go. */
  public dispose(): void {
    this.clock_stop();
    this.observer?.disconnect();
  }

  private key_handle(event: KeyboardEvent): void {
    if (event.key === 'Escape') { this.field_release(); event.stopPropagation(); return; }
    if (this.program === null) return;
    if (event.key === ' ' && this.program.key === undefined) { this.pause_toggle(); event.preventDefault(); event.stopPropagation(); return; }
    if (this.program.key?.(event.key) === true) { event.preventDefault(); this.draw(); }
    event.stopPropagation();
  }

  private clock_start(): void {
    this.clock_stop();
    const program: GameProgram | null = this.program;
    if (program === null) return;
    this.timer = setInterval((): void => {
      if (this.field.offsetParent === null) return;
      program.step(this.size_of(), Math.random);
      this.draw();
      if (program.over?.() === true) this.clock_stop();
    }, program.tick);
  }

  private clock_stop(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  private size_of(): { cols: number; rows: number } {
    const rect: DOMRect = this.field.getBoundingClientRect();
    const cell = cell_of(rect.width, rect.height);
    return { cols: Math.max(10, Math.floor(rect.width / cell.w)), rows: Math.max(6, Math.floor(rect.height / cell.h)) };
  }

  private palette_read(): Palette {
    const style: CSSStyleDeclaration = getComputedStyle(this.pane);
    const read = (name: string, fallback: string): string => style.getPropertyValue(name).trim() || fallback;
    return { lit: read('--harvestgold', '#ffcc66'), dim: read('--butter', '#ffff99'), warn: read('--tomato', '#ff7766'), cool: read('--daybreak', '#55aaff') };
  }

  /** Paints the current state; one frame per animation tick at most. */
  private draw(): void {
    if (this.frame !== null) return;
    this.frame = requestAnimationFrame((): void => { this.frame = null; this.paint(); });
  }

  private paint(): void {
    const program: GameProgram | null = this.program;
    const context: CanvasRenderingContext2D | null = this.canvas.getContext('2d');
    if (program === null || context === null) return;
    const rect: DOMRect = this.field.getBoundingClientRect();
    const scale: number = window.devicePixelRatio || 1;
    if (this.canvas.width !== Math.floor(rect.width * scale) || this.canvas.height !== Math.floor(rect.height * scale)) {
      this.canvas.width = Math.floor(rect.width * scale);
      this.canvas.height = Math.floor(rect.height * scale);
    }
    context.setTransform(scale, 0, 0, scale, 0, 0);
    context.clearRect(0, 0, rect.width, rect.height);
    const cell = cell_of(rect.width, rect.height);
    context.font = `${cell.h - 2}px 'Share Tech Mono', monospace`;
    context.textBaseline = 'top';
    const size = this.size_of();
    const put = (col: number, row: number, glyph: string, hue: string): void => {
      if (col < 0 || row < 0 || col >= size.cols || row >= size.rows) return;
      context.fillStyle = hue;
      context.fillText(glyph, col * cell.w, row * cell.h);
    };
    const grid: Grid = {
      cols: size.cols,
      rows: size.rows,
      put,
      text: (col: number, row: number, words: string, hue: string): void => { [...words].forEach((glyph: string, i: number): void => { if (glyph !== ' ') put(col + i, row, glyph, hue); }); },
    };
    program.draw(grid, this.palette_read());
    this.state_paint();
  }

  private state_paint(): void {
    if (this.state === null || this.program === null) return;
    const status: string = this.program.status?.() ?? '';
    this.state.textContent = [this.program.title, status, this.paused ? 'PAUSED' : ''].filter((s: string): boolean => s !== '').join(' · ');
  }

  private focusMark_paint(on: boolean): void {
    this.focusMark.hidden = !on;
    this.pane.classList.toggle('games-field-focused', on);
  }
}

function element_find(mount: HTMLElement, selector: string): HTMLElement {
  const found: HTMLElement | null = mount.querySelector<HTMLElement>(selector);
  if (found === null) throw new Error(`games pane: missing ${selector}`);
  return found;
}
