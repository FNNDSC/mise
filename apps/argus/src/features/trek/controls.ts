/**
 * @file The bridge's controls: a course wheel, a value slider, a row of
 * pills. Each answers one of the engine's questions and is lit only while
 * that question is open; dimmed, it is a readout. Shared by the BRIDGE view
 * and the station views, which draw the same controls at their own sizes.
 *
 * @module
 */
import { mark_use, svg } from './marks.js';
import type { QuestionControl } from './model.js';

export { svg };

/**
 * Makes an element with a class and optional text.
 *
 * @param tag - The tag.
 * @param className - Its classes.
 * @param text - Its text, when it has some.
 * @returns The element.
 */
export function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node: HTMLElementTagNameMap[K] = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * Makes a pill button.
 *
 * @param className - Its classes, after `tb-pill`.
 * @param label - Its word.
 * @param onPress - What pressing it does.
 * @returns The button.
 */
export function pill_make(className: string, label: string, onPress: () => void): HTMLButtonElement {
  const button: HTMLButtonElement = el('button', `tb-pill ${className}`, label);
  button.type = 'button';
  button.addEventListener('click', onPress);
  return button;
}

/** A mark on a wheel's rim: what is out there, at its bearing. */
export interface WheelMark {
  /** The bearing, in the C's degrees. */
  bearing: number;
  /** What it is. */
  kind: 'klingon' | 'base';
  /** Its title. */
  label: string;
  /** A Klingon's own mark, when it has one. */
  variant?: string | null;
}

/** The side of a wheel's rim mark, in CSS pixels. */
const WHEEL_MARK_SIZE: number = 16;

/** A course wheel: a needle the operator drags, marks for what is out there, a burst wedge, and a commit pill. */
export class CourseWheel {
  public readonly root: HTMLElement;
  private readonly needle: SVGElement;
  private readonly marks: SVGElement;
  private readonly wedge: SVGElement;
  private readonly readout: HTMLElement;
  private readonly commit: HTMLButtonElement;
  private degrees: number = 0;
  private wedgeHalf: number | null = null;
  private readonly size: number;

  /**
   * Builds a wheel.
   *
   * @param size - Its width and height in CSS pixels.
   * @param label - Its accessible name.
   * @param onCommit - Called with the course when the commit pill is pressed.
   */
  constructor(size: number, label: string, private readonly onCommit: (degrees: number) => void) {
    this.size = size;
    const r: number = size / 2;
    this.root = el('div', 'tb-wheel');
    const picture: SVGElement = svg('svg', { width: size, height: size, viewBox: `0 0 ${size} ${size}`, role: 'img', 'aria-label': label });
    picture.classList.add('tb-wheel-face');
    picture.append(svg('circle', { cx: r, cy: r, r: r - 4, class: 'tb-wheel-rim' }));
    picture.append(svg('circle', { cx: r, cy: r, r: (r - 4) * 0.66, class: 'tb-wheel-ring' }));
    picture.append(svg('circle', { cx: r, cy: r, r: (r - 4) * 0.33, class: 'tb-wheel-ring' }));
    for (let i: number = 0; i < 36; i++) {
      const a: number = (i * Math.PI) / 18;
      const major: boolean = i % 3 === 0;
      const r1: number = r - 4 - (major ? 12 : 7);
      picture.append(svg('line', { x1: r + r1 * Math.sin(a), y1: r - r1 * Math.cos(a), x2: r + (r - 4) * Math.sin(a), y2: r - (r - 4) * Math.cos(a), class: major ? 'tb-wheel-tick-major' : 'tb-wheel-tick' }));
    }
    for (const d of [0, 90, 180, 270]) {
      const a: number = (d * Math.PI) / 180;
      const text: SVGElement = svg('text', { x: r + (r - 26) * Math.sin(a), y: r - (r - 26) * Math.cos(a) + 4, 'text-anchor': 'middle', class: 'tb-wheel-label' });
      text.textContent = String(d);
      picture.append(text);
    }
    this.wedge = svg('path', { d: '', class: 'tb-wheel-wedge' });
    picture.append(this.wedge);
    this.marks = svg('g', { class: 'tb-wheel-marks' });
    picture.append(this.marks);
    this.needle = svg('line', { x1: r, y1: r, x2: r, y2: 14, class: 'tb-wheel-needle' });
    picture.append(this.needle);
    picture.append(svg('circle', { cx: r, cy: r, r: 6, class: 'tb-wheel-hub' }));
    this.root.append(picture);
    const row: HTMLElement = el('div', 'tb-wheel-row');
    this.readout = el('span', 'tb-wheel-readout', '0°');
    this.commit = pill_make('tb-commit', 'SET COURSE', (): void => this.onCommit(Math.round(this.degrees)));
    row.append(this.readout, this.commit);
    this.root.append(row);
    const drag = (event: PointerEvent): void => {
      const box: DOMRect = picture.getBoundingClientRect();
      const x: number = event.clientX - box.left - box.width / 2;
      const y: number = event.clientY - box.top - box.height / 2;
      this.degrees_set(((Math.atan2(x, -y) * 180) / Math.PI + 360) % 360);
    };
    picture.addEventListener('pointerdown', (event: PointerEvent): void => { picture.setPointerCapture(event.pointerId); drag(event); });
    picture.addEventListener('pointermove', (event: PointerEvent): void => { if (event.buttons !== 0) drag(event); });
  }

  /**
   * Points the needle.
   *
   * @param degrees - The course.
   */
  public degrees_set(degrees: number): void {
    this.degrees = degrees;
    const r: number = this.size / 2;
    const a: number = (degrees * Math.PI) / 180;
    this.needle.setAttribute('x2', String(r + (r - 14) * Math.sin(a)));
    this.needle.setAttribute('y2', String(r - (r - 14) * Math.cos(a)));
    this.readout.textContent = `${Math.round(degrees)}°`;
    this.wedge_draw();
  }

  /**
   * The course as pointed.
   *
   * @returns Degrees, 0 up to 360.
   */
  public degrees_get(): number {
    return this.degrees;
  }

  /**
   * Draws the burst as a wedge about the needle, or none.
   *
   * @param halfAngle - Half the burst angle in degrees; null for no wedge.
   */
  public wedge_set(halfAngle: number | null): void {
    this.wedgeHalf = halfAngle;
    this.wedge_draw();
  }

  private wedge_draw(): void {
    if (this.wedgeHalf === null) { this.wedge.setAttribute('d', ''); return; }
    const r: number = this.size / 2;
    const rr: number = r - 14;
    const a1: number = ((this.degrees - this.wedgeHalf) * Math.PI) / 180;
    const a2: number = ((this.degrees + this.wedgeHalf) * Math.PI) / 180;
    const x1: number = r + rr * Math.sin(a1);
    const y1: number = r - rr * Math.cos(a1);
    const x2: number = r + rr * Math.sin(a2);
    const y2: number = r - rr * Math.cos(a2);
    this.wedge.setAttribute('d', `M ${r} ${r} L ${x1} ${y1} A ${rr} ${rr} 0 0 1 ${x2} ${y2} Z`);
  }

  /**
   * Marks bearings on the rim with the same marks the scan draws: a Klingon's own mark, turned to face the hub; a starbase.
   *
   * @param marks - Each bearing with its kind and label.
   */
  public marks_set(marks: ReadonlyArray<WheelMark>): void {
    this.marks.replaceChildren();
    const r: number = this.size / 2;
    for (const mark of marks) {
      const a: number = (mark.bearing * Math.PI) / 180;
      const rr: number = (r - 4) * 0.8;
      const cx: number = r + rr * Math.sin(a);
      const cy: number = r - rr * Math.cos(a);
      const use: SVGElement = mark_use(mark.kind, { x: cx - WHEEL_MARK_SIZE / 2, y: cy - WHEEL_MARK_SIZE / 2, size: WHEEL_MARK_SIZE }, mark.variant ?? null);
      use.classList.add('tb-wheel-mark', `tb-wheel-mark-${mark.kind}`);
      // a Klingon on the rim faces the ship at the hub: its nose turns through the bearing plus a half turn
      if (mark.kind === 'klingon') use.setAttribute('transform', `rotate(${mark.bearing + 180} ${cx} ${cy})`);
      const title: SVGElement = svg('title', {});
      title.textContent = mark.label;
      use.append(title);
      this.marks.append(use);
    }
  }

  /**
   * Lights or dims the wheel; only a lit wheel commits.
   *
   * @param lit - Whether its question is open.
   * @param commit - The commit pill's word.
   */
  public lit_set(lit: boolean, commit: string = 'SET COURSE'): void {
    this.root.classList.toggle('tb-lit', lit);
    this.commit.disabled = !lit;
    this.commit.textContent = commit;
  }
}

/** A slider for one continuous value, with its ticks, readout and commit pill. */
export class ValueSlider {
  public readonly root: HTMLElement;
  private readonly input: HTMLInputElement;
  private readonly shown: HTMLElement;
  private readonly commit: HTMLButtonElement;
  private readonly note: HTMLElement;
  private readonly ticks: HTMLElement;
  private onInput: ((value: number) => void) | null = null;

  /**
   * Builds a slider.
   *
   * @param id - The input's id.
   * @param label - The pill label beside it.
   * @param digits - How many decimals the readout shows.
   * @param onCommit - Called with the value when the commit pill is pressed.
   */
  constructor(id: string, label: string, private readonly digits: number, private readonly onCommit: (value: number) => void) {
    this.root = el('div', 'tb-slider');
    const name: HTMLLabelElement = el('label', 'tb-slider-label', label);
    name.htmlFor = id;
    this.input = document.createElement('input');
    this.input.type = 'range';
    this.input.id = id;
    this.input.className = 'tb-slider-input';
    this.input.addEventListener('input', (): void => { this.shown_refresh(); this.onInput?.(this.value_get()); });
    const column: HTMLElement = el('div', 'tb-slider-column');
    this.ticks = el('div', 'tb-slider-ticks');
    this.note = el('span', 'tb-slider-note');
    column.append(this.input, this.ticks, this.note);
    this.shown = el('span', 'tb-slider-readout', '—');
    this.commit = pill_make('tb-commit', 'SET', (): void => this.onCommit(this.value_get()));
    this.root.append(name, column, this.shown, this.commit);
  }

  /**
   * Sets the range and the value; the ticks follow the range.
   *
   * @param control - The question's control.
   * @param value - The value to show.
   * @param note - A word under the track.
   * @param tickCount - How many tick labels to draw, counting both ends; 0 for none.
   */
  public range_set(control: QuestionControl, value: number, note: string, tickCount: number = 0): void {
    const min: number = control.min ?? 0;
    const max: number = control.max ?? 1;
    this.input.min = String(min);
    this.input.max = String(max);
    this.input.step = String(control.step ?? 1);
    this.input.value = String(Math.min(max, Math.max(min, value)));
    this.note.textContent = note;
    this.ticks.replaceChildren();
    for (let i: number = 0; i < tickCount; i++) {
      const at: number = min + ((max - min) * i) / Math.max(1, tickCount - 1);
      this.ticks.append(el('span', 'tb-slider-tick', Number.isInteger(at) ? String(at) : at.toFixed(1)));
    }
    this.shown_refresh();
  }

  /**
   * Listens for the value moving under the operator's hand.
   *
   * @param onInput - Called with each value as the slider moves.
   */
  public input_listen(onInput: (value: number) => void): void {
    this.onInput = onInput;
  }

  /**
   * Changes the word under the track.
   *
   * @param note - The word.
   */
  public note_set(note: string): void {
    this.note.textContent = note;
  }

  /**
   * The value as set.
   *
   * @returns The number.
   */
  public value_get(): number {
    return Number(this.input.value);
  }

  /**
   * Sets the value.
   *
   * @param value - The value.
   */
  public value_set(value: number): void {
    this.input.value = String(value);
    this.shown_refresh();
  }

  /**
   * Lights or dims the slider; only a lit slider commits.
   *
   * @param lit - Whether its question is open.
   * @param commit - The commit pill's word.
   */
  public lit_set(lit: boolean, commit: string = 'SET'): void {
    this.root.classList.toggle('tb-lit', lit);
    this.input.disabled = !lit;
    this.commit.disabled = !lit;
    this.commit.textContent = commit;
  }

  /**
   * Whether the slider is lit.
   *
   * @returns True while its question is open.
   */
  public lit_is(): boolean {
    return this.root.classList.contains('tb-lit');
  }

  private shown_refresh(): void {
    this.shown.textContent = this.value_get().toFixed(this.digits);
  }
}

/** A row of pills, one answer each. */
export class PillRow {
  public readonly root: HTMLElement;
  private readonly buttons: HTMLButtonElement[] = [];
  private readonly note: HTMLElement;

  /**
   * Builds the row.
   *
   * @param label - The pill label beside it, empty for none.
   * @param choices - What each pill says and sends.
   * @param onPress - Called with the line and the pill's label when a pill is pressed.
   */
  constructor(label: string, choices: ReadonlyArray<{ label: string; line: string }>, onPress: (line: string, label: string) => void) {
    this.root = el('div', 'tb-pillrow');
    if (label !== '') this.root.append(el('span', 'tb-slider-label', label));
    const column: HTMLElement = el('div', 'tb-slider-column');
    const pills: HTMLElement = el('div', 'tb-pills');
    for (const choice of choices) {
      const button: HTMLButtonElement = pill_make('tb-choice', choice.label, (): void => onPress(choice.line, choice.label));
      button.dataset['line'] = choice.line;
      this.buttons.push(button);
      pills.append(button);
    }
    this.note = el('span', 'tb-slider-note', '');
    column.append(pills, this.note);
    this.root.append(column);
  }

  /**
   * Changes the word under the pills.
   *
   * @param note - The word.
   */
  public note_set(note: string): void {
    this.note.textContent = note;
  }

  /**
   * Lights or dims the row.
   *
   * @param lit - Whether its question is open.
   */
  public lit_set(lit: boolean): void {
    this.root.classList.toggle('tb-lit', lit);
    for (const button of this.buttons) button.disabled = !lit;
  }
}
