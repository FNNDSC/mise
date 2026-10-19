/**
 * @file The bridge: the screen trek takes over, drawn from the state the
 * engine shows and answering the engine through the harness.
 *
 * Five views share one header, gutter, strip and log. BRIDGE shows
 * everything at once: the long-range scan and galaxy chart with engineering
 * beneath, the short-range scan with the ship's commands, HELM over
 * TACTICAL. The other views enlarge one station: HELM and TACTICAL draw
 * their stations large beside the scan, ENGINEERING the damage control
 * report whole, COMPUTER the chart large with the computer's requests.
 * Every control answers one of the engine's questions and is lit only while
 * that question is open; a dimmed control is a readout. Nobody types: the
 * log is read-only.
 *
 * The bridge draws its own LCARS frame (two elbows) because the takeover
 * removes ARGUS's. Colours come from the theme's palette tokens.
 *
 * @module
 */
import type { TrekState, XY } from 'bsd-trek/host';
import { el, pill_make } from './controls.js';
import { answerCue_of, commandCue_of, lineCues_of, pillLabel_of, stateCues_of, type BridgeVoice } from './cues.js';
import { TrekHarness, type OpenQuestion } from './harness.js';
import {
  BRIDGE_COMMANDS, bearing_of, question_control, range_of, readout_build, readout_diff, score_of,
  type BridgeCommand, type BridgeReadout, type ChartCell, type DeviceState, type QuestionControl, type TrekQuestion,
} from './model.js';
import { commandPill_make, commandPills_show, ComputerView, EngineeringView, HelmStation, TacticalStation, type StationHost } from './stations.js';

/** The views the gutter offers. */
export type BridgeView = 'bridge' | 'helm' | 'tactical' | 'engineering' | 'computer';

/** The views, in the gutter's order. */
const VIEWS: ReadonlyArray<BridgeView> = ['bridge', 'helm', 'tactical', 'engineering', 'computer'];

/** What the bridge needs from its host. */
export interface BridgeHooks {
  /** How the bridge is heard. */
  voice: BridgeVoice;
  /** The operator asked to leave: the host ends the game. */
  leave: () => void;
}

/** The live elements, as they are registered while the screen is built. */
type BridgeParts = Partial<TrekBridge['parts']>;

/** The glyphs the scan draws, by kind. */
const SECTOR_GLYPHS: Readonly<Record<string, string>> = { ship: 'E', klingon: 'K', base: '#', star: '*', inhabited: '@', hole: ' ', empty: '·' };

/** How many log lines are kept. */
const LOG_LIMIT: number = 400;

/** The questions that stand on the strip whatever their control: the setup's, and the engine's own. */
const STRIP_QUESTIONS: ReadonlyArray<TrekQuestion> = ['length', 'skill', 'request', 'quadrant', 'quadrant-y', 'sector', 'sector-y', 'range', 'computer-distance', 'computer-warp', 'status-report', 'another', 'yes-no', 'unknown'];

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
  private readonly plan: Map<TrekQuestion, string> = new Map<TrekQuestion, string>();
  private answering: boolean = false;
  private computerRunning: boolean = false;
  private leaving: boolean = false;
  private readonly parts: {
    seed: HTMLElement; views: Map<BridgeView, HTMLButtonElement>; body: HTMLElement;
    condition: HTMLElement; conditionWhy: HTMLElement; ship: HTMLElement; mission: HTMLElement; position: HTMLElement; since: HTMLElement;
    lrs: HTMLElement; chart: HTMLElement; engineering: HTMLElement; srs: HTMLElement; srsTitle: HTMLElement;
    shipPills: Map<string, HTMLButtonElement>;
    helm: HelmStation; tactical: TacticalStation; helmView: HelmStation; tacticalView: TacticalStation; engineeringView: EngineeringView; computerView: ComputerView;
    ask: HTMLElement; askText: HTMLElement; askPills: HTMLElement; askInput: HTMLInputElement; askSend: HTMLButtonElement;
    log: HTMLElement; leaveAsk: HTMLElement;
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
      ended: (): void => { if (!this.leaving) this.hooks.voice.cue('gameover'); },
    });
    this.root = el('section', 'trek-bridge');
    this.root.id = 'trek-bridge';
    this.root.dataset['view'] = 'bridge';
    this.root.setAttribute('aria-label', 'trek: the bridge');
    const parts: BridgeParts = {};
    const gutter: HTMLElement = this.gutter_build(parts, seed);
    const [barTop, barBody] = this.frame_build();
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
   * The bridge as its stations see it.
   *
   * @returns The host verbs.
   */
  private stationHost_get(): StationHost {
    return {
      answer_send: (line: string, label: string | null): void => this.answer_send(line, label),
      command_send: (command: BridgeCommand): boolean => this.command_send(command),
      plan_set: (answers: ReadonlyArray<[TrekQuestion, string]>): void => { for (const [question, line] of answers) this.plan.set(question, line); },
      course_set: (degrees: number, distance: number | null): void => this.course_set(degrees, distance),
      voice: this.hooks.voice,
    };
  }

  /**
   * Builds the gutter: the block, the seed, the views, LEAVE BRIDGE.
   *
   * @param parts - Where the live elements are registered.
   * @param seed - The game's seed, or null.
   * @returns The gutter.
   */
  private gutter_build(parts: BridgeParts, seed: number | null): HTMLElement {
    const gutter: HTMLElement = el('aside', 'tb-gutter');
    const block: HTMLElement = el('div', 'tb-block');
    block.append(el('span', 'tb-block-name', 'TREK'), el('span', 'tb-block-sub', 'ARGUS · BSD TREK'));
    parts.seed = el('div', 'tb-seed', seed === null ? 'RANDOM GALAXY' : `SEED ${seed}`);
    const views: HTMLElement = el('nav', 'tb-views');
    views.setAttribute('aria-label', 'views');
    parts.views = new Map<BridgeView, HTMLButtonElement>();
    for (const view of VIEWS) {
      const button: HTMLButtonElement = pill_make(`tb-view tb-view-${view}`, view.toUpperCase(), (): void => this.view_set(view));
      button.classList.remove('tb-pill');
      button.dataset['view'] = view;
      parts.views.set(view, button);
      views.append(button);
    }
    const leave: HTMLButtonElement = pill_make('tb-leave', 'LEAVE BRIDGE', (): void => this.leave_ask());
    leave.classList.remove('tb-pill');
    const gutterTop: HTMLElement = el('div', 'tb-gutter-top');
    gutterTop.append(block, parts.seed, el('div', 'tb-gutter-fill'));
    const gutterBody: HTMLElement = el('div', 'tb-gutter-body');
    gutterBody.append(el('div', 'tb-gutter-cap'), views, el('div', 'tb-gutter-fill'), leave);
    gutter.append(gutterTop, gutterBody);
    return gutter;
  }

  /**
   * Builds the frame's two bars, each the arm of an elbow.
   *
   * @returns The header's bar and the body's.
   */
  private frame_build(): [HTMLElement, HTMLElement] {
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
   * Builds the body: the BRIDGE view's scans, short-range scan and stations, and the four station views beside them; the view chooses which show.
   *
   * @param parts - Where the live elements are registered.
   * @returns The body.
   */
  private body_build(parts: BridgeParts): HTMLElement {
    const host: StationHost = this.stationHost_get();
    const body: HTMLElement = el('main', 'tb-body');
    body.dataset['view'] = 'bridge';
    parts.body = body;
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
    parts.shipPills = new Map<string, HTMLButtonElement>();
    const shipPills: HTMLElement = el('div', 'tb-pills tb-ship-pills');
    shipPills.append(el('span', 'tb-slider-label', 'SHIP'));
    for (const command of BRIDGE_COMMANDS.filter((c: BridgeCommand): boolean => c.station === 'ship')) {
      const pill: HTMLButtonElement = commandPill_make(command, host);
      parts.shipPills.set(command.id, pill);
      shipPills.append(pill);
    }
    srsSection.append(shipPills);

    const stations: HTMLElement = el('section', 'tb-stations');
    parts.helm = new HelmStation(host, 150, 'tb');
    parts.tactical = new TacticalStation(host, 150, 'tb');
    stations.append(parts.helm.root, parts.tactical.root);

    parts.helmView = new HelmStation(host, 260, 'tbh');
    parts.helmView.root.classList.add('tb-view-body', 'tb-view-helm');
    parts.tacticalView = new TacticalStation(host, 260, 'tbt');
    parts.tacticalView.root.classList.add('tb-view-body', 'tb-view-tactical');
    parts.engineeringView = new EngineeringView(host);
    parts.computerView = new ComputerView(host);
    body.append(scans, srsSection, stations, parts.helmView.root, parts.tacticalView.root, parts.engineeringView.root, parts.computerView.root);
    return body;
  }

  /**
   * Builds the strip for the questions the engine asks on its own, and the ones the bridge has no control for.
   *
   * @param parts - Where the live elements are registered.
   */
  private strip_build(parts: BridgeParts): void {
    parts.ask = el('div', 'tb-ask');
    parts.ask.hidden = true;
    parts.ask.setAttribute('role', 'dialog');
    parts.askText = el('span', 'tb-ask-text', '');
    parts.askPills = el('div', 'tb-pills');
    parts.askInput = document.createElement('input');
    parts.askInput.type = 'text';
    parts.askInput.className = 'tb-ask-input';
    parts.askInput.setAttribute('aria-label', 'the answer');
    const askInput: HTMLInputElement = parts.askInput;
    parts.askSend = pill_make('tb-commit', 'ANSWER', (): void => this.answer_send(askInput.value, 'ANSWER'));
    askInput.addEventListener('keydown', (event: KeyboardEvent): void => { if (event.key === 'Enter') this.answer_send(askInput.value, 'ANSWER'); });
    parts.ask.append(el('span', 'tb-ask-label', 'THE GAME ASKS'), parts.askText, parts.askPills, parts.askInput, parts.askSend);
  }

  /**
   * Builds the ship's log.
   *
   * @param parts - Where the live elements are registered.
   * @returns The log section.
   */
  private log_build(parts: BridgeParts): HTMLElement {
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
   */
  private leaveAsk_build(parts: BridgeParts): void {
    parts.leaveAsk = el('div', 'tb-leave-ask');
    parts.leaveAsk.hidden = true;
    parts.leaveAsk.setAttribute('role', 'dialog');
    const leaveAsk: HTMLElement = parts.leaveAsk;
    const leaveYes: HTMLButtonElement = pill_make('tb-grave', 'LEAVE · THE GAME ENDS', (): void => { this.leaving = true; this.hooks.voice.cue('close'); this.hooks.leave(); });
    const leaveNo: HTMLButtonElement = pill_make('', 'STAY', (): void => { leaveAsk.hidden = true; });
    parts.leaveAsk.append(el('span', 'tb-ask-label', 'LEAVE THE BRIDGE?'), el('span', 'tb-ask-text', 'The game ends where it stands; dump first to keep it.'), leaveYes, leaveNo);
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
    if (this.parts.leaveAsk.hidden) this.hooks.voice.pill('LEAVE BRIDGE');
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
   * Chooses a view: the body shows that view's parts; the header, strip and log stay.
   *
   * @param view - The view.
   */
  public view_set(view: BridgeView): void {
    this.view = view;
    this.root.dataset['view'] = view;
    this.parts.body.dataset['view'] = view;
    for (const [name, button] of this.parts.views) button.classList.toggle('tb-view-on', name === view);
    this.hooks.voice.pill(pillLabel_of(view.toUpperCase(), 'view'));
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
   * Sends a command at the Command: prompt.
   *
   * @param command - The command.
   * @returns True when the prompt was open.
   */
  private command_send(command: BridgeCommand): boolean {
    if (!this.harness.command_send(command)) { this.hooks.voice.cue('deny'); return false; }
    const cue = commandCue_of(command.id);
    if (cue === null) this.hooks.voice.pill(pillLabel_of(command.label, 'command'));
    else this.hooks.voice.cue(cue);
    this.nextDistance = null;
    this.computerRunning = command.id === 'computer';
    if (this.computerRunning) this.parts.computerView.answer_take(null);
    this.log_write(`${command.line}\n`, true);
    return true;
  }

  /**
   * Answers the open question with a line the controls built, and is heard: the pill's beep, or the thing the answer does.
   *
   * @param line - The line.
   * @param label - The pill heard for it; null for an answer the bridge gives on its own.
   */
  private answer_send(line: string, label: string | null): void {
    const open: OpenQuestion | null = this.harness.question_get();
    if (!this.harness.answer(line)) { this.hooks.voice.cue('deny'); return; }
    const cue = open === null ? null : answerCue_of(open.question, open.command?.id ?? null);
    if (cue !== null) this.hooks.voice.cue(cue);
    else if (label !== null) this.hooks.voice.pill(label);
    this.log_write(`${line}\n`, true);
  }

  /**
   * Points every wheel at a course and sets every distance slider.
   *
   * @param degrees - The course.
   * @param distance - The distance in quadrants, or null to leave the sliders.
   */
  private course_set(degrees: number, distance: number | null): void {
    const { parts } = this;
    for (const station of [parts.helm, parts.helmView, parts.tactical, parts.tacticalView]) station.wheel.degrees_set(degrees);
    if (distance !== null) {
      parts.helm.distance.value_set(distance);
      parts.helmView.distance.value_set(distance);
      this.nextDistance = distance;
    }
  }

  /**
   * Draws the state the engine showed: the header, the scans, the chart, engineering, and every station.
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
    this.header_draw(readout);
    this.srs_draw(readout);
    this.lrs_draw(readout);
    this.chart_draw(readout);
    this.engineering_draw(readout.devices);
    for (const station of [parts.helm, parts.helmView, parts.tactical, parts.tacticalView, parts.computerView]) station.state_show(readout);
    parts.engineeringView.state_show(readout, this.previous);
    for (const cue of stateCues_of(this.previous, readout)) this.hooks.voice.cue(cue);
    this.question_show(this.harness.question_get());
  }

  /**
   * Draws the header's four sections from the readout.
   *
   * @param readout - The readout.
   */
  private header_draw(readout: BridgeReadout): void {
    const { parts } = this;
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
      ['SCORE', `${score_of(readout).total}`],
    ]);
    const since = this.previous === null ? [] : readout_diff(this.previous, readout);
    pairs(parts.since, since.length === 0 ? [['—', 'NOTHING MOVED']] : since.map((line): [string, string, string] => [line.label, line.change, line.bad ? 'tb-bad' : 'tb-good']));
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
        const bearing: number = bearing_of(here, cell);
        const range: number = range_of(here, cell);
        const button: HTMLButtonElement = pill_make(`tb-sector tb-sector-${cell.kind}`, SECTOR_GLYPHS[cell.kind] ?? '·', (): void => this.sector_press(cell, bearing, range));
        button.classList.remove('tb-pill');
        button.dataset['x'] = String(cell.x);
        button.dataset['y'] = String(cell.y);
        button.title = cell.kind === 'ship' ? 'the ship' : `${cell.x},${cell.y} · course ${Math.round(bearing)}° · ${(range / 10).toFixed(1)}`;
        parts.srs.append(button);
      }
    }
  }

  /**
   * A sector pressed: the wheels point at it, the distance sliders are set to it (in quadrants: a sector is a tenth), and the computer's course panel aims at it.
   *
   * @param cell - The sector.
   * @param bearing - The course to the sector.
   * @param range - The distance to it, in sectors.
   */
  private sector_press(cell: XY, bearing: number, range: number): void {
    this.hooks.voice.cue('scanner');
    this.course_set(bearing, Math.round(range) / 10);
    this.parts.computerView.sector_set(cell);
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
   * Draws engineering on the BRIDGE view: every device, the damaged ones with their repair stardate.
   *
   * @param devices - The devices.
   */
  private engineering_draw(devices: ReadonlyArray<DeviceState>): void {
    const { parts } = this;
    parts.engineering.replaceChildren();
    for (const device of devices) {
      const row: HTMLElement = el('div', `tb-device${device.repairAt === null ? '' : ' tb-bad'}`);
      row.append(el('span', 'tb-device-name', device.name.toUpperCase()), el('span', 'tb-device-state', device.repairAt === null ? 'OK' : `DOWN · ${device.repairAt.toFixed(2)}`));
      parts.engineering.append(row);
    }
  }

  /**
   * Lights the control that answers the open question, and dims the rest; a planned answer is given at once.
   *
   * @param open - The open question, or null while the engine runs.
   */
  private question_show(open: OpenQuestion | null): void {
    const { parts } = this;
    if (open?.question === 'command') { this.plan.clear(); this.computerRunning = false; }
    const planned: string | undefined = open === null ? undefined : this.plan.get(open.question);
    if (planned !== undefined && open !== null && !this.answering) {
      this.plan.delete(open.question);
      this.answering = true;
      try { this.answer_send(planned, null); } finally { this.answering = false; }
      return;
    }
    commandPills_show(parts.shipPills, open);
    for (const station of [parts.helm, parts.helmView, parts.tactical, parts.tacticalView, parts.engineeringView, parts.computerView]) station.question_show(open);
    if (open?.question === 'distance' && this.nextDistance !== null) {
      parts.helm.distance.value_set(this.nextDistance);
      parts.helmView.distance.value_set(this.nextDistance);
    }
    this.strip_show(open);
  }

  /**
   * Shows the strip for a yes/no, a typed answer, and the questions no station draws.
   *
   * @param open - The open question.
   */
  private strip_show(open: OpenQuestion | null): void {
    const { parts } = this;
    const question: TrekQuestion | null = open?.question ?? null;
    const control: QuestionControl | null = question === null ? null : question_control(question, this.readout);
    const onStrip: boolean = control !== null && question !== null && question !== 'command'
      && (control.kind === 'yesno' || control.kind === 'text' || STRIP_QUESTIONS.includes(question));
    parts.ask.hidden = !onStrip;
    if (!onStrip || control === null || open === null) return;
    parts.askText.textContent = open.prompt.replace(/[:\s]+$/, '').trim();
    parts.askPills.replaceChildren();
    for (const choice of control.choices ?? []) parts.askPills.append(pill_make('tb-choice', choice.label, (): void => this.answer_send(choice.line, choice.label)));
    const typed: boolean = control.kind === 'text' || control.kind === 'slider';
    parts.askInput.hidden = !typed;
    parts.askSend.hidden = !typed;
    if (typed) { parts.askInput.value = ''; parts.askInput.focus(); }
  }

  /**
   * Writes the engine's text to the ship's log, a line at a time, and to the computer's answer while a request runs.
   *
   * @param text - The text.
   * @param own - True for a line the bridge sent, which is never the computer's answer.
   */
  private log_write(text: string, own: boolean = false): void {
    const { parts } = this;
    const clean: string = text.replace(/\x1b\[[0-9;]*m/g, '');
    if (this.computerRunning && !own) parts.computerView.answer_take(clean);
    const lines: string[] = clean.split('\n');
    const last: HTMLElement | null = parts.log.lastElementChild as HTMLElement | null;
    lines.forEach((line: string, index: number): void => {
      const complete: boolean = index < lines.length - 1;
      if (index === 0 && last !== null && last.dataset['open'] === 'true') {
        last.textContent = `${last.textContent ?? ''}${line}`;
        if (complete) { delete last.dataset['open']; this.line_hear(last.textContent, own); }
        return;
      }
      if (!complete && line === '') return;
      const node: HTMLElement = el('div', 'tb-log-line', line);
      if (complete) this.line_hear(line, own);
      else node.dataset['open'] = 'true';
      parts.log.append(node);
    });
    while (parts.log.childElementCount > LOG_LIMIT) parts.log.firstElementChild?.remove();
    parts.log.scrollTop = parts.log.scrollHeight;
  }

  /**
   * A complete line of the engine's is heard, when it says something the bank has a cue for.
   *
   * @param line - The line.
   * @param own - True for a line the bridge sent, which is never heard.
   */
  private line_hear(line: string, own: boolean): void {
    if (own) return;
    for (const cue of lineCues_of(line)) this.hooks.voice.cue(cue);
  }
}
