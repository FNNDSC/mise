/**
 * @file The stations: HELM and TACTICAL, each a head, its command pills and
 * its controls, drawn small on the BRIDGE view and large on its own view;
 * ENGINEERING, the damage control report whole with the ship's reserves and
 * the rest slider; COMPUTER, the galaxy chart large and the computer's
 * requests as pills, with the answers drawn beside the engine's own words.
 *
 * A station talks to the bridge through `StationHost`: it answers the open
 * question, sends a command at the `Command:` prompt, plans the answers a
 * request's follow-up questions get, and points every wheel at a course.
 * Nothing here decides a rule: ranges and previews are presentation, and
 * the engine checks every line.
 *
 * @module
 */
import type { OpenQuestion } from './harness.js';
import { CourseWheel, el, pill_make, PillRow, ValueSlider, type WheelMark } from './controls.js';
import {
  BRIDGE_COMMANDS, arrival_of, course_calc, impulseCost_of, phaserEffect_of, question_control, readout_diff, repairTimes_of, score_of, warpCost_of,
  type BridgeCommand, type BridgeReadout, type ChartCell, type DeviceState, type KlingonSeen, type Place, type QuestionControl, type ScoreItem, type Station, type TrekQuestion,
} from './model.js';

/** What a station asks of the bridge. */
export interface StationHost {
  /** Answers the open question with a line. */
  answer_send: (line: string) => void;
  /** Sends a command at the Command: prompt; false when it is not open. */
  command_send: (command: BridgeCommand) => boolean;
  /** Plans the answers to questions that follow, given as they come; cleared at the next Command: prompt. */
  plan_set: (answers: ReadonlyArray<[TrekQuestion, string]>) => void;
  /** Points every wheel at a course and sets the distance sliders, in quadrants. */
  course_set: (degrees: number, distance: number | null) => void;
  /** Plays a sound by the host's name for it. */
  sound: (name: string) => void;
}

/** A station's head: its name, the step it is on, and a CANCEL pill for the question the C lets go of. */
export interface StationHead {
  /** The head. */
  root: HTMLElement;
  /** The step. */
  step: HTMLElement;
  /** The CANCEL pill, hidden when the open question has no "never mind". */
  cancel: HTMLButtonElement;
}

/**
 * Whether a question is one of some names.
 *
 * @param open - The open question.
 * @param names - The names.
 * @returns True when the open question is among them.
 */
export function question_isAmong(open: OpenQuestion | null, names: ReadonlyArray<TrekQuestion>): boolean {
  return open !== null && names.includes(open.question);
}

/**
 * Makes a station's head.
 *
 * @param name - The station's name.
 * @param host - The bridge, for the cancel line.
 * @returns The head.
 */
export function stationHead_make(name: string, host: StationHost): StationHead {
  const root: HTMLElement = el('div', 'tb-station-head');
  const step: HTMLElement = el('span', 'tb-station-step', '');
  const cancel: HTMLButtonElement = pill_make('tb-grave tb-cancel', 'CANCEL', (): void => { host.answer_send(cancel.dataset['line'] ?? ''); });
  cancel.hidden = true;
  root.append(el('span', 'tb-station-name', name), step, el('span', 'tb-station-fill'), cancel);
  return { root, step, cancel };
}

/**
 * Writes a station's step and shows CANCEL when the question has a "never mind".
 *
 * @param head - The head.
 * @param station - Whose head it is.
 * @param open - The open question.
 * @param control - Its control, or null.
 */
export function stationHead_show(head: StationHead, station: Station, open: OpenQuestion | null, control: QuestionControl | null): void {
  const command: BridgeCommand | null = open?.command ?? null;
  const mine: boolean = command !== null && command.station === station && open !== null && open.question !== 'command';
  head.step.textContent = mine && command !== null && open !== null
    ? `${command.label} · ${open.question.replace(/-/g, ' ').toUpperCase()}`
    : open?.question === 'command' ? 'READY' : '';
  const cancel: string | undefined = mine ? control?.cancel : undefined;
  head.cancel.hidden = cancel === undefined;
  head.cancel.dataset['line'] = cancel ?? '';
  head.cancel.textContent = command === null ? 'CANCEL' : `CANCEL ${command.label}`;
}

/**
 * Makes a command pill: pressed at the Command: prompt it sends the command's line.
 *
 * @param command - The command.
 * @param host - The bridge.
 * @returns The pill.
 */
export function commandPill_make(command: BridgeCommand, host: StationHost): HTMLButtonElement {
  const button: HTMLButtonElement = pill_make(`tb-command${command.grave === true ? ' tb-grave' : ''}`, command.label, (): void => { host.command_send(command); });
  button.dataset['command'] = command.id;
  return button;
}

/**
 * Makes a station's row of command pills.
 *
 * @param station - Whose commands.
 * @param host - The bridge.
 * @returns The row and its pills by id.
 */
export function commandPills_make(station: Station, host: StationHost): { root: HTMLElement; pills: Map<string, HTMLButtonElement> } {
  const root: HTMLElement = el('div', 'tb-pills tb-command-pills');
  const pills: Map<string, HTMLButtonElement> = new Map<string, HTMLButtonElement>();
  for (const command of BRIDGE_COMMANDS.filter((c: BridgeCommand): boolean => c.station === station)) {
    const pill: HTMLButtonElement = commandPill_make(command, host);
    pills.set(command.id, pill);
    root.append(pill);
  }
  return { root, pills };
}

/**
 * Lights the command pills at the Command: prompt and marks the one whose questions are open.
 *
 * @param pills - The pills by id.
 * @param open - The open question.
 */
export function commandPills_show(pills: ReadonlyMap<string, HTMLButtonElement>, open: OpenQuestion | null): void {
  for (const [id, pill] of pills) {
    pill.disabled = open?.question !== 'command';
    pill.classList.toggle('tb-pill-on', open?.command?.id === id);
  }
}

/**
 * The marks a wheel carries: the Klingons in the quadrant and a starbase here.
 *
 * @param readout - The readout.
 * @returns The marks.
 */
export function wheelMarks_of(readout: BridgeReadout): WheelMark[] {
  const marks: WheelMark[] = readout.klingons.map((k: KlingonSeen): WheelMark => ({ bearing: k.bearing, kind: 'klingon', label: `Klingon at ${k.x},${k.y} · ${k.range.toFixed(1)} · ${Math.round(k.bearing)}°` }));
  for (const row of readout.sectors) {
    for (const cell of row) {
      if (cell.kind !== 'base') continue;
      const dx: number = cell.x - readout.position.sector.x;
      const dy: number = cell.y - readout.position.sector.y;
      marks.push({ bearing: ((Math.atan2(dy, -dx) * 180) / Math.PI + 360) % 360, kind: 'base', label: `starbase at ${cell.x},${cell.y}` });
    }
  }
  return marks;
}

/** HELM: the course wheel and the sliders for distance, warp factor and rest. */
export class HelmStation {
  public readonly root: HTMLElement;
  public readonly wheel: CourseWheel;
  public readonly distance: ValueSlider;
  public readonly warp: ValueSlider;
  public readonly rest: ValueSlider;
  private readonly head: StationHead;
  private readonly pills: Map<string, HTMLButtonElement>;
  private readout: BridgeReadout | null = null;

  /**
   * Builds the station.
   *
   * @param host - The bridge.
   * @param size - The wheel's size in CSS pixels.
   * @param prefix - The prefix of the sliders' ids, unique per copy.
   */
  constructor(host: StationHost, size: number, prefix: string) {
    this.root = el('div', 'tb-station tb-station-helm');
    this.head = stationHead_make('HELM', host);
    const commands = commandPills_make('helm', host);
    this.pills = commands.pills;
    const controls: HTMLElement = el('div', 'tb-controls');
    this.wheel = new CourseWheel(size, 'course wheel', (degrees: number): void => host.answer_send(String(degrees)));
    const sliders: HTMLElement = el('div', 'tb-sliders');
    this.distance = new ValueSlider(`${prefix}-distance`, 'DISTANCE', 1, (value: number): void => host.answer_send(value.toFixed(1)));
    this.warp = new ValueSlider(`${prefix}-warp`, 'WARP FACTOR', 1, (value: number): void => host.answer_send(value.toFixed(1)));
    this.rest = new ValueSlider(`${prefix}-rest`, 'REST', 1, (value: number): void => host.answer_send(value.toFixed(1)));
    this.distance.input_listen((): void => this.arrival_note());
    sliders.append(this.distance.root, this.warp.root, this.rest.root);
    controls.append(this.wheel.root, sliders);
    this.root.append(this.head.root, commands.root, controls);
  }

  /**
   * Draws the state: the marks, and the sliders' ranges (dimmed, a slider is a readout).
   *
   * @param readout - The readout.
   */
  public state_show(readout: BridgeReadout): void {
    const first: boolean = this.readout === null;
    this.readout = readout;
    this.wheel.marks_set(wheelMarks_of(readout));
    this.warp.range_set(question_control('warp-factor', readout), readout.ship.warp, 'THE SHIP NOW · ABOVE 6 THE ENGINES MAY BURN', 10);
    this.distance.range_set(question_control('distance', readout), first ? 1 : this.distance.value_get(), 'QUADRANTS · 0.1 IS ONE SECTOR', 6);
    this.rest.range_set(question_control('how-long', readout), 0, `STARDATES · ${readout.mission.timeLeft.toFixed(1)} LEFT · REPAIRS RUN WHILE TIME PASSES`, 2);
  }

  /**
   * Lights the control that answers the open question.
   *
   * @param open - The open question.
   */
  public question_show(open: OpenQuestion | null): void {
    commandPills_show(this.pills, open);
    const control: QuestionControl | null = open === null ? null : question_control(open.question, this.readout);
    stationHead_show(this.head, 'helm', open, control);
    this.wheel.lit_set(question_isAmong(open, ['course', 'direction']), 'SET COURSE');
    this.distance.lit_set(question_isAmong(open, ['distance']), 'ENGAGE');
    this.warp.lit_set(question_isAmong(open, ['warp-factor']), 'SET WARP');
    this.rest.lit_set(question_isAmong(open, ['how-long']), 'REST');
    if (open?.question === 'distance') this.arrival_note();
  }

  private arrival_note(): void {
    if (this.readout === null) return;
    const distance: number = this.distance.value_get();
    const at: Place = arrival_of(this.readout, this.wheel.degrees_get(), distance);
    const cost = warpCost_of(distance, this.readout.ship.warp, this.readout.param.warptime);
    this.distance.note_set(`ARRIVES ${at.quadrant.x},${at.quadrant.y} / ${at.sector.x},${at.sector.y} · ${cost.stardates.toFixed(2)} STARDATES AT WARP ${this.readout.ship.warp.toFixed(1)} · ${cost.units} UNITS`);
  }
}

/** TACTICAL: the firing wheel with Klingons at their bearings, phasers, torpedoes, shields. */
export class TacticalStation {
  public readonly root: HTMLElement;
  public readonly wheel: CourseWheel;
  public readonly units: ValueSlider;
  public readonly spread: ValueSlider;
  private readonly head: StationHead;
  private readonly pills: Map<string, HTMLButtonElement>;
  private readonly burst: PillRow;
  private readonly burstAngle: PillRow;
  private readonly manual: PillRow;
  private readonly upDown: PillRow;
  private readonly fire: HTMLButtonElement;
  private readonly targets: HTMLElement;
  private readout: BridgeReadout | null = null;

  /**
   * Builds the station.
   *
   * @param host - The bridge.
   * @param size - The wheel's size in CSS pixels.
   * @param prefix - The prefix of the sliders' ids, unique per copy.
   */
  constructor(private readonly host: StationHost, size: number, prefix: string) {
    this.root = el('div', 'tb-station tb-station-tactical');
    this.head = stationHead_make('TACTICAL', host);
    const commands = commandPills_make('tactical', host);
    this.pills = commands.pills;
    const controls: HTMLElement = el('div', 'tb-controls');
    this.wheel = new CourseWheel(size, 'firing course wheel', (degrees: number): void => host.answer_send(String(degrees)));
    const rows: HTMLElement = el('div', 'tb-sliders');
    this.burst = new PillRow('BURST', question_control('burst', null).choices ?? [], (line: string): void => host.answer_send(line));
    this.burstAngle = new PillRow('BURST ANGLE', question_control('burst-angle', null).choices ?? [], (line: string): void => { this.wheel.wedge_set(Number(line)); host.answer_send(line); });
    this.manual = new PillRow('PHASERS', question_control('manual-automatic', null).choices ?? [], (line: string): void => host.answer_send(line));
    this.units = new ValueSlider(`${prefix}-units`, 'UNITS', 0, (value: number): void => host.answer_send(String(Math.round(value))));
    this.spread = new ValueSlider(`${prefix}-spread`, 'SPREAD', 2, (value: number): void => host.answer_send(value.toFixed(2)));
    this.upDown = new PillRow('SHIELDS', question_control('up-down', null).choices ?? [], (line: string): void => host.answer_send(line));
    const fireRow: HTMLElement = el('div', 'tb-fire-row');
    this.fire = pill_make('tb-fire', 'FIRE', (): void => host.answer_send('0'));
    this.targets = el('div', 'tb-targets');
    fireRow.append(this.fire, this.targets);
    rows.append(this.burst.root, this.burstAngle.root, this.manual.root, this.units.root, this.spread.root, this.upDown.root, fireRow);
    controls.append(this.wheel.root, rows);
    this.root.append(this.head.root, commands.root, controls);
  }

  /**
   * Draws the state: the targets, the marks, the ranges and the notes.
   *
   * @param readout - The readout.
   */
  public state_show(readout: BridgeReadout): void {
    this.readout = readout;
    this.wheel.marks_set(wheelMarks_of(readout));
    this.wheel.wedge_set(null);
    if (readout.klingons[0] !== undefined) this.wheel.degrees_set(readout.klingons[0].bearing);
    this.units.range_set(question_control('units', readout), Math.min(readout.ship.energy, Math.round(readout.ship.energy / 100) * 10), `UP TO THE ${readout.ship.energy} FREE`, 6);
    this.spread.range_set(question_control('spread', readout), 0.5, 'MANUAL PHASERS ONLY', 3);
    this.burst.note_set(`${readout.ship.torpedoes} TORPEDOES · A BURST FIRES 3`);
    this.upDown.note_set(`${readout.ship.shieldsUp ? 'UP' : 'DOWN'} · ${readout.ship.shield} OF ${readout.ship.shieldMax} · REFILLS AT A STARBASE`);
    this.targets_draw(readout);
  }

  /**
   * Lights the control that answers the open question.
   *
   * @param open - The open question.
   */
  public question_show(open: OpenQuestion | null): void {
    commandPills_show(this.pills, open);
    const control: QuestionControl | null = open === null ? null : question_control(open.question, this.readout);
    stationHead_show(this.head, 'tactical', open, control);
    this.wheel.lit_set(question_isAmong(open, ['torpedo-course', 'bank-course']), 'SET COURSE');
    this.burst.lit_set(question_isAmong(open, ['burst']));
    this.burstAngle.lit_set(question_isAmong(open, ['burst-angle']));
    this.manual.lit_set(question_isAmong(open, ['manual-automatic']));
    this.units.lit_set(question_isAmong(open, ['units', 'bank-units']), open?.question === 'units' ? 'FIRE' : 'SET BANK');
    this.spread.lit_set(question_isAmong(open, ['spread']));
    this.upDown.lit_set(question_isAmong(open, ['up-down']));
    // in manual mode a bank of 0 units ends the banks and fires what is set
    this.fire.disabled = !question_isAmong(open, ['bank-units']);
    this.fire.textContent = 'FIRE THE BANKS SET';
  }

  private targets_draw(readout: BridgeReadout): void {
    this.targets.replaceChildren();
    if (readout.klingons.length === 0) { this.targets.append(el('span', 'tb-note', 'NO KLINGONS IN THIS QUADRANT')); return; }
    for (const word of ['TARGET', 'RANGE', 'BEARING', 'PHASER HIT']) this.targets.append(el('span', 'tb-target-head', word));
    for (const k of readout.klingons) {
      const row: HTMLButtonElement = pill_make('tb-target', `K ${k.x},${k.y}`, (): void => this.host.course_set(k.bearing, k.range / 10));
      this.targets.append(row, el('span', 'tb-target-cell', k.range.toFixed(1)), el('span', 'tb-target-cell', `${Math.round(k.bearing)}°`), el('span', 'tb-target-cell', `${phaserEffect_of(k.range / 10)}%`));
    }
  }
}

/** ENGINEERING: the damage control report whole, the ship's reserves, and rest. */
export class EngineeringView {
  public readonly root: HTMLElement;
  public readonly rest: ValueSlider;
  private readonly head: StationHead;
  private readonly pills: Map<string, HTMLButtonElement>;
  private readonly damage: HTMLElement;
  private readonly systems: HTMLElement;
  private readonly since: HTMLElement;
  private readonly inThatTime: HTMLElement;
  private readout: BridgeReadout | null = null;

  /**
   * Builds the view.
   *
   * @param host - The bridge.
   */
  constructor(host: StationHost) {
    this.root = el('div', 'tb-view-body tb-view-engineering');
    const damageSection: HTMLElement = el('section', 'tb-panel tb-damage');
    damageSection.append(el('span', 'tb-title', 'DAMAGE CONTROL'), el('span', 'tb-note', "THE C'S REPORT · ALWAYS ON"));
    this.damage = el('div', 'tb-dc');
    damageSection.append(this.damage, el('span', 'tb-note', 'REPAIR TIMES IN STARDATES · REPAIRS RUN WHILE TIME PASSES · DOCKED, FASTER BY THE DOCK FACTOR'));
    const shipSection: HTMLElement = el('section', 'tb-panel tb-systems-section');
    shipSection.append(el('span', 'tb-title', 'SHIP'), el('span', 'tb-note', 'ENERGY, SHIELDS, RESERVES'));
    this.systems = el('div', 'tb-systems');
    shipSection.append(this.systems, el('span', 'tb-title', 'SINCE THE LAST COMMAND'));
    this.since = el('div', 'tb-head-grid tb-since-grid');
    shipSection.append(this.since, el('span', 'tb-note', 'SHIELDS ARE UP OR DOWN IN TREK(6): THEIR ENERGY IS A READOUT, REFILLED AT A STARBASE'));
    const timeSection: HTMLElement = el('section', 'tb-panel tb-station tb-station-time');
    this.head = stationHead_make('REST', host);
    const pills: HTMLElement = el('div', 'tb-pills tb-command-pills');
    this.pills = new Map<string, HTMLButtonElement>();
    for (const id of ['rest', 'dock', 'undock']) {
      const command: BridgeCommand | undefined = BRIDGE_COMMANDS.find((c: BridgeCommand): boolean => c.id === id);
      if (command === undefined) continue;
      const pill: HTMLButtonElement = commandPill_make(command, host);
      this.pills.set(id, pill);
      pills.append(pill);
    }
    this.rest = new ValueSlider('tbe-rest', 'HOW LONG', 1, (value: number): void => host.answer_send(value.toFixed(1)));
    this.rest.input_listen((): void => this.inThatTime_note());
    this.inThatTime = el('div', 'tb-in-that-time');
    timeSection.append(this.head.root, pills, this.rest.root, el('span', 'tb-title', 'IN THAT TIME'), this.inThatTime);
    this.root.append(damageSection, shipSection, timeSection);
  }

  /**
   * Draws the state.
   *
   * @param readout - The readout.
   * @param previous - The readout before it, for what changed; null at the first.
   */
  public state_show(readout: BridgeReadout, previous: BridgeReadout | null): void {
    this.readout = readout;
    this.damage_draw(readout);
    this.systems_draw(readout);
    this.since.replaceChildren();
    const lines = previous === null ? [] : readout_diff(previous, readout);
    if (lines.length === 0) this.since.append(el('span', 'tb-head-label', '—'), el('span', 'tb-head-value', 'NOTHING MOVED'));
    for (const line of lines) this.since.append(el('span', 'tb-head-label', line.label), el('span', `tb-head-value ${line.bad ? 'tb-bad' : 'tb-good'}`, line.change));
    this.rest.range_set(question_control('how-long', readout), this.rest.value_get(), `STARDATES · ${readout.mission.timeLeft.toFixed(1)} LEFT`, 4);
    this.inThatTime_note();
  }

  /**
   * Lights the rest slider when the engine asks how long.
   *
   * @param open - The open question.
   */
  public question_show(open: OpenQuestion | null): void {
    commandPills_show(this.pills, open);
    const control: QuestionControl | null = open === null ? null : question_control(open.question, this.readout);
    const mine: OpenQuestion | null = open !== null && (open.command === null || ['rest', 'dock', 'undock'].includes(open.command.id)) ? open : null;
    stationHead_show(this.head, 'helm', mine, control);
    this.rest.lit_set(question_isAmong(open, ['how-long']), 'REST');
  }

  private damage_draw(readout: BridgeReadout): void {
    this.damage.replaceChildren();
    for (const word of ['DEVICE', '', 'IN FLIGHT', 'DOCKED', '']) this.damage.append(el('span', 'tb-dc-head', word));
    const longest: number = Math.max(1, ...readout.damaged.map((d: DeviceState): number => (d.repairAt ?? 0) - readout.mission.stardate));
    for (const device of readout.devices) {
      const times = repairTimes_of(device, readout);
      const bar: HTMLElement = el('div', 'tb-bar-track');
      const fill: HTMLElement = el('div', `tb-bar-fill${times === null ? ' tb-bar-ok' : ' tb-bar-down'}`);
      fill.style.width = times === null ? '100%' : `${Math.max(4, Math.min(100, Math.round((100 * ((device.repairAt ?? 0) - readout.mission.stardate)) / longest)))}%`;
      bar.append(fill);
      this.damage.append(
        el('span', `tb-dc-name${times === null ? '' : ' tb-bad'}`, device.name.toUpperCase()), bar,
        el('span', 'tb-dc-time', times === null ? '—' : times.inFlight.toFixed(2)), el('span', 'tb-dc-time', times === null ? '—' : times.docked.toFixed(2)),
        el('span', `tb-dc-state${times === null ? ' tb-good' : ' tb-bad'}`, times === null ? 'OK' : 'DOWN'),
      );
    }
  }

  private systems_draw(readout: BridgeReadout): void {
    const { ship } = readout;
    this.systems.replaceChildren();
    const gauge = (label: string, value: number, max: number, text: string, bad: boolean): void => {
      const track: HTMLElement = el('div', 'tb-bar-track');
      const fill: HTMLElement = el('div', `tb-bar-fill${bad ? ' tb-bar-down' : ' tb-bar-ok'}`);
      fill.style.width = `${Math.max(0, Math.min(100, Math.round((100 * value) / Math.max(1, max))))}%`;
      track.append(fill);
      this.systems.append(el('span', 'tb-dc-name', label), track, el('span', 'tb-dc-time tb-sys-value', text));
    };
    gauge('ENERGY', ship.energy, ship.energyMax, `${ship.energy} / ${ship.energyMax}`, ship.energy < ship.energyMax / 4);
    gauge('SHIELDS', ship.shield, ship.shieldMax, `${ship.shieldsUp ? 'UP' : 'DOWN'} · ${ship.shield} / ${ship.shieldMax}`, ship.shield < ship.shieldMax / 4);
    gauge('LIFE SUPPORT', ship.reserves, ship.reservesMax, `RESERVES ${ship.reserves.toFixed(1)} / ${ship.reservesMax.toFixed(1)}`, ship.reserves < ship.reservesMax / 4);
    const pips: HTMLElement = el('div', 'tb-pips');
    for (let i: number = 0; i < ship.torpedoesMax; i++) pips.append(el('span', `tb-pip${i < ship.torpedoes ? ' tb-pip-on' : ''}`));
    this.systems.append(el('span', 'tb-dc-name', 'TORPEDOES'), pips, el('span', 'tb-dc-time tb-sys-value', `${ship.torpedoes} / ${ship.torpedoesMax}`));
    const plain = (label: string, text: string): void => { this.systems.append(el('span', 'tb-dc-name', label), el('span', 'tb-sys-text', text)); };
    plain('CREW', `${ship.crew}${readout.mission.captives > 0 ? ` · ${readout.mission.captives} CAPTIVE` : ' · BRIG EMPTY'}`);
    const warpDown: boolean = readout.damaged.some((d: DeviceState): boolean => /warp/i.test(d.name));
    plain('WARP', `${ship.warp.toFixed(1)} · ENGINES ${warpDown ? 'DOWN' : 'OK'}`);
    const cloakDown: boolean = readout.damaged.some((d: DeviceState): boolean => /cloak/i.test(d.name));
    plain('CLOAK', `${ship.cloaked ? 'ON' : 'OFF'} · DEVICE ${cloakDown ? 'DOWN' : 'OK'}`);
  }

  private inThatTime_note(): void {
    if (this.readout === null) return;
    const span: number = this.rest.value_get();
    this.inThatTime.replaceChildren();
    const repaired: string[] = this.readout.damaged
      .filter((d: DeviceState): boolean => (repairTimes_of(d, this.readout as BridgeReadout)?.inFlight ?? Infinity) <= span)
      .map((d: DeviceState): string => d.name.toUpperCase());
    this.inThatTime.append(el('span', 'tb-head-value tb-good', repaired.length === 0 ? (span > 0 ? 'NO REPAIR COMPLETES' : '—') : `${repaired.join(' · ')} REPAIRED`));
    const klingons: number = this.readout.klingons.length;
    if (klingons > 0) this.inThatTime.append(el('span', 'tb-head-value tb-bad', `${klingons} KLINGON${klingons === 1 ? '' : 'S'} IN THE QUADRANT WILL FIRE · SPOCK MAY ASK TO CANCEL`));
  }
}

/** The computer's requests: the pill's word, its line at `Request:`, and the questions the request then asks. */
const REQUESTS: ReadonlyArray<{ label: string; line: string; asks: ReadonlyArray<TrekQuestion> }> = [
  { label: 'CHART', line: 'ch', asks: [] },
  { label: 'TRAJECTORY', line: 't', asks: [] },
  { label: 'COURSE', line: 'c', asks: ['quadrant', 'quadrant-y', 'sector', 'sector-y'] },
  { label: 'MOVE', line: 'm', asks: ['quadrant', 'quadrant-y', 'sector', 'sector-y'] },
  { label: 'SCORE', line: 's', asks: [] },
  { label: 'PHASER EFFECT', line: 'p', asks: ['range'] },
  { label: 'WARP COST', line: 'w', asks: ['computer-distance', 'computer-warp'] },
  { label: 'IMPULSE COST', line: 'i', asks: ['computer-distance'] },
  { label: 'DISTRESS LIST', line: 'd', asks: [] },
];

/** COMPUTER: the galaxy chart large, the requests as pills, and the answers drawn. */
export class ComputerView {
  public readonly root: HTMLElement;
  private readonly head: StationHead;
  private readonly chart: HTMLElement;
  private readonly requestPills: HTMLButtonElement[] = [];
  private readonly courseGrid: HTMLElement;
  private readonly wcDistance: ValueSlider;
  private readonly wcWarp: ValueSlider;
  private readonly wcResult: HTMLElement;
  private readonly trajectory: HTMLElement;
  private readonly score: HTMLElement;
  private readonly answer: HTMLElement;
  private readout: BridgeReadout | null = null;
  private target: Place | null = null;
  private open: OpenQuestion | null = null;
  private warpTouched: boolean = false;

  /**
   * Builds the view.
   *
   * @param host - The bridge.
   */
  constructor(private readonly host: StationHost) {
    this.root = el('div', 'tb-view-body tb-view-computer');
    const chartSection: HTMLElement = el('section', 'tb-panel tb-chart-section');
    chartSection.append(el('span', 'tb-title', 'GALAXY · WHAT THE SHIP HAS SEEN'), el('span', 'tb-note', 'PRESS A QUADRANT: THE COURSE PANEL AIMS AT IT · HUNDREDS KLINGONS, TENS BASES, ONES STARS'));
    this.chart = el('div', 'tb-chart-big');
    chartSection.append(this.chart);
    const station: HTMLElement = el('section', 'tb-station tb-station-computer');
    this.head = stationHead_make('COMPUTER', host);
    const pills: HTMLElement = el('div', 'tb-pills tb-command-pills');
    for (const request of REQUESTS) {
      const pill: HTMLButtonElement = pill_make('tb-command tb-request', request.label, (): void => this.request_send(request));
      pill.dataset['request'] = request.line;
      this.requestPills.push(pill);
      pills.append(pill);
    }
    const panels: HTMLElement = el('div', 'tb-computer-panels');
    const course: HTMLElement = el('div', 'tb-panel');
    course.append(el('span', 'tb-title', 'COURSE AND DISTANCE'));
    this.courseGrid = el('div', 'tb-head-grid');
    const courseRow: HTMLElement = el('div', 'tb-pills');
    courseRow.append(
      pill_make('tb-commit tb-send-helm', 'SEND TO HELM', (): void => this.helm_send()),
      pill_make('tb-commit tb-move-now', 'MOVE THERE NOW', (): void => this.request_send(REQUESTS[3] as typeof REQUESTS[number])),
    );
    course.append(this.courseGrid, courseRow);
    const costs: HTMLElement = el('div', 'tb-panel');
    costs.append(el('span', 'tb-title', 'WARP COST'));
    this.wcDistance = new ValueSlider('tbc-distance', 'DISTANCE', 2, (): void => undefined);
    this.wcWarp = new ValueSlider('tbc-warp', 'WARP FACTOR', 1, (): void => undefined);
    this.wcDistance.root.classList.add('tb-local');
    this.wcWarp.root.classList.add('tb-local');
    this.wcDistance.input_listen((): void => this.costs_note());
    this.wcWarp.input_listen((): void => { this.warpTouched = true; this.costs_note(); });
    this.wcResult = el('div', 'tb-head-grid');
    costs.append(this.wcDistance.root, this.wcWarp.root, this.wcResult);
    const tables: HTMLElement = el('div', 'tb-panel');
    tables.append(el('span', 'tb-title', 'TRAJECTORY · KLINGONS HERE'));
    this.trajectory = el('div', 'tb-targets');
    tables.append(this.trajectory, el('span', 'tb-title', 'SCORE SO FAR'));
    this.score = el('div', 'tb-score');
    tables.append(this.score);
    const answerPanel: HTMLElement = el('div', 'tb-panel tb-answer-panel');
    answerPanel.append(el('span', 'tb-title', 'THE COMPUTER ANSWERS'));
    this.answer = el('pre', 'tb-computer-answer', '—');
    answerPanel.append(this.answer);
    panels.append(course, costs, tables, answerPanel);
    station.append(this.head.root, pills, panels);
    this.root.append(chartSection, station);
  }

  /**
   * Draws the state: the chart, the course panel, the costs, the trajectory and the score.
   *
   * @param readout - The readout.
   */
  public state_show(readout: BridgeReadout): void {
    this.readout = readout;
    if (this.target === null) this.target = { quadrant: { ...readout.position.quadrant }, sector: { ...readout.position.sector } };
    this.chart_draw(readout);
    this.wcWarp.range_set(question_control('computer-warp', readout), this.warpTouched ? this.wcWarp.value_get() : readout.ship.warp, "THE SHIP'S NOW", 4);
    this.wcDistance.range_set(question_control('computer-distance', readout), this.wcDistance.value_get(), 'QUADRANTS · FILLED FROM THE COURSE', 4);
    this.wcDistance.lit_set(true, '');
    this.wcWarp.lit_set(true, '');
    this.course_note();
    this.trajectory_draw(readout);
    this.score_draw(readout);
  }

  /**
   * Lights the request pills at `Request:` and at `Command:` (where a request first sends `c`).
   *
   * @param open - The open question.
   */
  public question_show(open: OpenQuestion | null): void {
    this.open = open;
    const control: QuestionControl | null = open === null ? null : question_control(open.question, this.readout);
    stationHead_show(this.head, 'ship', open, control);
    const ready: boolean = open?.question === 'command' || open?.question === 'request';
    for (const pill of this.requestPills) pill.disabled = !ready;
  }

  /**
   * Takes the engine's words after a request, for the answer panel.
   *
   * @param text - The text, or null to start a new answer.
   */
  public answer_take(text: string | null): void {
    if (text === null) { this.answer.textContent = ''; return; }
    this.answer.textContent = `${this.answer.textContent ?? ''}${text}`.replace(/^\s*\n/, '');
  }

  /**
   * Aims the course panel at a sector; a scan press while the computer is open comes here.
   *
   * @param sector - The sector in the ship's quadrant.
   */
  public sector_set(sector: { x: number; y: number }): void {
    if (this.readout === null) return;
    this.target = { quadrant: this.target?.quadrant ?? { ...this.readout.position.quadrant }, sector: { x: sector.x, y: sector.y } };
    this.course_note();
  }

  private request_send(request: typeof REQUESTS[number]): void {
    const plan: Array<[TrekQuestion, string]> = request.asks.map((question: TrekQuestion): [TrekQuestion, string] => [question, this.plannedAnswer_of(question)]);
    if (this.open?.question === 'request') {
      this.host.plan_set(plan);
      this.answer_take(null);
      this.host.answer_send(request.line);
      return;
    }
    const computer: BridgeCommand | undefined = BRIDGE_COMMANDS.find((c: BridgeCommand): boolean => c.id === 'computer');
    if (computer === undefined || this.open?.question !== 'command') { this.host.sound('audio4'); return; }
    this.host.plan_set([['request', request.line], ...plan]);
    this.answer_take(null);
    this.host.command_send(computer);
  }

  private plannedAnswer_of(question: TrekQuestion): string {
    const target: Place | null = this.target;
    const nearest: KlingonSeen | undefined = this.readout?.klingons[0];
    switch (question) {
      case 'quadrant': return String(target?.quadrant.x ?? 0);
      case 'quadrant-y': return String(target?.quadrant.y ?? 0);
      case 'sector': return String(target?.sector.x ?? 0);
      case 'sector-y': return String(target?.sector.y ?? 0);
      case 'range': return (nearest === undefined ? this.wcDistance.value_get() : nearest.range / 10).toFixed(2);
      case 'computer-distance': return this.wcDistance.value_get().toFixed(2);
      case 'computer-warp': return this.wcWarp.value_get().toFixed(1);
      default: return '';
    }
  }

  private helm_send(): void {
    if (this.readout === null || this.target === null) return;
    const calc = course_calc(this.readout, this.target);
    this.host.course_set(calc.course, Math.round(calc.distance * 10) / 10);
  }

  private chart_draw(readout: BridgeReadout): void {
    this.chart.replaceChildren();
    this.chart.append(el('span', 'tb-srs-corner', ''));
    for (let y: number = 0; y < (readout.chart[0]?.length ?? 0); y++) this.chart.append(el('span', 'tb-srs-axis', String(y)));
    for (const row of readout.chart) {
      this.chart.append(el('span', 'tb-srs-axis', String(row[0]?.x ?? '')));
      for (const cell of row) this.chart.append(this.quadrantButton_make(cell));
    }
  }

  private quadrantButton_make(cell: ChartCell): HTMLButtonElement {
    const pressed: boolean = this.target?.quadrant.x === cell.x && this.target.quadrant.y === cell.y;
    const button: HTMLButtonElement = pill_make(`tb-cq${cell.here ? ' tb-here' : ''}${cell.klingons > 0 ? ' tb-hostile' : ''}${cell.bases > 0 ? ' tb-based' : ''}${cell.code === null ? ' tb-unscanned' : ''}${pressed ? ' tb-pressed' : ''}`, '', (): void => {
      if (this.readout === null) return;
      this.target = { quadrant: { x: cell.x, y: cell.y }, sector: this.target?.sector ?? { ...this.readout.position.sector } };
      this.host.sound('audio1');
      this.chart_draw(this.readout);
      this.course_note();
    });
    button.dataset['x'] = String(cell.x);
    button.dataset['y'] = String(cell.y);
    button.append(el('span', 'tb-cq-code', cell.code ?? '···'), el('span', 'tb-cq-at', `${cell.x},${cell.y}`));
    button.title = `quadrant ${cell.x},${cell.y}${cell.code === null ? ' · unscanned' : ''}`;
    return button;
  }

  private course_note(): void {
    if (this.readout === null || this.target === null) return;
    const { position } = this.readout;
    const calc = course_calc(this.readout, this.target);
    this.courseGrid.replaceChildren(
      el('span', 'tb-head-label', 'FROM'), el('span', 'tb-head-value', `QUADRANT ${position.quadrant.x},${position.quadrant.y} · SECTOR ${position.sector.x},${position.sector.y}`),
      el('span', 'tb-head-label', 'TO'), el('span', 'tb-head-value', `QUADRANT ${this.target.quadrant.x},${this.target.quadrant.y} · SECTOR ${this.target.sector.x},${this.target.sector.y}`),
      el('span', 'tb-head-label', 'COURSE'), el('span', 'tb-head-value tb-course-value', `${calc.course}°`),
      el('span', 'tb-head-label', 'DISTANCE'), el('span', 'tb-head-value tb-distance-value', calc.distance.toFixed(2)),
    );
    this.wcDistance.value_set(Math.round(calc.distance * 100) / 100);
    this.costs_note();
  }

  private costs_note(): void {
    if (this.readout === null) return;
    const distance: number = this.wcDistance.value_get();
    const warp = warpCost_of(distance, this.wcWarp.value_get(), this.readout.param.warptime);
    const impulse = impulseCost_of(distance);
    this.wcResult.replaceChildren(
      el('span', 'tb-head-label', 'TIME'), el('span', 'tb-head-value', `${warp.stardates.toFixed(2)} STARDATES`),
      el('span', 'tb-head-label', 'ENERGY'), el('span', 'tb-head-value', `${warp.units} UNITS · ${warp.unitsShielded} WITH SHIELDS UP`),
      el('span', 'tb-head-label', 'AT IMPULSE'), el('span', 'tb-head-value', `${impulse.stardates.toFixed(2)} STARDATES · ${impulse.units} UNITS`),
    );
  }

  private trajectory_draw(readout: BridgeReadout): void {
    this.trajectory.replaceChildren();
    if (readout.klingons.length === 0) { this.trajectory.append(el('span', 'tb-note', 'NO KLINGONS IN THIS QUADRANT')); return; }
    for (const word of ['AT', 'COURSE', 'RANGE', 'PHASER HIT']) this.trajectory.append(el('span', 'tb-target-head', word));
    for (const k of readout.klingons) {
      this.trajectory.append(
        pill_make('tb-target', `${k.x},${k.y}`, (): void => this.host.course_set(k.bearing, k.range / 10)),
        el('span', 'tb-target-cell', `${Math.round(k.bearing)}°`), el('span', 'tb-target-cell', k.range.toFixed(1)), el('span', 'tb-target-cell', `${phaserEffect_of(k.range / 10)}%`),
      );
    }
  }

  private score_draw(readout: BridgeReadout): void {
    const tally = score_of(readout);
    this.score.replaceChildren();
    for (const item of tally.items.filter((i: ScoreItem): boolean => i.points !== 0 || /killed|remaining/.test(i.label))) {
      this.score.append(el('span', 'tb-score-label', item.label.toUpperCase()), el('span', `tb-score-points${item.points < 0 ? ' tb-bad' : ' tb-good'}`, `${item.points > 0 ? '+' : ''}${item.points}`));
    }
    this.score.append(el('span', 'tb-score-label tb-score-total', 'TOTAL'), el('span', 'tb-score-points tb-score-total', String(tally.total)));
  }
}
