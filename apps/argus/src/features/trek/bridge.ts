/**
 * @file The bridge: the screen trek takes over, drawn from the state the
 * engine shows and answering the engine through the harness.
 *
 * One view in this slice, BRIDGE: the header of ship state, the gutter of
 * views, the long-range scan and galaxy chart with engineering beneath, the
 * short-range scan with the ship's commands, HELM over TACTICAL with their
 * own commands and controls, the strip for the questions the engine asks
 * on its own, and the ship's log. Every control answers one of the engine's
 * questions and is lit only while that question is open; a dimmed control
 * is a readout. Nobody types: the log is read-only.
 *
 * The bridge draws its own LCARS frame (two elbows) because the takeover
 * removes ARGUS's. Colours come from the theme's palette tokens.
 *
 * @module
 */
import type { TrekState, XY } from 'bsd-trek/host';
import { TrekHarness, type OpenQuestion } from './harness.js';
import {
  BRIDGE_COMMANDS, bearing_of, question_control, range_of, readout_build, readout_diff,
  type BridgeCommand, type BridgeReadout, type ChartCell, type DeviceState, type KlingonSeen, type QuestionControl, type SectorCell, type Station, type TrekQuestion,
} from './model.js';

/** The views the gutter offers; only BRIDGE is drawn in this slice. */
export type BridgeView = 'bridge' | 'helm' | 'tactical' | 'engineering' | 'computer';

/** What the bridge needs from its host. */
export interface BridgeHooks {
  /** Plays a sound by the host's name for it. */
  sound: (name: string) => void;
  /** The operator asked to leave: the host ends the game. */
  leave: () => void;
}

/** The live elements, as they are registered while the screen is built. */
type BridgeParts = Partial<TrekBridge['parts']>;

/** The glyphs the scan draws, by kind. */
const SECTOR_GLYPHS: Readonly<Record<SectorCell['kind'], string>> = { ship: 'E', klingon: 'K', base: '#', star: '*', inhabited: '@', hole: ' ', empty: '·' };

/** How many log lines are kept. */
const LOG_LIMIT: number = 400;

/**
 * Makes an element with a class and optional text.
 *
 * @param tag - The tag.
 * @param className - Its classes.
 * @param text - Its text, when it has some.
 * @returns The element.
 */
function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node: HTMLElementTagNameMap[K] = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * Makes an SVG element.
 *
 * @param tag - The SVG tag.
 * @param attributes - Its attributes.
 * @returns The element.
 */
function svg(tag: string, attributes: Record<string, string | number>): SVGElement {
  const node: SVGElement = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
  return node;
}

/** A course wheel: a needle the operator drags, marks for what is out there, and a commit pill. */
class CourseWheel {
  public readonly root: HTMLElement;
  private readonly needle: SVGElement;
  private readonly marks: SVGElement;
  private readonly readout: HTMLElement;
  private readonly commit: HTMLButtonElement;
  private degrees: number = 0;
  private readonly size: number;

  /**
   * Builds a wheel.
   *
   * @param size - Its width and height in CSS pixels.
   * @param label - Its accessible name.
   * @param onCommit - Called with the course when SET COURSE is pressed.
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
    this.marks = svg('g', { class: 'tb-wheel-marks' });
    picture.append(this.marks);
    this.needle = svg('line', { x1: r, y1: r, x2: r, y2: 14, class: 'tb-wheel-needle' });
    picture.append(this.needle);
    picture.append(svg('circle', { cx: r, cy: r, r: 6, class: 'tb-wheel-hub' }));
    this.root.append(picture);
    const row: HTMLElement = el('div', 'tb-wheel-row');
    this.readout = el('span', 'tb-wheel-readout', '0°');
    this.commit = el('button', 'tb-pill tb-commit', 'SET COURSE');
    this.commit.type = 'button';
    this.commit.addEventListener('click', (): void => this.onCommit(Math.round(this.degrees)));
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
  }

  /**
   * Marks bearings on the rim: Klingons, a starbase.
   *
   * @param marks - Each bearing with its class and label.
   */
  public marks_set(marks: ReadonlyArray<{ bearing: number; kind: 'klingon' | 'base'; label: string }>): void {
    this.marks.replaceChildren();
    const r: number = this.size / 2;
    for (const mark of marks) {
      const a: number = (mark.bearing * Math.PI) / 180;
      const rr: number = (r - 4) * 0.8;
      const dot: SVGElement = svg('circle', { cx: r + rr * Math.sin(a), cy: r - rr * Math.cos(a), r: 6, class: `tb-wheel-mark tb-wheel-mark-${mark.kind}` });
      const title: SVGElement = svg('title', {});
      title.textContent = mark.label;
      dot.append(title);
      this.marks.append(dot);
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

/** A slider for one continuous value, with its readout and commit pill. */
class ValueSlider {
  public readonly root: HTMLElement;
  private readonly input: HTMLInputElement;
  private readonly shown: HTMLElement;
  private readonly commit: HTMLButtonElement;
  private readonly note: HTMLElement;

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
    this.input.addEventListener('input', (): void => this.shown_refresh());
    const column: HTMLElement = el('div', 'tb-slider-column');
    this.note = el('span', 'tb-slider-note');
    column.append(this.input, this.note);
    this.shown = el('span', 'tb-slider-readout', '—');
    this.commit = el('button', 'tb-pill tb-commit', 'SET');
    this.commit.type = 'button';
    this.commit.addEventListener('click', (): void => this.onCommit(this.value_get()));
    this.root.append(name, column, this.shown, this.commit);
  }

  /**
   * Sets the range and the value.
   *
   * @param control - The question's control.
   * @param value - The value to show.
   * @param note - A word under the track.
   */
  public range_set(control: QuestionControl, value: number, note: string): void {
    this.input.min = String(control.min ?? 0);
    this.input.max = String(control.max ?? 1);
    this.input.step = String(control.step ?? 1);
    this.input.value = String(Math.min(control.max ?? value, Math.max(control.min ?? value, value)));
    this.note.textContent = note;
    this.shown_refresh();
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

  private shown_refresh(): void {
    this.shown.textContent = this.value_get().toFixed(this.digits);
  }
}

/** A row of pills, one answer each. */
class PillRow {
  public readonly root: HTMLElement;
  private readonly buttons: HTMLButtonElement[] = [];

  /**
   * Builds the row.
   *
   * @param label - The pill label beside it, empty for none.
   * @param choices - What each pill says and sends.
   * @param onPress - Called with the line when a pill is pressed.
   */
  constructor(label: string, choices: ReadonlyArray<{ label: string; line: string }>, onPress: (line: string) => void) {
    this.root = el('div', 'tb-pillrow');
    if (label !== '') this.root.append(el('span', 'tb-slider-label', label));
    const pills: HTMLElement = el('div', 'tb-pills');
    for (const choice of choices) {
      const button: HTMLButtonElement = el('button', 'tb-pill tb-choice', choice.label);
      button.type = 'button';
      button.dataset['line'] = choice.line;
      button.addEventListener('click', (): void => onPress(choice.line));
      this.buttons.push(button);
      pills.append(button);
    }
    this.root.append(pills);
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

/**
 * The bridge over a game.
 */
export class TrekBridge {
  /** The screen's root, appended to the body by the host and shown while a game runs. */
  public readonly root: HTMLElement;
  private readonly harness: TrekHarness;
  private readout: BridgeReadout | null = null;
  private previous: BridgeReadout | null = null;
  private view: BridgeView = 'bridge';
  private nextDistance: number | null = null;
  private readonly parts: {
    seed: HTMLElement; views: Map<BridgeView, HTMLButtonElement>;
    condition: HTMLElement; conditionWhy: HTMLElement; ship: HTMLElement; mission: HTMLElement; position: HTMLElement; since: HTMLElement;
    lrs: HTMLElement; chart: HTMLElement; engineering: HTMLElement; srs: HTMLElement; srsTitle: HTMLElement;
    commandPills: Map<string, HTMLButtonElement>; stationHeads: Map<Station, HTMLElement>;
    helmWheel: CourseWheel; distance: ValueSlider; warp: ValueSlider; rest: ValueSlider;
    tacticalWheel: CourseWheel; manual: PillRow; units: ValueSlider; spread: ValueSlider; burstAngle: PillRow; upDown: PillRow;
    ask: HTMLElement; askText: HTMLElement; askPills: HTMLElement; askInput: HTMLInputElement; askSend: HTMLButtonElement;
    log: HTMLElement; leaveAsk: HTMLElement; targets: HTMLElement;
  };

  /**
   * Builds the bridge.
   *
   * @param hooks - The host's sound and leave.
   * @param seed - The game's seed, named on the block; null for a random game.
   */
  constructor(private readonly hooks: BridgeHooks, seed: number | null) {
    this.harness = new TrekHarness({
      question_changed: (open: OpenQuestion | null): void => this.question_show(open),
      text_written: (text: string): void => this.log_write(text),
      state_shown: (state: TrekState): void => this.state_show(state),
      ended: (): void => undefined,
    });
    this.root = el('section', 'trek-bridge');
    this.root.id = 'trek-bridge';
    this.root.dataset['view'] = 'bridge';
    this.root.setAttribute('aria-label', 'trek: the bridge');
    const parts: BridgeParts = {};
    const gutter: HTMLElement = this.gutter_build(parts, seed);
    const [barTop, barBody] = this.frame_build(parts);
    const header: HTMLElement = this.header_build(parts);
    const body: HTMLElement = this.body_build(parts);
    this.strip_build(parts);
    const footer: HTMLElement = this.log_build(parts);
    this.leaveAsk_build(parts);
    this.root.append(gutter, barTop, header, barBody, body, parts.ask as HTMLElement, footer, parts.leaveAsk as HTMLElement);
    this.parts = parts as TrekBridge['parts'];
    this.question_show(null);
  }

  /**
   * Builds the gutter: the block, the seed, the views, LEAVE BRIDGE.
   *
   * @param parts - Where the live elements are registered.
   * @returns The gutter.
   */
  private gutter_build(parts: BridgeParts, seed: number | null): HTMLElement {
    // the gutter: the block, the views, LEAVE BRIDGE
    const gutter: HTMLElement = el('aside', 'tb-gutter');
    const block: HTMLElement = el('div', 'tb-block');
    block.append(el('span', 'tb-block-name', 'TREK'), el('span', 'tb-block-sub', 'ARGUS · BSD TREK'));
    parts.seed = el('div', 'tb-seed', seed === null ? 'RANDOM GALAXY' : `SEED ${seed}`);
    const views: HTMLElement = el('nav', 'tb-views');
    views.setAttribute('aria-label', 'views');
    parts.views = new Map<BridgeView, HTMLButtonElement>();
    for (const view of ['bridge', 'helm', 'tactical', 'engineering', 'computer'] as const) {
      const button: HTMLButtonElement = el('button', `tb-view tb-view-${view}`, view.toUpperCase());
      button.type = 'button';
      button.dataset['view'] = view;
      button.addEventListener('click', (): void => this.view_set(view));
      parts.views.set(view, button);
      views.append(button);
    }
    const leave: HTMLButtonElement = el('button', 'tb-leave', 'LEAVE BRIDGE');
    leave.type = 'button';
    leave.addEventListener('click', (): void => this.leave_ask());
    const gutterTop: HTMLElement = el('div', 'tb-gutter-top');
    gutterTop.append(block, parts.seed, el('div', 'tb-gutter-fill'));
    const gutterBody: HTMLElement = el('div', 'tb-gutter-body');
    gutterBody.append(views, el('div', 'tb-gutter-fill'), leave);
    gutter.append(gutterTop, gutterBody);
    return gutter;
  }

  /**
   * Builds the frame's two bars, each the arm of an elbow.
   *
   * @param parts - Where the live elements are registered.
   * @returns The header's bar and the body's.
   */
  private frame_build(parts: BridgeParts): [HTMLElement, HTMLElement] {
    // the frame: two elbows and their bars
    const barTop: HTMLElement = el('div', 'tb-bar tb-bar-top');
    for (const span of ['tb-bar-a', 'tb-bar-b', 'tb-bar-c', 'tb-bar-d']) barTop.append(el('span', span));
    const barBody: HTMLElement = el('div', 'tb-bar tb-bar-body');
    for (const span of ['tb-bar-a', 'tb-bar-b', 'tb-bar-c']) barBody.append(el('span', span));
    return [barTop, barBody];
  }

  /**
   * Builds the header: condition, ship, mission, position, since last command.
   *
   * @param parts - Where the live elements are registered.
   * @returns The header.
   */
  private header_build(parts: BridgeParts): HTMLElement {
    // the header
    const header: HTMLElement = el('header', 'tb-header');
    const condition: HTMLElement = el('section', 'tb-head-condition');
    const conditionCapsule: HTMLElement = el('div', 'tb-condition');
    conditionCapsule.append(el('span', 'tb-condition-label', 'CONDITION'));
    parts.condition = el('span', 'tb-condition-name', '—');
    conditionCapsule.append(parts.condition);
    parts.conditionWhy = el('div', 'tb-condition-why', '');
    condition.append(conditionCapsule, parts.conditionWhy);
    const section_make = (title: string): [HTMLElement, HTMLElement] => {
      const section: HTMLElement = el('section', 'tb-head-section');
      section.append(el('span', 'tb-head-title', title));
      const grid: HTMLElement = el('div', 'tb-head-grid');
      section.append(grid);
      return [section, grid];
    };
    const [shipSection, shipGrid] = section_make('SHIP');
    const [missionSection, missionGrid] = section_make('MISSION');
    const [positionSection, positionGrid] = section_make('POSITION');
    const [sinceSection, sinceGrid] = section_make('SINCE LAST COMMAND');
    parts.ship = shipGrid; parts.mission = missionGrid; parts.position = positionGrid; parts.since = sinceGrid;
    header.append(condition, shipSection, missionSection, positionSection, sinceSection);
    return header;
  }

  /**
   * Builds the body: scans and engineering, the short-range scan and the ship's commands, HELM over TACTICAL.
   *
   * @param parts - Where the live elements are registered.
   * @returns The body.
   */
  private body_build(parts: BridgeParts): HTMLElement {
    // the body: scans and engineering · short range and the ship · helm over tactical
    const body: HTMLElement = el('main', 'tb-body');
    const scans: HTMLElement = el('section', 'tb-scans');
    scans.append(el('span', 'tb-title', 'LONG RANGE'));
    parts.lrs = el('div', 'tb-lrs');
    scans.append(parts.lrs, el('span', 'tb-title', 'GALAXY · WHAT THE SHIP HAS SEEN'));
    parts.chart = el('div', 'tb-chart');
    scans.append(parts.chart);
    const engineering: HTMLElement = el('div', 'tb-engineering');
    engineering.append(el('span', 'tb-station-name', 'ENGINEERING'));
    parts.engineering = el('div', 'tb-devices');
    engineering.append(parts.engineering);
    scans.append(engineering);

    const srsSection: HTMLElement = el('section', 'tb-srs-section');
    parts.srsTitle = el('span', 'tb-title', 'SHORT RANGE');
    srsSection.append(parts.srsTitle);
    parts.srs = el('div', 'tb-srs');
    parts.srs.setAttribute('role', 'grid');
    srsSection.append(parts.srs, el('span', 'tb-note', 'PRESS A SECTOR: ITS COURSE AND DISTANCE FILL IN'));
    parts.commandPills = new Map<string, HTMLButtonElement>();
    const shipPills: HTMLElement = el('div', 'tb-pills tb-ship-pills');
    shipPills.append(el('span', 'tb-slider-label', 'SHIP'));
    for (const command of BRIDGE_COMMANDS.filter((c: BridgeCommand): boolean => c.station === 'ship')) shipPills.append(this.commandPill_make(command, parts.commandPills));
    srsSection.append(shipPills);

    const stations: HTMLElement = el('section', 'tb-stations');
    parts.stationHeads = new Map<Station, HTMLElement>();
    // HELM
    const helm: HTMLElement = el('div', 'tb-station tb-station-helm');
    const helmHead: HTMLElement = el('div', 'tb-station-head');
    helmHead.append(el('span', 'tb-station-name', 'HELM'));
    const helmStep: HTMLElement = el('span', 'tb-station-step', '');
    helmHead.append(helmStep);
    parts.stationHeads.set('helm', helmStep);
    const helmPills: HTMLElement = el('div', 'tb-pills');
    for (const command of BRIDGE_COMMANDS.filter((c: BridgeCommand): boolean => c.station === 'helm')) helmPills.append(this.commandPill_make(command, parts.commandPills));
    const helmControls: HTMLElement = el('div', 'tb-controls');
    parts.helmWheel = new CourseWheel(150, 'course wheel', (degrees: number): void => this.answer_send(String(degrees)));
    const helmSliders: HTMLElement = el('div', 'tb-sliders');
    parts.distance = new ValueSlider('tb-distance', 'DISTANCE', 1, (value: number): void => this.answer_send(value.toFixed(1)));
    parts.warp = new ValueSlider('tb-warp', 'WARP FACTOR', 1, (value: number): void => this.answer_send(value.toFixed(1)));
    parts.rest = new ValueSlider('tb-rest', 'REST', 1, (value: number): void => this.answer_send(value.toFixed(1)));
    helmSliders.append(parts.distance.root, parts.warp.root, parts.rest.root);
    helmControls.append(parts.helmWheel.root, helmSliders);
    helm.append(helmHead, helmPills, helmControls);
    // TACTICAL
    const tactical: HTMLElement = el('div', 'tb-station tb-station-tactical');
    const tacticalHead: HTMLElement = el('div', 'tb-station-head');
    tacticalHead.append(el('span', 'tb-station-name', 'TACTICAL'));
    const tacticalStep: HTMLElement = el('span', 'tb-station-step', '');
    tacticalHead.append(tacticalStep);
    parts.stationHeads.set('tactical', tacticalStep);
    const tacticalPills: HTMLElement = el('div', 'tb-pills');
    for (const command of BRIDGE_COMMANDS.filter((c: BridgeCommand): boolean => c.station === 'tactical')) tacticalPills.append(this.commandPill_make(command, parts.commandPills));
    const tacticalControls: HTMLElement = el('div', 'tb-controls');
    parts.tacticalWheel = new CourseWheel(150, 'firing course wheel', (degrees: number): void => this.answer_send(String(degrees)));
    const tacticalRows: HTMLElement = el('div', 'tb-sliders');
    parts.manual = new PillRow('PHASERS', question_control('manual-automatic', null).choices ?? [], (line: string): void => this.answer_send(line));
    parts.units = new ValueSlider('tb-units', 'UNITS', 0, (value: number): void => this.answer_send(String(Math.round(value))));
    parts.spread = new ValueSlider('tb-spread', 'SPREAD', 2, (value: number): void => this.answer_send(value.toFixed(2)));
    parts.burstAngle = new PillRow('BURST ANGLE', question_control('burst-angle', null).choices ?? [], (line: string): void => this.answer_send(line));
    parts.upDown = new PillRow('SHIELDS', question_control('up-down', null).choices ?? [], (line: string): void => this.answer_send(line));
    parts.targets = el('div', 'tb-targets');
    tacticalRows.append(parts.manual.root, parts.units.root, parts.spread.root, parts.burstAngle.root, parts.upDown.root, parts.targets);
    tacticalControls.append(parts.tacticalWheel.root, tacticalRows);
    tactical.append(tacticalHead, tacticalPills, tacticalControls);
    stations.append(helm, tactical);
    body.append(scans, srsSection, stations);
    return body;
  }

  /**
   * Builds the strip for the questions the engine asks on its own, and the ones the bridge has no control for.
   *
   * @param parts - Where the live elements are registered.
   * @returns Nothing; the strip is registered.
   */
  private strip_build(parts: BridgeParts): void {
    // the strip for the questions the engine asks on its own, and the ones the bridge has no control for
    parts.ask = el('div', 'tb-ask');
    parts.ask.hidden = true;
    parts.ask.setAttribute('role', 'dialog');
    parts.askText = el('span', 'tb-ask-text', '');
    parts.askPills = el('div', 'tb-pills');
    parts.askInput = document.createElement('input');
    parts.askInput.type = 'text';
    parts.askInput.className = 'tb-ask-input';
    parts.askInput.setAttribute('aria-label', 'the answer');
    parts.askSend = el('button', 'tb-pill tb-commit', 'ANSWER');
    parts.askSend.type = 'button';
    const askInput: HTMLInputElement = parts.askInput;
    parts.askSend.addEventListener('click', (): void => this.answer_send(askInput.value));
    askInput.addEventListener('keydown', (event: KeyboardEvent): void => { if (event.key === 'Enter') this.answer_send(askInput.value); });
    parts.ask.append(el('span', 'tb-ask-label', 'THE GAME ASKS'), parts.askText, parts.askPills, parts.askInput, parts.askSend);
    return undefined;
  }

  /**
   * Builds the ship's log.
   *
   * @param parts - Where the live elements are registered.
   * @returns The log section.
   */
  private log_build(parts: BridgeParts): HTMLElement {
    // the ship's log
    const footer: HTMLElement = el('footer', 'tb-log-section');
    const logHead: HTMLElement = el('div', 'tb-log-head');
    logHead.append(el('span', 'tb-title', "SHIP'S LOG"), el('span', 'tb-note', 'READ ONLY'));
    parts.log = el('div', 'tb-log');
    parts.log.setAttribute('aria-live', 'polite');
    footer.append(logHead, parts.log);
    return footer;
  }

  /**
   * Builds the leave question, asked before the game ends.
   *
   * @param parts - Where the live elements are registered.
   * @returns Nothing; the question is registered.
   */
  private leaveAsk_build(parts: BridgeParts): void {
    // leaving: asked first
    parts.leaveAsk = el('div', 'tb-leave-ask');
    parts.leaveAsk.hidden = true;
    parts.leaveAsk.setAttribute('role', 'dialog');
    const leaveYes: HTMLButtonElement = el('button', 'tb-pill tb-grave', 'LEAVE · THE GAME ENDS');
    leaveYes.type = 'button';
    leaveYes.addEventListener('click', (): void => { this.hooks.sound('audio3'); this.hooks.leave(); });
    const leaveNo: HTMLButtonElement = el('button', 'tb-pill', 'STAY');
    leaveNo.type = 'button';
    const leaveAsk: HTMLElement = parts.leaveAsk;
    leaveNo.addEventListener('click', (): void => { leaveAsk.hidden = true; });
    parts.leaveAsk.append(el('span', 'tb-ask-label', 'LEAVE THE BRIDGE?'), el('span', 'tb-ask-text', 'The game ends where it stands; dump first to keep it.'), leaveYes, leaveNo);
    return undefined;
  }

  /**
   * The harness the host feeds: questions, text, events, the end.
   *
   * @returns The harness.
   */
  public harness_get(): TrekHarness {
    return this.harness;
  }

  /**
   * Asks whether to leave; Esc and LEAVE BRIDGE come here.
   */
  public leave_ask(): void {
    this.parts.leaveAsk.hidden = false;
  }

  /**
   * Whether the leave question is open.
   *
   * @returns True while it is.
   */
  public leaveAsk_isOpen(): boolean {
    return !this.parts.leaveAsk.hidden;
  }

  /**
   * Closes the leave question.
   */
  public leaveAsk_close(): void {
    this.parts.leaveAsk.hidden = true;
  }

  /**
   * The view the gutter has chosen.
   *
   * @returns The view.
   */
  public view_get(): BridgeView {
    return this.view;
  }

  /**
   * Chooses a view. Only BRIDGE is drawn in this slice; the others mark the gutter and leave the bridge on stage.
   *
   * @param view - The view.
   */
  public view_set(view: BridgeView): void {
    this.view = view;
    this.root.dataset['view'] = view;
    for (const [name, button] of this.parts.views) button.classList.toggle('tb-view-on', name === view);
    this.hooks.sound('audio1');
  }

  /**
   * The last readout, for a host or a test.
   *
   * @returns The readout, or null before the first state.
   */
  public readout_get(): BridgeReadout | null {
    return this.readout;
  }

  /**
   * Makes a command pill: pressed at the Command: prompt it sends the command's line.
   *
   * @param command - The command.
   * @param pills - Where the pill is registered, by id.
   * @returns The pill.
   */
  private commandPill_make(command: BridgeCommand, pills: Map<string, HTMLButtonElement>): HTMLButtonElement {
    const button: HTMLButtonElement = el('button', `tb-pill tb-command${command.grave === true ? ' tb-grave' : ''}`, command.label);
    button.type = 'button';
    button.dataset['command'] = command.id;
    button.addEventListener('click', (): void => {
      if (!this.harness.command_send(command)) { this.hooks.sound('audio4'); return; }
      this.hooks.sound('audio1');
      this.nextDistance = null;
    });
    pills.set(command.id, button);
    return button;
  }

  /**
   * Answers the open question with a line the controls built.
   *
   * @param line - The line.
   */
  private answer_send(line: string): void {
    if (!this.harness.answer(line)) { this.hooks.sound('audio4'); return; }
    this.hooks.sound('audio2');
    this.log_write(`${line}\n`);
  }

  /**
   * Draws the state the engine showed: the header, the scans, the chart, engineering, and the controls' ranges.
   *
   * @param state - The state.
   */
  private state_show(state: TrekState): void {
    this.previous = this.readout;
    const readout: BridgeReadout = readout_build(state);
    this.readout = readout;
    const { parts } = this;
    parts.condition.textContent = readout.condition.name;
    parts.condition.parentElement?.setAttribute('data-condition', readout.condition.name.toLowerCase());
    parts.conditionWhy.textContent = readout.condition.why.toUpperCase();
    const pairs = (grid: HTMLElement, rows: ReadonlyArray<[string, string, string?]>): void => {
      grid.replaceChildren();
      for (const [label, value, className] of rows) {
        grid.append(el('span', 'tb-head-label', label), el('span', `tb-head-value${className === undefined ? '' : ` ${className}`}`, value));
      }
    };
    const bar = (value: number, max: number): string => `${Math.max(0, Math.min(100, Math.round((100 * value) / Math.max(1, max))))}`;
    pairs(parts.ship, [
      ['ENERGY', `${readout.ship.energy} / ${readout.ship.energyMax}`],
      ['SHIELDS', `${readout.ship.shieldsUp ? 'UP' : 'DOWN'} · ${readout.ship.shield} (${bar(readout.ship.shield, readout.ship.shieldMax)}%)`],
      ['TORPEDOES', `${readout.ship.torpedoes} / ${readout.ship.torpedoesMax}`],
      ['WARP', `${readout.ship.warp.toFixed(1)}${readout.ship.cloaked ? ' · CLOAKED' : ''}`],
    ]);
    pairs(parts.mission, [
      ['STARDATE', readout.mission.stardate.toFixed(2)],
      ['TIME LEFT', readout.mission.timeLeft.toFixed(2)],
      ['KLINGONS', `${readout.mission.klingonsLeft} LEFT · ${readout.mission.killed} KILLED${readout.mission.captives > 0 ? ` · ${readout.mission.captives} CAPTIVE` : ''}`],
      ['STARBASES', readout.nearestBase === null ? `${readout.mission.starbases}` : `${readout.mission.starbases} · NEAREST ${readout.nearestBase.at.x},${readout.nearestBase.at.y}${readout.nearestBase.here ? ' HERE' : ''}`],
    ]);
    pairs(parts.position, [
      ['QUADRANT', `${readout.position.quadrant.x},${readout.position.quadrant.y}`],
      ['SECTOR', `${readout.position.sector.x},${readout.position.sector.y}`],
      ['CREW', `${readout.ship.crew}`],
      ['LIFE SUPPORT', `${readout.ship.reserves.toFixed(1)} / ${readout.ship.reservesMax.toFixed(1)}`],
    ]);
    const since = this.previous === null ? [] : readout_diff(this.previous, readout);
    pairs(parts.since, since.length === 0 ? [['—', 'NOTHING MOVED']] : since.map((line): [string, string, string] => [line.label, line.change, line.bad ? 'tb-bad' : 'tb-good']));
    this.srs_draw(readout);
    this.lrs_draw(readout);
    this.chart_draw(readout);
    this.engineering_draw(readout.devices);
    this.targets_draw(readout.klingons);
    const bearings = readout.klingons.map((k: KlingonSeen) => ({ bearing: k.bearing, kind: 'klingon' as const, label: `Klingon at ${k.x},${k.y} · ${k.range.toFixed(1)} · ${Math.round(k.bearing)}°` }));
    parts.helmWheel.marks_set(bearings);
    parts.tacticalWheel.marks_set(bearings);
    if (readout.klingons[0] !== undefined) parts.tacticalWheel.degrees_set(readout.klingons[0].bearing);
    // dimmed sliders are readouts: the warp factor sits at the ship's speed
    parts.warp.range_set(question_control('warp-factor', readout), readout.ship.warp, 'THE SHIP NOW · ABOVE 6 THE ENGINES MAY BURN');
    parts.distance.range_set(question_control('distance', readout), parts.distance.value_get(), 'SECTORS · 10 IS ONE QUADRANT');
    parts.rest.range_set(question_control('how-long', readout), 0, `STARDATES · ${readout.mission.timeLeft.toFixed(1)} LEFT`);
    parts.units.range_set(question_control('units', readout), Math.round(readout.ship.energy / 10 / 10) * 10, `UP TO THE ${readout.ship.energy} FREE`);
    parts.spread.range_set(question_control('spread', readout), 0.5, 'MANUAL PHASERS ONLY');
    this.question_show(this.harness.question_get());
  }

  /**
   * Draws the short-range scan; a sector pressed fills the course and distance to it.
   *
   * @param readout - The readout.
   */
  private srs_draw(readout: BridgeReadout): void {
    const { parts } = this;
    parts.srsTitle.textContent = `SHORT RANGE · QUADRANT ${readout.position.quadrant.x},${readout.position.quadrant.y}`;
    parts.srs.replaceChildren();
    parts.srs.append(el('span', 'tb-srs-corner', ''));
    for (let y: number = 0; y < (readout.sectors[0]?.length ?? 0); y++) parts.srs.append(el('span', 'tb-srs-axis', String(y)));
    const here: XY = readout.position.sector;
    for (const row of readout.sectors) {
      parts.srs.append(el('span', 'tb-srs-axis', String(row[0]?.x ?? '')));
      for (const cell of row) {
        const button: HTMLButtonElement = el('button', `tb-sector tb-sector-${cell.kind}`, SECTOR_GLYPHS[cell.kind]);
        button.type = 'button';
        button.dataset['x'] = String(cell.x);
        button.dataset['y'] = String(cell.y);
        const bearing: number = bearing_of(here, cell);
        const range: number = range_of(here, cell);
        button.title = cell.kind === 'ship' ? 'the ship' : `${cell.x},${cell.y} · course ${Math.round(bearing)}° · ${range.toFixed(1)}`;
        button.addEventListener('click', (): void => this.sector_press(bearing, range));
        parts.srs.append(button);
      }
    }
  }

  /**
   * A sector pressed: the wheels point at it, the distance slider is set to it, and the open course question is kept for SET COURSE.
   *
   * @param bearing - The course to the sector.
   * @param range - The distance to it.
   */
  private sector_press(bearing: number, range: number): void {
    const { parts } = this;
    parts.helmWheel.degrees_set(bearing);
    parts.tacticalWheel.degrees_set(bearing);
    parts.distance.value_set(Math.round(range * 10) / 10);
    this.nextDistance = Math.round(range * 10) / 10;
    this.hooks.sound('audio1');
  }

  /**
   * Draws the long-range scan: the three-by-three of quadrants around the ship, from the chart.
   *
   * @param readout - The readout.
   */
  private lrs_draw(readout: BridgeReadout): void {
    const { parts } = this;
    parts.lrs.replaceChildren();
    const { quadrant } = readout.position;
    for (let dx: number = -1; dx <= 1; dx++) {
      for (let dy: number = -1; dy <= 1; dy++) {
        const cell: ChartCell | undefined = readout.chart[quadrant.x + dx]?.[quadrant.y + dy];
        const node: HTMLElement = el('div', `tb-lrs-cell${cell?.here === true ? ' tb-here' : ''}${(cell?.klingons ?? 0) > 0 ? ' tb-hostile' : ''}`);
        node.append(el('span', 'tb-lrs-code', cell === undefined ? '' : (cell.code ?? '···')), el('span', 'tb-lrs-at', cell === undefined ? '' : `${cell.x},${cell.y}`));
        parts.lrs.append(node);
      }
    }
  }

  /**
   * Draws the galaxy chart as the ship knows it.
   *
   * @param readout - The readout.
   */
  private chart_draw(readout: BridgeReadout): void {
    const { parts } = this;
    parts.chart.replaceChildren();
    for (const row of readout.chart) {
      for (const cell of row) {
        const node: HTMLElement = el('span', `tb-quadrant${cell.here ? ' tb-here' : ''}${cell.klingons > 0 ? ' tb-hostile' : ''}${cell.bases > 0 ? ' tb-based' : ''}`, cell.code ?? '···');
        node.title = `quadrant ${cell.x},${cell.y}${cell.code === null ? ' · unscanned' : ''}`;
        parts.chart.append(node);
      }
    }
  }

  /**
   * Draws engineering: every device, the damaged ones with their repair stardate.
   *
   * @param devices - The devices.
   */
  private engineering_draw(devices: ReadonlyArray<DeviceState>): void {
    const { parts } = this;
    parts.engineering.replaceChildren();
    for (const device of devices.slice(0, 14)) {
      const row: HTMLElement = el('div', `tb-device${device.repairAt === null ? '' : ' tb-bad'}`);
      row.append(el('span', 'tb-device-name', device.name.toUpperCase()), el('span', 'tb-device-state', device.repairAt === null ? 'OK' : `DOWN · ${device.repairAt.toFixed(2)}`));
      parts.engineering.append(row);
    }
  }

  /**
   * Draws the targets beside the firing wheel: each Klingon's bearing and range.
   *
   * @param klingons - The Klingons in the quadrant, nearest first.
   */
  private targets_draw(klingons: ReadonlyArray<KlingonSeen>): void {
    const { parts } = this;
    parts.targets.replaceChildren();
    if (klingons.length === 0) { parts.targets.append(el('span', 'tb-note', 'NO KLINGONS IN THIS QUADRANT')); return; }
    for (const k of klingons) {
      const row: HTMLButtonElement = el('button', 'tb-target', `K ${k.x},${k.y} · ${Math.round(k.bearing)}° · ${k.range.toFixed(1)}`);
      row.type = 'button';
      row.addEventListener('click', (): void => this.sector_press(k.bearing, k.range));
      parts.targets.append(row);
    }
  }

  /**
   * Lights the control that answers the open question, and dims the rest.
   *
   * @param open - The open question, or null while the engine runs.
   */
  private question_show(open: OpenQuestion | null): void {
    const { parts } = this;
    const question: TrekQuestion | null = open?.question ?? null;
    const atCommand: boolean = question === 'command';
    for (const [id, pill] of parts.commandPills) {
      pill.disabled = !atCommand;
      pill.classList.toggle('tb-pill-on', open?.command?.id === id);
    }
    const control: QuestionControl | null = question === null ? null : question_control(question, this.readout);
    const lit = (names: ReadonlyArray<TrekQuestion>): boolean => question !== null && names.includes(question);
    parts.helmWheel.lit_set(lit(['course', 'direction']), control?.commit ?? 'SET COURSE');
    parts.tacticalWheel.lit_set(lit(['torpedo-course', 'bank-course']), control?.commit ?? 'SET COURSE');
    parts.distance.lit_set(lit(['distance']), 'ENGAGE');
    if (question === 'distance' && this.nextDistance !== null) parts.distance.value_set(this.nextDistance);
    parts.warp.lit_set(lit(['warp-factor']), 'SET WARP');
    parts.rest.lit_set(lit(['how-long']), 'REST');
    parts.manual.lit_set(lit(['manual-automatic']));
    parts.units.lit_set(lit(['units', 'bank-units']), question === 'units' ? 'FIRE' : 'SET');
    parts.spread.lit_set(lit(['spread']), 'SET');
    parts.burstAngle.lit_set(lit(['burst-angle']));
    parts.upDown.lit_set(lit(['up-down']));
    for (const [station, head] of parts.stationHeads) {
      const command: BridgeCommand | null = open?.command ?? null;
      head.textContent = command !== null && command.station === station && question !== null && question !== 'command' ? `${command.label} · ${question.replace(/-/g, ' ').toUpperCase()}` : atCommand ? 'READY' : '';
    }
    // the strip: yes/no, pills with no station, and anything the bridge has no control for
    const stripKinds: ReadonlyArray<QuestionControl['kind']> = ['yesno', 'text'];
    const stripQuestions: ReadonlyArray<TrekQuestion> = ['length', 'skill', 'request', 'quadrant', 'quadrant-y', 'sector', 'sector-y', 'range', 'computer-distance', 'computer-warp', 'burst', 'status-report', 'another', 'yes-no', 'unknown'];
    const onStrip: boolean = control !== null && question !== null && (stripKinds.includes(control.kind) || stripQuestions.includes(question)) && question !== 'command';
    parts.ask.hidden = !onStrip;
    if (onStrip && control !== null && question !== null) {
      parts.askText.textContent = open?.prompt.replace(/[:\s]+$/, '').trim() ?? '';
      parts.askPills.replaceChildren();
      const choices = control.choices ?? [];
      for (const choice of choices) {
        const button: HTMLButtonElement = el('button', 'tb-pill tb-choice', choice.label);
        button.type = 'button';
        button.addEventListener('click', (): void => this.answer_send(choice.line));
        parts.askPills.append(button);
      }
      const typed: boolean = control.kind === 'text' || control.kind === 'slider';
      parts.askInput.hidden = !typed;
      parts.askSend.hidden = !typed;
      if (typed) { parts.askInput.value = ''; parts.askInput.focus(); }
    }
  }

  /**
   * Writes the engine's text to the ship's log, a line at a time.
   *
   * @param text - The text.
   */
  private log_write(text: string): void {
    const { parts } = this;
    const lines: string[] = text.replace(/\x1b\[[0-9;]*m/g, '').split('\n');
    const last: HTMLElement | null = parts.log.lastElementChild as HTMLElement | null;
    lines.forEach((line: string, index: number): void => {
      if (index === 0 && last !== null && last.dataset['open'] === 'true') {
        last.textContent = `${last.textContent ?? ''}${line}`;
        if (lines.length > 1) delete last.dataset['open'];
        return;
      }
      if (index === lines.length - 1 && line === '') return;
      const node: HTMLElement = el('div', 'tb-log-line', line);
      if (index === lines.length - 1) node.dataset['open'] = 'true';
      parts.log.append(node);
    });
    while (parts.log.childElementCount > LOG_LIMIT) parts.log.firstElementChild?.remove();
    parts.log.scrollTop = parts.log.scrollHeight;
  }
}
