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
import { takeoverFrame_build, type TakeoverFrame } from '../takeover/frame.js';
import { answerCue_derive, commandCue_find, lineCues_derive, pillLabel_format, stateCues_derive, type BridgeVoice } from './cues.js';
import { TrekHarness, type OpenQuestion } from './harness.js';
import { KLINGON_MARKS, KlingonTracker, LEGEND, MARK_GLYPHS, mark_use, markDefs_make, markIcon_make, shieldRing_build, svg, type MarkKind } from './marks.js';
import {
  BRIDGE_COMMANDS, bearing_compute, question_control, range_compute, readout_build, readout_diff, score_compute,
  type BridgeCommand, type BridgeReadout, type ChartCell, type DeviceState, type KlingonSeen, type QuestionControl, type SectorCell, type TrekQuestion,
} from './model.js';
import { beam_play, burst_play, course_between, crossing_compute, FrameQueue, lineEvent_parse, lrsBloom_play, rescan_set, ringFlare_play, slide_play, Torpedo, PACE, type Frame, type LineEvent } from './motion.js';
import { chartCode_make, chartTitle_format, commandPill_make, commandPills_show, ComputerView, EngineeringView, HelmStation, TacticalStation, type StationHost } from './stations.js';

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

/** How many log lines are kept. */
const LOG_LIMIT: number = 400;

/** The scan's drawing: a sector is one unit; the axes sit in the margin. */
const SCAN_VIEWBOX: string = '-0.6 -0.6 10.6 10.6';

/** How much of a sector a mark fills. */
const MARK_SIZE: number = 0.7;

/** The devices the standing order and the Klingon marks depend on, by the C's names. */
const SRSCAN_NAME: RegExp = /^S\.R\. scanners$/i;
const LRSCAN_NAME: RegExp = /^L\.R\. scanners$/i;

/** The arrow keys that walk the scan, as row and column steps. */
const ARROW_STEPS: Readonly<Record<string, [number, number]>> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };

/** The questions that stand on the strip whatever their control: the setup's, and the engine's own. */
const STRIP_QUESTIONS: ReadonlyArray<TrekQuestion> = ['length', 'skill', 'request', 'quadrant', 'quadrant-y', 'sector', 'sector-y', 'range', 'computer-distance', 'computer-warp', 'status-report', 'another', 'yes-no', 'unknown'];

/**
 * The bridge over a game.
 */
export class TrekBridge {
  /** The screen's root, appended to the body by the host and shown while a game runs. */
  public readonly root: HTMLElement;
  /** The ARGUS frame the bridge is drawn in. */
  private readonly frame: TakeoverFrame;
  private readonly harness: TrekHarness;
  private readout: BridgeReadout | null = null;
  private previous: BridgeReadout | null = null;
  private view: BridgeView = 'bridge';
  private nextDistance: number | null = null;
  private readonly plan: Map<TrekQuestion, string> = new Map<TrekQuestion, string>();
  private answering: boolean = false;
  private computerRunning: boolean = false;
  private leaving: boolean = false;
  /** Which Klingon wears which mark. */
  private readonly tracker: KlingonTracker = new KlingonTracker();
  /** The course last committed to the engine: the way the ship's mark points. */
  private heading: number = 0;
  /** The sector last pressed, outlined on the scan. */
  private pressedSector: XY | null = null;
  /** A long-range scan is owed at the next Command: prompt (the standing order: at the start, and on arriving in a quadrant). */
  private scanDue: boolean = false;
  /** The log's open fold, while a standing order's lines print. */
  private fold: HTMLElement | null = null;
  /** The frames' clock: the engine's lines and states replay in order, and the log scrolls with the picture. */
  private readonly frames: FrameQueue = new FrameQueue();
  /** The picture as drawn, a copy of the readout that frames move things on before the next readout lands. */
  private shown: BridgeReadout | null = null;
  /** A torpedo in flight on the scan, while its track prints. */
  private torpedo: Torpedo | null = null;
  /** Whether the engine is printing a torpedo track, so a bare pair of decimals is a point of it. */
  private trackPrinting: boolean = false;
  /** Text the engine printed without a newline yet. */
  private partial: string = '';
  /** A long-range cell owed a bloom at the next draw: a quadrant a Klingon fled to, or one Starfleet reported. */
  private lrsBloom: { at: XY; hostile: boolean } | null = null;
  private readonly parts: {
    seed: HTMLElement; views: Map<BridgeView, HTMLButtonElement>; body: HTMLElement;
    condition: HTMLElement; conditionWhy: HTMLElement; ship: HTMLElement; mission: HTMLElement; position: HTMLElement; since: HTMLElement;
    lrs: HTMLElement; chart: HTMLElement; scan: SVGElement; srsTitle: HTMLElement; legend: HTMLElement;
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
      question_changed: (open: OpenQuestion | null): void => { this.partial_flush(); this.question_show(open); },
      text_written: (text: string): void => this.text_take(text),
      state_shown: (state: TrekState): void => this.state_show(state),
      ended: (): void => { if (!this.leaving) this.hooks.voice.cue('gameover'); },
    });
    // The frame is ARGUS's own (features/takeover/frame.ts): the bridge fills
    // its seat with the seed, its face with the readouts, its stage with the
    // stations and its log with the ship's.
    this.frame = takeoverFrame_build({
      id: 'trek-bridge',
      className: 'trek-bridge',
      brand: { name: 'TREK', sub: 'ARGUS · BSD TREK', mark: false },
      banner: 'TREK • THE BRIDGE',
      views: VIEWS.map((view: BridgeView) => ({ key: view, label: view.toUpperCase() })),
      leave: { label: 'LEAVE BRIDGE', destroy: true },
      stage: { title: 'THE BRIDGE', note: 'BRIDGE' },
      log: { title: 'SHIP\'S LOG', note: 'READ ONLY' },
      labels: { views: 'views', log: 'ship\'s log' },
    }, (key: string): void => {
      const view: BridgeView | undefined = VIEWS.find((each: BridgeView): boolean => each === key);
      if (view !== undefined) this.view_set(view);
    }, (): void => this.leave_ask());
    this.frame.leave.classList.add('tb-leave');
    this.root = this.frame.root;
    this.root.dataset['view'] = 'bridge';
    this.frame.view_mark('bridge');
    this.root.setAttribute('aria-label', 'trek: the bridge');
    const parts: BridgeParts = {};
    const defs: SVGElement | null = markDefs_make();
    if (defs !== null) this.root.append(defs);
    this.gutter_build(parts, seed);
    this.frame.face.append(this.header_build(parts));
    this.frame.body.append(this.body_build(parts));
    this.strip_build(parts);
    this.frame.aside.append(parts.ask as HTMLElement);
    this.frame.log.append(this.log_build(parts));
    this.leaveAsk_build(parts);
    this.root.append(parts.leaveAsk as HTMLElement);
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
   * Fills the frame's gutter: the seed in the seat, the views as its seats.
   *
   * @param parts - Where the live elements are registered.
   * @param seed - The game's seed, or null.
   */
  private gutter_build(parts: BridgeParts, seed: number | null): void {
    parts.seed = el('div', 'tb-seed', seed === null ? 'RANDOM GALAXY' : `SEED ${seed}`);
    this.frame.seat.append(parts.seed);
    parts.views = new Map<BridgeView, HTMLButtonElement>();
    for (const view of VIEWS) {
      const button: HTMLButtonElement | undefined = this.frame.views.get(view);
      if (button === undefined) continue;
      button.classList.add('tb-view', `tb-view-${view}`);
      parts.views.set(view, button);
    }
  }

  /**
   * Builds the header: condition, ship, mission (with what moved since the last command), position.
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
    // what moved since the last command sits under the mission: three groups share the width, and a value is never cut short to make room for a fourth
    const sinceGrid: HTMLElement = el('div', 'tb-head-grid tb-head-since');
    missionSection.append(el('span', 'tb-head-title', 'SINCE LAST COMMAND'), sinceGrid);
    parts.ship = shipGrid; parts.mission = missionGrid; parts.position = positionGrid; parts.since = sinceGrid;
    header.append(condition, shipSection, missionSection, positionSection);
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

    const srsSection: HTMLElement = el('section', 'tb-srs-section');
    parts.srsTitle = el('span', 'tb-title', 'SHORT RANGE');
    srsSection.append(parts.srsTitle);
    parts.scan = svg('svg', { class: 'tb-scan', viewBox: SCAN_VIEWBOX, role: 'grid', 'aria-label': 'short range scan' });
    parts.scan.addEventListener('keydown', (event: KeyboardEvent): void => this.scan_key(event));
    parts.legend = this.legend_build();
    srsSection.append(parts.scan, el('span', 'tb-note', 'PRESS A SECTOR: ITS COURSE AND DISTANCE FILL IN'), parts.legend);
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
   * Builds the legend under the scan: each mark beside the C's glyph for it, the four Klingon marks together.
   *
   * @returns The legend.
   */
  private legend_build(): HTMLElement {
    const legend: HTMLElement = el('div', 'tb-legend');
    for (const row of LEGEND) {
      const item: HTMLElement = el('span', `tb-legend-item tb-legend-${row.kind}`);
      const variants: ReadonlyArray<string | null> = row.kind === 'klingon' ? KLINGON_MARKS : [null];
      for (const variant of variants) item.append(markIcon_make(row.kind, variant));
      item.append(el('span', 'tb-legend-glyph', MARK_GLYPHS[row.kind].trim() === '' ? '␠' : MARK_GLYPHS[row.kind]), el('span', 'tb-legend-name', row.name));
      legend.append(item);
    }
    return legend;
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
    parts.log = el('div', 'tb-log');
    parts.log.setAttribute('aria-live', 'polite');
    footer.append(parts.log);
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
    this.frames.skip();
    if (this.parts.leaveAsk.hidden) this.hooks.voice.pill('LEAVE BRIDGE');
    this.parts.leaveAsk.hidden = false;
  }

  /**
   * What the picture has played, for a smoke scenario or a test: frames by kind, and what still waits.
   *
   * @returns The tally.
   */
  public frames_get(): { played: Record<string, number>; pending: number; busy: boolean } {
    return { played: { ...this.frames.played }, pending: this.frames.pending_count(), busy: this.frames.busy_is() };
  }

  /**
   * Resolves once the picture has caught up with the engine, for a test.
   *
   * @returns When no frame waits.
   */
  public frames_settle(): Promise<void> {
    return this.frames.settle();
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
    this.frames.skip();
    this.view = view;
    this.root.dataset['view'] = view;
    this.parts.body.dataset['view'] = view;
    this.frame.view_mark(view);
    for (const [name, button] of this.parts.views) button.classList.toggle('tb-view-on', name === view);
    this.frame.stageNote.textContent = view.toUpperCase();
    this.hooks.voice.pill(pillLabel_format(view.toUpperCase(), 'view'));
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
    this.frames.skip();
    if (!this.harness.command_send(command)) { this.hooks.voice.cue('deny'); return false; }
    const cue = commandCue_find(command.id);
    if (cue === null) this.hooks.voice.pill(pillLabel_format(command.label, 'command'));
    else this.hooks.voice.cue(cue);
    this.nextDistance = null;
    this.computerRunning = command.id === 'computer';
    if (this.computerRunning) this.parts.computerView.answer_take(null);
    this.log_write(`Command: ${command.line}\n`, true);
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
    const cue = open === null ? null : answerCue_derive(open.question, open.command?.id ?? null);
    if (cue !== null) this.hooks.voice.cue(cue);
    else if (label !== null) this.hooks.voice.pill(label);
    // the log keeps the transcript's shape: the prompt the engine left open, then the answer
    const prompt: string = open === null ? '' : open.prompt.trim();
    this.log_write(`${prompt === '' ? '' : `${prompt} `}${line}\n`, true);
    // the ship's mark turns to the course the moment it is committed, and keeps its heading after the move
    if (open?.question === 'course' && Number.isFinite(Number(line))) {
      this.heading = ((Number(line) % 360) + 360) % 360;
      if (this.shown !== null) this.srs_draw(this.shown);
    }
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
    const arrived: boolean = this.previous === null
      || this.previous.position.quadrant.x !== readout.position.quadrant.x || this.previous.position.quadrant.y !== readout.position.quadrant.y;
    // the Klingons' marks: carried by the engine's lines while the short-range sensors print them, by list order when they do not
    this.tracker.reconcile(readout.klingons, { reset: arrived, byOrder: !this.device_isOk(readout, SRSCAN_NAME) });
    for (const k of readout.klingons) k.mark = this.tracker.mark_find(k);
    if (arrived) this.pressedSector = null;
    // the standing order: a long-range scan at the first prompt and on arriving somewhere, when the long-range sensors work
    if (arrived && this.device_isOk(readout, LRSCAN_NAME)) this.scanDue = true;
    // the readouts and the controls take the state at once; the picture takes it in its turn, after the lines before it
    parts.condition.textContent = readout.condition.name;
    parts.condition.parentElement?.setAttribute('data-condition', readout.condition.name.toLowerCase());
    parts.conditionWhy.textContent = readout.condition.why.toUpperCase();
    this.header_draw(readout);
    for (const station of [parts.helm, parts.helmView, parts.tactical, parts.tacticalView, parts.computerView]) station.state_show(readout);
    parts.engineeringView.state_show(readout, this.previous);
    this.partial_flush();
    this.frames.push(this.stateFrame_make(readout, this.previous));
    this.question_show(this.harness.question_get());
  }

  /**
   * The frame that lands a state on the picture: the ship's move from where it was drawn to where the state says, as one slide or as a crossing, then the scans and the chart drawn afresh and the state's cues.
   *
   * @param readout - The readout.
   * @param previous - The readout before it, for the cues.
   * @returns The frame.
   */
  private stateFrame_make(readout: BridgeReadout, previous: BridgeReadout | null): Frame {
    return {
      kind: 'state',
      run: async (instant: boolean): Promise<void> => {
        const scan: SVGElement = this.parts.scan;
        await this.torpedo_end(true);
        const shown: BridgeReadout | null = this.shown;
        const crossed: boolean = shown !== null && (shown.position.quadrant.x !== readout.position.quadrant.x || shown.position.quadrant.y !== readout.position.quadrant.y);
        const moved: boolean = shown !== null && (crossed || shown.position.sector.x !== readout.position.sector.x || shown.position.sector.y !== readout.position.sector.y);
        if (moved && shown !== null) {
          const from = { x: shown.position.quadrant.x * 10 + shown.position.sector.x, y: shown.position.quadrant.y * 10 + shown.position.sector.y };
          const to = { x: readout.position.quadrant.x * 10 + readout.position.sector.x, y: readout.position.quadrant.y * 10 + readout.position.sector.y };
          this.heading = Math.round(course_between(from, to));
        }
        const ship = { kind: 'ship' as const, variant: null };
        if (moved && !instant && shown !== null && !crossed) {
          this.srs_draw(shown, false);
          await slide_play(scan, this.frames, ship, shown.position.sector, readout.position.sector, { heading: this.heading });
        } else if (moved && !instant && shown !== null && crossed) {
          const { exit, entry } = crossing_compute(shown.position, readout.position);
          this.srs_draw(shown, false);
          await slide_play(scan, this.frames, ship, shown.position.sector, exit, { heading: this.heading });
          rescan_set(scan, true);
          this.shown = readout_copy(readout);
          this.srs_draw(this.shown, false);
          this.lrs_draw(this.shown, true);
          this.chart_draw(this.shown);
          await this.frames.wait(PACE.rescan);
          rescan_set(scan, false);
          await slide_play(scan, this.frames, ship, entry, readout.position.sector, { heading: this.heading });
        }
        this.shown = readout_copy(readout);
        this.srs_draw(this.shown);
        this.lrs_draw(this.shown, crossed && instant);
        this.chart_draw(this.shown);
        for (const cue of stateCues_derive(previous, readout)) this.hooks.voice.cue(cue);
        this.standingOrder_try();
      },
    };
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
      ['SCORE', `${score_compute(readout).total}`],
    ]);
    const since = this.previous === null ? [] : readout_diff(this.previous, readout);
    pairs(parts.since, since.length === 0 ? [['—', 'NOTHING MOVED']] : since.map((line): [string, string, string] => [line.label, line.change, line.bad ? 'tb-bad' : 'tb-good']));
  }

  /**
   * Draws the short-range scan as one picture: a sector is a focusable cell with its mark, the ship wears its shield ring and points along the committed course, each Klingon wears its own mark and faces the ship. A sector pressed fills the course and distance to it.
   *
   * @param readout - The picture to draw.
   * @param withShip - False while the ship's mark is sliding on the motion layer instead.
   */
  private srs_draw(readout: BridgeReadout, withShip: boolean = true): void {
    const { parts } = this;
    parts.srsTitle.textContent = `SHORT RANGE · QUADRANT ${readout.position.quadrant.x},${readout.position.quadrant.y}`;
    const scan: SVGElement = parts.scan;
    const motion: SVGElement[] = [...scan.querySelectorAll<SVGElement>(':scope > .tb-motion')];
    scan.replaceChildren();
    const columns: number = readout.sectors[0]?.length ?? 0;
    for (let y: number = 0; y < columns; y++) scan.append(this.axis_make(String(y), y + 0.5, -0.3));
    for (const row of readout.sectors) scan.append(this.axis_make(String(row[0]?.x ?? ''), -0.3, (row[0]?.x ?? 0) + 0.5));
    const here: XY = readout.position.sector;
    const focusAt: XY = this.pressedSector ?? here;
    for (const row of readout.sectors) {
      for (const cell of row) scan.append(this.sector_make(cell, readout, here, focusAt, withShip));
    }
    if (withShip) {
      const ring = shieldRing_build(readout.ship.shield, readout.ship.shieldMax, readout.ship.shieldsUp, readout.condition.name === 'DOCKED');
      const ringNode: SVGElement = svg('circle', { class: ring.className, cx: here.y + 0.5, cy: here.x + 0.5, r: 0.46, 'stroke-width': ring.width });
      ringNode.dataset['percent'] = String(Math.round(ring.percent));
      scan.append(ringNode);
    }
    // whatever was in flight stays above the redrawn cells
    scan.append(...motion);
  }

  /**
   * Makes one axis label of the scan.
   *
   * @param text - The number.
   * @param x - Its centre across.
   * @param y - Its centre down.
   * @returns The label.
   */
  private axis_make(text: string, x: number, y: number): SVGElement {
    const label: SVGElement = svg('text', { class: 'tb-scan-axis', x, y });
    label.textContent = text;
    return label;
  }

  /**
   * Makes one sector of the scan: a pressable cell carrying its mark.
   *
   * @param cell - The sector.
   * @param readout - The readout.
   * @param here - The ship's sector.
   * @param focusAt - The one sector in the tab order.
   * @param withShip - False to leave the ship's own cell bare while its mark slides.
   * @returns The cell.
   */
  private sector_make(cell: SectorCell, readout: BridgeReadout, here: XY, focusAt: XY, withShip: boolean = true): SVGElement {
    const bearing: number = bearing_compute(here, cell);
    const range: number = range_compute(here, cell);
    const pressed: boolean = this.pressedSector?.x === cell.x && this.pressedSector.y === cell.y;
    const node: SVGElement = svg('g', { class: `tb-sector tb-sector-${cell.kind}${pressed ? ' tb-pressed' : ''}`, role: 'button', tabindex: focusAt.x === cell.x && focusAt.y === cell.y ? 0 : -1 });
    node.dataset['x'] = String(cell.x);
    node.dataset['y'] = String(cell.y);
    const title: SVGElement = svg('title', {});
    const glyph: string = cell.kind === 'empty' ? '·' : MARK_GLYPHS[cell.kind];
    title.textContent = cell.kind === 'ship' ? `the ship · ${cell.x},${cell.y}` : `${cell.x},${cell.y} ${glyph.trim() === '' ? 'black hole' : glyph} · course ${Math.round(bearing)}° · ${(range / 10).toFixed(1)}`;
    node.append(title, svg('rect', { class: 'tb-cell', x: cell.y + 0.04, y: cell.x + 0.04, width: 0.92, height: 0.92, rx: 0.16 }));
    if (cell.kind === 'empty' || (cell.kind === 'ship' && !withShip)) node.append(svg('circle', { class: 'tb-cell-dot', cx: cell.y + 0.5, cy: cell.x + 0.5, r: 0.03 }));
    else {
      const kind: MarkKind = cell.kind;
      const klingon: KlingonSeen | undefined = kind === 'klingon' ? readout.klingons.find((k: KlingonSeen): boolean => k.x === cell.x && k.y === cell.y) : undefined;
      const turn: number = kind === 'ship' ? this.heading : kind === 'klingon' ? bearing_compute(cell, here) : 0;
      const mark: SVGElement = mark_use(kind, { cx: cell.y + 0.5, cy: cell.x + 0.5, size: MARK_SIZE }, klingon?.mark ?? null, turn);
      // stars breathe out of step: each starts its cycle at its own moment
      if (kind === 'star') mark.style.setProperty('--tb-breathe', `-${((cell.x * 7 + cell.y * 3) % 11) * 0.33}s`);
      node.append(mark);
    }
    const press = (): void => this.sector_press(cell, bearing, range);
    node.addEventListener('click', press);
    node.addEventListener('keydown', (event: KeyboardEvent): void => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); press(); } });
    return node;
  }

  /**
   * The arrow keys walk the scan from the focused sector.
   *
   * @param event - The key.
   */
  private scan_key(event: KeyboardEvent): void {
    const step: [number, number] | undefined = ARROW_STEPS[event.key];
    const from: SVGElement | null = (event.target as Element | null)?.closest<SVGElement>('.tb-sector') ?? null;
    if (step === undefined || from === null) return;
    const x: number = Number(from.dataset['x']) + step[0];
    const y: number = Number(from.dataset['y']) + step[1];
    const to: SVGElement | null = this.parts.scan.querySelector<SVGElement>(`.tb-sector[data-x="${x}"][data-y="${y}"]`);
    if (to === null) return;
    event.preventDefault();
    from.setAttribute('tabindex', '-1');
    to.setAttribute('tabindex', '0');
    to.focus();
  }

  /**
   * A sector pressed: the wheels point at it, the distance sliders are set to it (in quadrants: a sector is a tenth), the computer's course panel aims at it, and the scan outlines it.
   *
   * @param cell - The sector.
   * @param bearing - The course to the sector.
   * @param range - The distance to it, in sectors.
   */
  private sector_press(cell: XY, bearing: number, range: number): void {
    this.hooks.voice.cue('scanner');
    this.course_set(bearing, Math.round(range) / 10);
    this.parts.computerView.sector_set(cell);
    this.pressedSector = { x: cell.x, y: cell.y };
    for (const node of this.parts.scan.querySelectorAll<SVGElement>('.tb-sector')) {
      const isPressed: boolean = node.dataset['x'] === String(cell.x) && node.dataset['y'] === String(cell.y);
      node.classList.toggle('tb-pressed', isPressed);
      node.setAttribute('tabindex', isPressed ? '0' : '-1');
    }
  }

  /**
   * Whether a device works, by the C's name for it.
   *
   * @param readout - The readout.
   * @param name - The name.
   * @returns True when it is not under repair.
   */
  private device_isOk(readout: BridgeReadout, name: RegExp): boolean {
    const device: DeviceState | undefined = readout.devices.find((d: DeviceState): boolean => name.test(d.name));
    return device === undefined || device.repairAt === null;
  }

  /**
   * Draws the long-range scan: the three-by-three of quadrants around the ship, from the chart; space outside the galaxy is an edge. A cell owed a bloom blooms: the quadrant just entered, or one a Klingon fled to.
   *
   * @param readout - The picture to draw.
   * @param arrived - True when the ship has just entered this quadrant: its cell blooms.
   */
  private lrs_draw(readout: BridgeReadout, arrived: boolean = false): void {
    const { parts } = this;
    parts.lrs.replaceChildren();
    const { quadrant } = readout.position;
    const owed: { at: XY; hostile: boolean } | null = this.lrsBloom;
    this.lrsBloom = null;
    for (let dx: number = -1; dx <= 1; dx++) {
      for (let dy: number = -1; dy <= 1; dy++) {
        const cell: ChartCell | undefined = readout.chart[quadrant.x + dx]?.[quadrant.y + dy];
        if (cell === undefined) {
          const edge: HTMLElement = el('div', 'tb-lrs-cell tb-lrs-edge');
          edge.append(el('span', 'tb-lrs-code', '—'), el('span', 'tb-lrs-at', 'EDGE'));
          edge.title = 'outside the galaxy';
          parts.lrs.append(edge);
          continue;
        }
        const node: HTMLElement = el('div', `tb-lrs-cell${cell.here ? ' tb-here' : ''}${cell.klingons > 0 ? ' tb-hostile' : ''}${cell.code === null ? ' tb-unscanned' : ''}${cell.supernova ? ' tb-supernova' : ''}`);
        node.append(chartCode_make('tb-lrs-code', cell), el('span', 'tb-lrs-at', `${cell.x},${cell.y}`));
        node.title = chartTitle_format(cell);
        node.dataset['x'] = String(cell.x);
        node.dataset['y'] = String(cell.y);
        parts.lrs.append(node);
        if ((arrived && cell.here) || (owed !== null && owed.at.x === cell.x && owed.at.y === cell.y)) lrsBloom_play(node, owed !== null && !cell.here && owed.hostile);
      }
    }
  }

  /**
   * Draws the galaxy chart as the ship knows it: a code where it has scanned, the supernova mark where a quadrant died, nothing where it has not looked.
   *
   * @param readout - The readout.
   */
  private chart_draw(readout: BridgeReadout): void {
    const { parts } = this;
    parts.chart.replaceChildren();
    for (const row of readout.chart) {
      for (const cell of row) {
        const node: HTMLElement = chartCode_make(`tb-quadrant${cell.here ? ' tb-here' : ''}${cell.klingons > 0 ? ' tb-hostile' : ''}${cell.bases > 0 ? ' tb-based' : ''}${cell.code === null ? ' tb-unscanned' : ''}${cell.supernova ? ' tb-supernova' : ''}`, cell);
        node.title = chartTitle_format(cell);
        parts.chart.append(node);
      }
    }
  }

  /**
   * Lights the control that answers the open question, and dims the rest; a planned answer is given at once.
   *
   * @param open - The open question, or null while the engine runs.
   */
  private question_show(open: OpenQuestion | null): void {
    const { parts } = this;
    if (open?.question === 'command') {
      this.plan.clear();
      this.computerRunning = false;
      this.fold_close();
      if (this.standingOrder_try()) return;
    }
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
    this.lit_reveal();
  }

  /**
   * Scrolls the control that answers the open question into view: a station column shorter than its stations would otherwise hold the question below the fold, lit and unseen.
   */
  private lit_reveal(): void {
    const lit: Element | undefined = [...this.parts.body.querySelectorAll('.tb-lit')].find((node: Element): boolean => node.getClientRects().length > 0);
    if (lit !== undefined && typeof lit.scrollIntoView === 'function') lit.scrollIntoView({ block: 'nearest' });
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
   * The standing order, when one is owed and the Command: prompt is open: the long-range scan sent as the ship's own command, its lines folded in the log under one dim head.
   *
   * @returns True when it was sent.
   */
  private standingOrder_try(): boolean {
    if (!this.scanDue || this.answering || this.harness.question_get()?.question !== 'command') return false;
    this.scanDue = false;
    const quadrant: XY | undefined = this.readout?.position.quadrant;
    this.fold_open(`LONG RANGE SCAN · STANDING ORDER${quadrant === undefined ? '' : ` · QUADRANT ${quadrant.x},${quadrant.y}`}`);
    if (!this.harness.answer('l')) { this.fold_close(); return false; }
    this.log_write('Command: l\n', true);
    return true;
  }

  /**
   * Opens a fold in the log, in its turn among the lines: the lines that follow print under a head that opens on press.
   *
   * @param head - The head's words.
   */
  private fold_open(head: string): void {
    this.frames.push({
      kind: 'fold',
      run: (): void => {
        const fold: HTMLDetailsElement = el('details', 'tb-log-fold');
        fold.append(el('summary', 'tb-log-fold-head', head));
        this.parts.log.append(fold);
        this.fold = fold;
      },
    });
  }

  /**
   * Closes the open fold, in its turn: the lines after it print on the log itself.
   */
  private fold_close(): void {
    this.frames.push({ kind: 'fold', run: (): void => { this.fold = null; } });
  }

  /**
   * Takes the engine's text: each complete line becomes a frame, in order, that prints it in the log, is heard, and moves what the line says moved; a line not yet complete waits for its end.
   *
   * @param text - The text.
   */
  private text_take(text: string): void {
    // the engine's colour codes and its bell (the C rings it on a hit) are not words
    const clean: string = text.replace(/\x1b\[[0-9;]*m/g, '').replace(/\x07/g, '');
    if (this.computerRunning) this.parts.computerView.answer_take(clean);
    const pieces: string[] = (this.partial + clean).split('\n');
    this.partial = pieces.pop() ?? '';
    for (const line of pieces) this.line_take(line, false);
  }

  /**
   * A line the engine left without its newline is a line once the engine stops to ask or to show its state.
   */
  private partial_flush(): void {
    if (this.partial === '') return;
    const line: string = this.partial;
    this.partial = '';
    this.line_take(line, false);
  }

  /**
   * Writes a line of the bridge's own (a command, an answer) to the log, in its turn.
   *
   * @param text - The line, with its newline.
   * @param own - Always true here: the bridge's own words are never heard and move nothing.
   */
  private log_write(text: string, own: boolean = true): void {
    for (const line of text.replace(/\n$/, '').split('\n')) this.line_take(line, own);
  }

  /**
   * One complete line: the Klingon tracker reads it now (the next state may reconcile before its frame plays), and a frame prints it, sounds it and plays what it says, in its turn.
   *
   * @param line - The line.
   * @param own - True for a line the bridge sent, which is never heard and moves nothing.
   */
  private line_take(line: string, own: boolean): void {
    const event: LineEvent | null = own ? null : lineEvent_parse(line);
    const isPoint: boolean = event?.kind === 'torpedo-point';
    if (!own) this.tracker.line_hear(line);
    if (event?.kind === 'torpedo-head') this.trackPrinting = true;
    else if (!isPoint) this.trackPrinting = false;
    const played: LineEvent | null = isPoint && !this.trackPrinting ? null : event;
    this.frames.push({
      kind: played === null ? 'line' : played.kind,
      run: async (instant: boolean): Promise<void> => {
        this.log_append(line, own);
        if (own) return;
        for (const cue of lineCues_derive(line)) this.hooks.voice.cue(cue);
        if (played !== null) await this.event_play(played, instant);
      },
    });
  }

  /**
   * Appends a line to the log, in the open fold when there is one; the bridge's own lines are set apart from the engine's.
   *
   * @param line - The line.
   * @param own - True for a line the bridge sent.
   */
  private log_append(line: string, own: boolean = false): void {
    const { parts } = this;
    (this.fold ?? parts.log).append(el('div', own ? 'tb-log-line tb-log-own' : 'tb-log-line', line));
    while (parts.log.childElementCount > LOG_LIMIT) parts.log.firstElementChild?.remove();
    parts.log.scrollTop = parts.log.scrollHeight;
  }

  /**
   * Plays what a line says on the picture: the torpedo's next point, a Klingon's flight, a beam, a burst, the ring taking a hit.
   *
   * @param event - What the line says.
   * @param instant - Jump to the end state at once.
   */
  private async event_play(event: LineEvent, instant: boolean): Promise<void> {
    const shown: BridgeReadout | null = this.shown;
    const scan: SVGElement = this.parts.scan;
    if (shown === null) return;
    if (event.kind !== 'torpedo-point' && event.kind !== 'torpedo-head') await this.torpedo_end(instant);
    switch (event.kind) {
      case 'torpedo-head':
        await this.torpedo_end(true);
        this.torpedo = new Torpedo(scan, shown.position.sector);
        return;
      case 'torpedo-point':
        if (this.torpedo !== null) await this.torpedo.point_reach(this.frames, event.at, instant);
        return;
      case 'torpedo-end':
        return;
      case 'kill':
        await burst_play(scan, this.frames, event.at, 'kill', instant);
        this.shown_clear(event.at);
        return;
      case 'nova':
        this.hooks.voice.cue('nova');
        await burst_play(scan, this.frames, event.at, 'nova', instant);
        this.shown_clear(event.at);
        return;
      case 'misfire':
        this.hooks.voice.cue('deny');
        await burst_play(scan, this.frames, shown.position.sector, 'misfire', instant);
        return;
      case 'phaser':
        await beam_play(scan, this.frames, shown.position.sector, event.at, false, instant);
        return;
      case 'incoming': {
        this.hooks.voice.cue('shield');
        const flare: Promise<void> = ringFlare_play(scan, this.frames, instant);
        if (event.from !== null) await beam_play(scan, this.frames, event.from, shown.position.sector, true, instant);
        // the ring takes the absorbed share off, as the engine does: shield -= trunc(proportion × hit)
        const absorbed: number = Math.trunc((event.hit * event.absorb) / 100);
        shown.ship.shield = Math.max(0, shown.ship.shield - absorbed);
        this.srs_draw(shown);
        await flare;
        return;
      }
      case 'klingon-move': {
        this.hooks.voice.cue('klingon-pass');
        const variant: string | null = this.tracker.mark_find(event.to) ?? this.tracker.mark_find(event.from);
        this.shown_clear(event.from);
        this.srs_draw(shown);
        await slide_play(scan, this.frames, { kind: 'klingon', variant }, event.from, event.to, { hostile: true }, instant);
        this.shown_put(event.to, 'klingon', variant);
        return;
      }
      case 'klingon-escape': {
        this.hooks.voice.cue('klingon-pass');
        const variant: string | null = this.tracker.mark_find(event.from);
        const away = { x: Math.sign(event.quadrant.x - shown.position.quadrant.x), y: Math.sign(event.quadrant.y - shown.position.quadrant.y) };
        const edge = { x: away.x > 0 ? 10.2 : away.x < 0 ? -1.2 : event.from.x, y: away.y > 0 ? 10.2 : away.y < 0 ? -1.2 : event.from.y };
        this.shown_clear(event.from);
        this.srs_draw(shown);
        await slide_play(scan, this.frames, { kind: 'klingon', variant }, event.from, edge, { hostile: true }, instant);
        this.lrsBloom = { at: event.quadrant, hostile: true };
        return;
      }
      case 'supernova':
        this.hooks.voice.cue('supernova');
        await burst_play(scan, this.frames, event.at, 'supernova', instant);
        return;
      case 'supernova-report':
        this.hooks.voice.cue('supernova');
        this.lrsBloom = { at: event.quadrant, hostile: true };
        return;
      default:
        return;
    }
  }

  /**
   * Ends the torpedo in flight, if any.
   *
   * @param instant - Without its tail's fade.
   */
  private async torpedo_end(instant: boolean): Promise<void> {
    const torpedo: Torpedo | null = this.torpedo;
    if (torpedo === null) return;
    this.torpedo = null;
    await torpedo.end(this.frames, instant);
  }

  /**
   * Empties a sector on the picture: what was there is gone.
   *
   * @param at - The sector.
   */
  private shown_clear(at: XY): void {
    const shown: BridgeReadout | null = this.shown;
    if (shown === null) return;
    const cell: SectorCell | undefined = shown.sectors[at.x]?.[at.y];
    if (cell !== undefined) { cell.kind = 'empty'; cell.glyph = '.'; }
    shown.klingons = shown.klingons.filter((k: KlingonSeen): boolean => k.x !== at.x || k.y !== at.y);
    this.srs_draw(shown);
  }

  /**
   * Puts a Klingon on the picture at a sector, wearing its mark.
   *
   * @param at - The sector.
   * @param kind - What arrives (a Klingon).
   * @param variant - Its mark.
   */
  private shown_put(at: XY, kind: 'klingon', variant: string | null): void {
    const shown: BridgeReadout | null = this.shown;
    if (shown === null) return;
    const cell: SectorCell | undefined = shown.sectors[at.x]?.[at.y];
    if (cell !== undefined) { cell.kind = kind; cell.glyph = MARK_GLYPHS[kind]; }
    const here: XY = shown.position.sector;
    shown.klingons.push({ x: at.x, y: at.y, bearing: bearing_compute(here, at), range: range_compute(here, at), power: 0, mark: variant });
    this.srs_draw(shown);
  }
}

/**
 * A copy of a readout for the picture to move things on, leaving the engine's own untouched.
 *
 * @param readout - The readout.
 * @returns The copy.
 */
function readout_copy(readout: BridgeReadout): BridgeReadout {
  return JSON.parse(JSON.stringify(readout)) as BridgeReadout;
}
