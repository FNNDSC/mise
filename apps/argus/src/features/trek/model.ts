/**
 * @file The bridge's reading of the game: the state the engine shows before
 * each command, turned into what the screen draws; the engine's questions,
 * named from their prompts; and the commands the bridge may send.
 *
 * Pure: no DOM, no wire. The engine is the authority on every rule; what is
 * here is presentation (a bearing for a wheel, a glyph's kind for a scan
 * cell, a prompt's name for a control) and never a decision the game would
 * make differently. Coordinates are the C's: `Sect[x][y]` with x the row
 * printed down the scan and y the column across it, and a course of 0 runs
 * up the scan (x decreasing), 90 to the right (y increasing), clockwise.
 *
 * @module
 */
import {
  BASE, Device, DOCKED, E_EVENT, E_FIXDV, E_GHOST, ENTERPRISE, GREEN, HOLE, INHABIT, KLINGON, NQUADS, NSECTS, QUEENE, RED, STAR, YELLOW,
  type TrekEvent, type TrekState, type XY,
} from 'bsd-trek/host';

/** What a sector of the short-range scan holds. */
export type SectorKind = 'ship' | 'klingon' | 'base' | 'star' | 'inhabited' | 'hole' | 'empty';

/** One sector of the short-range scan. */
export interface SectorCell {
  /** The row (the C's x). */
  x: number;
  /** The column (the C's y). */
  y: number;
  /** What the sector holds. */
  kind: SectorKind;
  /** The C's glyph for it. */
  glyph: string;
}

/** One quadrant of the galaxy chart, as the ship knows it. */
export interface ChartCell {
  /** The row (the C's x). */
  x: number;
  /** The column (the C's y). */
  y: number;
  /** Whether the ship is here. */
  here: boolean;
  /** The C's three-digit code (hundreds Klingons, tens bases, ones stars), `///` for a supernova, null when never scanned. */
  code: string | null;
  /** Whether the quadrant died in a supernova (the C's `///`). */
  supernova: boolean;
  /** Klingons the last scan saw; 0 when unscanned. */
  klingons: number;
  /** Starbases the last scan saw; 0 when unscanned. */
  bases: number;
}

/** A Klingon in the quadrant, as the ship sees it. */
export interface KlingonSeen {
  /** Its sector row. */
  x: number;
  /** Its sector column. */
  y: number;
  /** The course from the ship to it, in degrees (0 up, 90 right). */
  bearing: number;
  /** The distance from the ship to it, in sectors. */
  range: number;
  /** Its remaining power. */
  power: number;
  /** The mark it wears on the bridge, given by the tracker; null until it is. */
  mark: string | null;
}

/** A device and whether it is under repair. */
export interface DeviceState {
  /** The C's device index. */
  index: number;
  /** The device's name, as the crew reports it. */
  name: string;
  /** The crew member who fixes it. */
  person: string;
  /** The stardate its repair completes, or null when it works. */
  repairAt: number | null;
}

/** The condition's name, as the C's status report prints it. */
export type ConditionName = 'GREEN' | 'DOCKED' | 'YELLOW' | 'RED';

/** What the bridge draws of a game state. */
export interface BridgeReadout {
  /** The condition and why. */
  condition: { name: ConditionName; why: string };
  /** The ship's reserves and settings. */
  ship: {
    shipName: string; energy: number; energyMax: number; shield: number; shieldMax: number; shieldsUp: boolean; cloaked: boolean;
    torpedoes: number; torpedoesMax: number; reserves: number; reservesMax: number; crew: number; warp: number;
  };
  /** The mission's clock and counts. */
  mission: { stardate: number; timeLeft: number; klingonsLeft: number; klingonsStart: number; killed: number; captives: number; starbases: number };
  /** Where the ship is. */
  position: { quadrant: XY; sector: XY };
  /** The short-range scan, by row then column. */
  sectors: SectorCell[][];
  /** The Klingons in the quadrant, nearest first. */
  klingons: KlingonSeen[];
  /** The starbases' quadrants. */
  bases: XY[];
  /** The nearest starbase, by quadrant distance, with that distance; null when none is left. */
  nearestBase: { at: XY; range: number; here: boolean } | null;
  /** The galaxy chart, by row then column. */
  chart: ChartCell[][];
  /** Every device, in the C's order. */
  devices: DeviceState[];
  /** The devices under repair, soonest first. */
  damaged: DeviceState[];
  /** The game's tallies, as the score reads them. */
  game: { killk: number; killb: number; kills: number; killinhab: number; helps: number; captives: number; deaths: number; killed: boolean; skill: number; won: boolean; abandoned: boolean };
  /** The parameters the C's arithmetic uses: warp time, the dock factor, Klingon power, the start date. */
  param: { warptime: number; dockfac: number; klingpwr: number; date: number };
}

/** The C's condition names, by code. */
const CONDITION_NAMES: ReadonlyArray<ConditionName> = ['GREEN', 'DOCKED', 'YELLOW', 'RED'];

/**
 * The course from one point to another, in the C's degrees.
 *
 * The C moves along a course as `dx = -cos(angle), dy = sin(angle)`, so 0 runs up the scan and 90 to the right; this is its inverse.
 *
 * @param from - Where the course starts.
 * @param to - Where it points.
 * @returns The course in degrees, 0 up to 360 exclusive.
 */
export function bearing_of(from: XY, to: XY): number {
  const degrees: number = (Math.atan2(to.y - from.y, -(to.x - from.x)) * 180) / Math.PI;
  return (degrees + 360) % 360;
}

/**
 * The distance between two points, in their own units (sectors or quadrants).
 *
 * @param from - One point.
 * @param to - The other.
 * @returns The straight-line distance.
 */
export function range_of(from: XY, to: XY): number {
  return Math.hypot(to.x - from.x, to.y - from.y);
}

/**
 * What a sector's glyph stands for.
 *
 * @param glyph - The C's glyph.
 * @returns Its kind.
 */
export function sectorKind_of(glyph: string): SectorKind {
  switch (glyph) {
    case ENTERPRISE: case QUEENE: return 'ship';
    case KLINGON: return 'klingon';
    case BASE: return 'base';
    case STAR: return 'star';
    case INHABIT: return 'inhabited';
    case HOLE: return 'hole';
    default: return 'empty';
  }
}

/**
 * The devices with their repairs, read from the event queue as `dcrept` does.
 *
 * @param events - The game's pending events.
 * @returns Every device, in the C's order.
 */
function devices_read(events: ReadonlyArray<TrekEvent>): DeviceState[] {
  const repairs: Map<number, number> = new Map<number, number>();
  for (const event of events) {
    if ((event.evcode & E_EVENT) !== E_FIXDV || (event.evcode & E_GHOST) !== 0) continue;
    repairs.set(event.systemname, event.date);
  }
  // the C's table runs to NDEV with `*ERR*` names past the last device; those are no device
  return Device.map((device, index: number): DeviceState => ({ index, name: device.name, person: device.person, repairAt: repairs.get(index) ?? null }))
    .filter((device: DeviceState): boolean => !device.name.startsWith('*'));
}

/**
 * Why the condition is what it is, in the bridge's words.
 *
 * @param state - The game state.
 * @returns A short reason.
 */
function condition_why(state: TrekState): string {
  const klingons: number = state.Etc.nkling;
  switch (state.Ship.cond) {
    case RED: return klingons === 1 ? '1 Klingon in this quadrant' : `${klingons} Klingons in this quadrant`;
    case YELLOW: return state.Ship.energy < state.Param.energylow ? 'energy low' : 'Klingons near';
    case DOCKED: return 'docked at a starbase';
    case GREEN: default: return 'all clear';
  }
}

/**
 * Turns a game state into what the bridge draws.
 *
 * @param state - The state the engine showed.
 * @returns The readout.
 */
export function readout_build(state: TrekState): BridgeReadout {
  const { Ship, Now, Game, Param, Etc, Sect, Quad } = state;
  const here: XY = { x: Ship.quadx, y: Ship.quady };
  const sectorHere: XY = { x: Ship.sectx, y: Ship.secty };
  const sectors: SectorCell[][] = [];
  for (let x: number = 0; x < NSECTS; x++) {
    const row: SectorCell[] = [];
    for (let y: number = 0; y < NSECTS; y++) {
      const glyph: string = Sect[x]?.[y] ?? HOLE;
      row.push({ x, y, kind: sectorKind_of(glyph), glyph });
    }
    sectors.push(row);
  }
  const klingons: KlingonSeen[] = Etc.klingon.slice(0, Etc.nkling)
    .map((k): KlingonSeen => ({ x: k.x, y: k.y, bearing: bearing_of(sectorHere, k), range: range_of(sectorHere, k), power: k.power, mark: null }))
    .sort((a: KlingonSeen, b: KlingonSeen): number => a.range - b.range);
  const bases: XY[] = Now.base.slice(0, Now.bases).map((b): XY => ({ x: b.x, y: b.y }));
  let nearestBase: BridgeReadout['nearestBase'] = null;
  for (const base of bases) {
    const range: number = range_of(here, base);
    if (nearestBase === null || range < nearestBase.range) nearestBase = { at: base, range, here: range === 0 };
  }
  const chart: ChartCell[][] = [];
  for (let x: number = 0; x < NQUADS; x++) {
    const row: ChartCell[] = [];
    for (let y: number = 0; y < NQUADS; y++) {
      const quad = Quad[x]?.[y];
      const scanned: number = quad?.scanned ?? -1;
      const code: string | null = scanned < 0 ? null : scanned >= 1000 ? '///' : String(scanned).padStart(3, '0');
      row.push({ x, y, here: x === here.x && y === here.y, code, supernova: scanned >= 1000, klingons: scanned < 0 || scanned >= 1000 ? 0 : Math.floor(scanned / 100), bases: scanned < 0 || scanned >= 1000 ? 0 : Math.floor((scanned % 100) / 10) });
    }
    chart.push(row);
  }
  const devices: DeviceState[] = devices_read(state.Event);
  const damaged: DeviceState[] = devices.filter((d: DeviceState): boolean => d.repairAt !== null).sort((a: DeviceState, b: DeviceState): number => (a.repairAt ?? 0) - (b.repairAt ?? 0));
  return {
    condition: { name: CONDITION_NAMES[Ship.cond] ?? 'GREEN', why: condition_why(state) },
    ship: {
      shipName: Ship.shipname, energy: Ship.energy, energyMax: Param.energy, shield: Ship.shield, shieldMax: Param.shield, shieldsUp: Ship.shldup !== 0, cloaked: Ship.cloaked !== 0,
      torpedoes: Ship.torped, torpedoesMax: Param.torped, reserves: Ship.reserves, reservesMax: Param.reserves, crew: Ship.crew, warp: Ship.warp,
    },
    mission: { stardate: Now.date, timeLeft: Now.time, klingonsLeft: Now.klings, klingonsStart: Param.klings, killed: Game.killk, captives: Game.captives, starbases: Now.bases },
    position: { quadrant: here, sector: sectorHere },
    sectors, klingons, bases, nearestBase, chart, devices, damaged,
    game: {
      killk: Game.killk, killb: Game.killb, kills: Game.kills, killinhab: Game.killinhab, helps: Game.helps, captives: Game.captives, deaths: Game.deaths,
      killed: Game.killed !== 0, skill: Game.skill, won: state.Move.endgame > 0, abandoned: Ship.ship !== ENTERPRISE,
    },
    param: { warptime: Param.warptime, dockfac: Param.dockfac, klingpwr: Param.klingpwr, date: Param.date },
  };
}

/** One line of the score, as the C prints it. */
export interface ScoreItem {
  /** What it is for. */
  label: string;
  /** Its points, signed. */
  points: number;
}

/** The skills' names, by the C's number. */
const SKILL_NAMES: ReadonlyArray<string> = ['novice', 'fair', 'good', 'expert', 'commodore', 'impossible'];

/**
 * The score so far, item by item, as the C's `score()` counts it; the engine's own print at the end is the authority.
 *
 * @param readout - The readout.
 * @returns The items and their total.
 */
export function score_of(readout: BridgeReadout): { items: ScoreItem[]; total: number } {
  const { game, mission, param } = readout;
  const items: ScoreItem[] = [];
  items.push({ label: `${game.killk} Klingons killed`, points: Math.trunc(param.klingpwr / 4) * game.killk });
  const elapsed: number = Math.max(1, mission.stardate - param.date);
  const rate: number = game.killk / elapsed;
  items.push({ label: `kill rate ${rate.toFixed(2)} Klingons/stardate`, points: Math.trunc(400 * rate) });
  items.push({ label: `penalty for ${mission.klingonsLeft} Klingons remaining`, points: Math.trunc((-400 * mission.klingonsLeft) / (game.killk + 1)) });
  if (game.won) items.push({ label: `bonus for winning a ${SKILL_NAMES[game.skill - 1] ?? ''} game`, points: 100 * game.skill });
  if (game.killed) items.push({ label: 'penalty for getting killed', points: -500 });
  items.push({ label: `${game.killb} starbases killed`, points: -100 * game.killb });
  items.push({ label: `${game.helps} calls for help`, points: -100 * game.helps });
  items.push({ label: `${game.kills} stars destroyed`, points: -5 * game.kills });
  items.push({ label: `${game.killinhab} inhabited starsystems destroyed`, points: -150 * game.killinhab });
  if (game.abandoned) items.push({ label: 'penalty for abandoning ship', points: -200 });
  items.push({ label: `${game.captives} Klingons captured`, points: 3 * game.captives });
  items.push({ label: `${game.deaths} casualties`, points: -game.deaths });
  return { items, total: items.reduce((sum: number, item: ScoreItem): number => sum + item.points, 0) };
}

/** A place in the galaxy: a quadrant and a sector in it. */
export interface Place {
  /** The quadrant's row and column. */
  quadrant: XY;
  /** The sector's row and column. */
  sector: XY;
}

/**
 * The course and distance from the ship to a place, as the computer's `kalc` finds them: whole degrees, quadrants.
 *
 * @param readout - The readout, for where the ship is.
 * @param to - The place.
 * @returns The course in whole degrees and the distance in quadrants.
 */
export function course_calc(readout: BridgeReadout, to: Place): { course: number; distance: number } {
  const { quadrant, sector } = readout.position;
  const dx: number = quadrant.x + sector.x / NSECTS - (to.quadrant.x + to.sector.x / NSECTS);
  const dy: number = to.quadrant.y + to.sector.y / NSECTS - (quadrant.y + sector.y / NSECTS);
  let angle: number = Math.atan2(dy, dx);
  if (angle < 0) angle += 2 * Math.PI;
  return { course: Math.trunc((angle * 180) / Math.PI + 0.5) % 360, distance: Math.hypot(dx, dy) };
}

/**
 * Where a course and distance from the ship arrive, in the galaxy's sectors.
 *
 * @param readout - The readout, for where the ship is.
 * @param course - The course in degrees.
 * @param distance - The distance in quadrants.
 * @returns The place, clamped to the galaxy.
 */
export function arrival_of(readout: BridgeReadout, course: number, distance: number): Place {
  const { quadrant, sector } = readout.position;
  const a: number = (course * Math.PI) / 180;
  const x: number = Math.min(NQUADS * NSECTS - 1, Math.max(0, Math.round(quadrant.x * NSECTS + sector.x - Math.cos(a) * distance * NSECTS)));
  const y: number = Math.min(NQUADS * NSECTS - 1, Math.max(0, Math.round(quadrant.y * NSECTS + sector.y + Math.sin(a) * distance * NSECTS)));
  return { quadrant: { x: Math.trunc(x / NSECTS), y: Math.trunc(y / NSECTS) }, sector: { x: x % NSECTS, y: y % NSECTS } };
}

/**
 * What a warp move costs, as the computer's `warpcost` counts it.
 *
 * @param distance - The distance in quadrants.
 * @param warp - The warp factor.
 * @param warptime - The C's warp time parameter.
 * @returns The stardates and the units, and the units with shields up.
 */
export function warpCost_of(distance: number, warp: number, warptime: number): { stardates: number; units: number; unitsShielded: number } {
  const units: number = Math.trunc((distance + 0.05) * warp * warp * warp);
  return { stardates: (warptime * distance) / (warp * warp), units, unitsShielded: 2 * units };
}

/**
 * What an impulse move costs, as the computer's `impcost` counts it.
 *
 * @param distance - The distance in quadrants.
 * @returns The stardates and the units.
 */
export function impulseCost_of(distance: number): { stardates: number; units: number } {
  return { stardates: distance / 0.095, units: Math.trunc(20 + 100 * distance) };
}

/**
 * How effective phasers are at a range, as the computer's `pheff` counts it.
 *
 * @param range - The range in quadrants.
 * @returns The percentage.
 */
export function phaserEffect_of(range: number): number {
  return Math.trunc(Math.pow(0.9, range * 10) * 98 + 0.5);
}

/**
 * How long a device's repair takes, in flight and docked, as `dcrept` prints them.
 *
 * @param device - The device.
 * @param readout - The readout, for the date, the condition and the dock factor.
 * @returns The two times in stardates, or null when the device works.
 */
export function repairTimes_of(device: DeviceState, readout: BridgeReadout): { inFlight: number; docked: number } | null {
  if (device.repairAt === null) return null;
  const left: number = device.repairAt - readout.mission.stardate;
  const docked: boolean = readout.condition.name === 'DOCKED';
  const m1: number = docked ? 1 / readout.param.dockfac : 1;
  const m2: number = docked ? 1 : readout.param.dockfac;
  return { inFlight: left * m1 + 0.005, docked: left * m2 + 0.005 };
}

/**
 * What changed between two readouts, as the header's "since last command" lines.
 *
 * @param before - The earlier readout.
 * @param after - The later one.
 * @returns Lines of `label` and `change`, only for what moved.
 */
export function readout_diff(before: BridgeReadout, after: BridgeReadout): Array<{ label: string; change: string; bad: boolean }> {
  const lines: Array<{ label: string; change: string; bad: boolean }> = [];
  const signed = (n: number, digits: number): string => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toFixed(digits)}`;
  const stardate: number = after.mission.stardate - before.mission.stardate;
  if (Math.abs(stardate) >= 0.005) lines.push({ label: 'STARDATE', change: signed(stardate, 2), bad: false });
  const energy: number = after.ship.energy - before.ship.energy;
  if (energy !== 0) lines.push({ label: 'ENERGY', change: signed(energy, 0), bad: energy < 0 });
  const shield: number = after.ship.shield - before.ship.shield;
  if (shield !== 0) lines.push({ label: 'SHIELDS', change: signed(shield, 0), bad: shield < 0 });
  const torpedoes: number = after.ship.torpedoes - before.ship.torpedoes;
  if (torpedoes !== 0) lines.push({ label: 'TORPEDOES', change: signed(torpedoes, 0), bad: false });
  const klingons: number = after.mission.klingonsLeft - before.mission.klingonsLeft;
  if (klingons !== 0) lines.push({ label: 'KLINGONS', change: `${signed(klingons, 0)} · ${after.mission.klingonsLeft} LEFT`, bad: klingons > 0 });
  const newlyDown: DeviceState[] = after.damaged.filter((d: DeviceState): boolean => !before.damaged.some((e: DeviceState): boolean => e.index === d.index));
  if (newlyDown.length > 0) lines.push({ label: 'DAMAGE', change: newlyDown.map((d: DeviceState): string => d.name.toUpperCase()).join(' · '), bad: true });
  const repaired: DeviceState[] = before.damaged.filter((d: DeviceState): boolean => !after.damaged.some((e: DeviceState): boolean => e.index === d.index));
  if (repaired.length > 0) lines.push({ label: 'REPAIRED', change: repaired.map((d: DeviceState): string => d.name.toUpperCase()).join(' · '), bad: false });
  if (before.condition.name !== after.condition.name) lines.push({ label: 'CONDITION', change: after.condition.name, bad: after.condition.name === 'RED' });
  return lines;
}

/** The engine's questions, named; `unknown` is one the bridge has no control for and answers with a line typed. */
export type TrekQuestion =
  | 'return' | 'length' | 'skill' | 'password' | 'tournament'
  | 'command' | 'course' | 'distance' | 'warp-factor' | 'how-long'
  | 'manual-automatic' | 'units' | 'bank-units' | 'bank-course' | 'spread'
  | 'torpedo-course' | 'burst' | 'burst-angle'
  | 'up-down' | 'request' | 'quadrant' | 'quadrant-y' | 'sector' | 'sector-y' | 'range' | 'computer-distance' | 'computer-warp'
  | 'direction' | 'password-verify' | 'status-report' | 'another' | 'yes-no' | 'unknown';

/**
 * The prompts' tails and the questions they are, most specific first. Case matters: the helm asks `Course`, a phaser bank `course`; the helm `Distance`, the computer `distance`.
 */
const QUESTION_TAILS: ReadonlyArray<[string, TrekQuestion]> = [
  ['return to continue', 'return'],
  ['What length game', 'length'],
  ['What skill game', 'skill'],
  ['Enter password verification', 'password-verify'],
  ['Enter a password', 'password'],
  ['Enter tournament code', 'tournament'],
  ['Command', 'command'],
  ['Torpedo course', 'torpedo-course'],
  ['Course', 'course'],
  ['course', 'bank-course'],
  ['Distance', 'distance'],
  ['distance', 'computer-distance'],
  ['Warp factor', 'warp-factor'],
  ['warp factor', 'computer-warp'],
  ['How long', 'how-long'],
  ['Manual or automatic', 'manual-automatic'],
  ['Units to fire', 'units'],
  ['units', 'bank-units'],
  ['spread', 'spread'],
  ['Do you want a burst', 'burst'],
  ['burst angle', 'burst-angle'],
  ['Up or down', 'up-down'],
  ['Request', 'request'],
  ['Quadrant', 'quadrant'],
  ['q-y', 'quadrant-y'],
  ['Sector', 'sector'],
  ['s-y', 'sector-y'],
  ['range', 'range'],
  ['direction', 'direction'],
  ['status report', 'status-report'],
  ['Another game', 'another'],
];

/**
 * Names the question a prompt asks.
 *
 * A prompt is the line the engine left open: usually the question alone (`Course: `), sometimes with words before it on the same line, and once a sentence (`Press return to continue.`). The tail decides, with its colon or full stop off; the "are you sure" family is a yes/no wherever it appears.
 *
 * @param prompt - The prompt as the engine sent it.
 * @returns The question's name.
 */
export function question_classify(prompt: string): TrekQuestion {
  const tail: string = prompt.replace(/[:.\s]+$/, '');
  // A read with no prompt is the C waiting for a return: "Press return to continue" is printed, then the line is read bare.
  if (tail === '') return 'return';
  for (const [suffix, question] of QUESTION_TAILS) {
    if (tail.endsWith(suffix)) return question;
  }
  if (/wise$|certain that is wise$|Shall we cancel our rest period$/.test(tail)) return 'yes-no';
  return 'unknown';
}

/** The stations a command belongs to. */
export type Station = 'helm' | 'tactical' | 'ship';

/** A command the bridge can send at the `Command:` prompt. */
export interface BridgeCommand {
  /** Its id, the pill's name in lower case. */
  id: string;
  /** The pill's label. */
  label: string;
  /** Which station's pill it is. */
  station: Station;
  /** The line that names it to the engine (the C's abbreviation). */
  line: string;
  /** The questions the engine then asks, in order, when nothing stops it. */
  asks: ReadonlyArray<TrekQuestion>;
  /** Whether the pill stands apart as one that ends the game or the ship. */
  grave?: boolean;
}

/** The commands, by station; the C's command table under the bridge's names. */
export const BRIDGE_COMMANDS: ReadonlyArray<BridgeCommand> = [
  { id: 'move', label: 'MOVE', station: 'helm', line: 'm', asks: ['course', 'distance'] },
  { id: 'ram', label: 'RAM', station: 'helm', line: 'ram', asks: ['course', 'distance'] },
  { id: 'warp', label: 'WARP', station: 'helm', line: 'w', asks: ['warp-factor'] },
  { id: 'impulse', label: 'IMPULSE', station: 'helm', line: 'i', asks: ['course', 'distance'] },
  { id: 'dock', label: 'DOCK', station: 'helm', line: 'do', asks: [] },
  { id: 'undock', label: 'UNDOCK', station: 'helm', line: 'u', asks: [] },
  { id: 'rest', label: 'REST', station: 'helm', line: 'r', asks: ['how-long'] },
  { id: 'phasers', label: 'PHASERS', station: 'tactical', line: 'p', asks: ['manual-automatic', 'units'] },
  { id: 'torpedo', label: 'TORPEDO', station: 'tactical', line: 't', asks: ['torpedo-course', 'burst', 'burst-angle'] },
  { id: 'shields', label: 'SHIELDS', station: 'tactical', line: 'sh', asks: ['up-down'] },
  { id: 'cloak', label: 'CLOAK', station: 'tactical', line: 'cl', asks: ['up-down'] },
  { id: 'capture', label: 'CAPTURE', station: 'tactical', line: 'ca', asks: [] },
  { id: 'visual', label: 'VISUAL', station: 'tactical', line: 'v', asks: ['direction'] },
  { id: 'computer', label: 'COMPUTER', station: 'ship', line: 'c', asks: ['request'] },
  { id: 'help', label: 'CALL STARBASE', station: 'ship', line: 'help', asks: [] },
  { id: 'dump', label: 'DUMP', station: 'ship', line: 'dump', asks: [] },
  { id: 'credits', label: 'CREDITS', station: 'ship', line: 'cr', asks: [] },
  { id: 'abandon', label: 'ABANDON', station: 'ship', line: 'abandon', asks: [], grave: true },
  { id: 'destruct', label: 'DESTRUCT', station: 'ship', line: 'destruct', asks: ['password-verify'], grave: true },
  { id: 'terminate', label: 'TERMINATE', station: 'ship', line: 'terminate', asks: [], grave: true },
];

/** The control that answers a question. */
export type ControlKind = 'wheel' | 'slider' | 'pills' | 'yesno' | 'text' | 'auto';

/** How a question is answered: which control, and its range or choices. */
export interface QuestionControl {
  /** The control. */
  kind: ControlKind;
  /** A slider's least value. */
  min?: number;
  /** A slider's greatest value. */
  max?: number;
  /** A slider's step. */
  step?: number;
  /** Pills' choices: what the pill says and the line it sends. */
  choices?: ReadonlyArray<{ label: string; line: string }>;
  /** The pill that commits a wheel or slider. */
  commit?: string;
  /** The line that means "never mind" to this question, when the C has one. */
  cancel?: string;
}

/**
 * The control that answers a question, with its range read from the readout where the C reads it from the state.
 *
 * @param question - The question.
 * @param readout - The state as last shown; null before the first.
 * @returns The control.
 */
export function question_control(question: TrekQuestion, readout: BridgeReadout | null): QuestionControl {
  switch (question) {
    case 'return': return { kind: 'auto' };
    case 'length': return { kind: 'pills', choices: [{ label: 'SHORT', line: 's' }, { label: 'MEDIUM', line: 'm' }, { label: 'LONG', line: 'l' }, { label: 'RESTART', line: 'restart' }] };
    case 'skill': return { kind: 'pills', choices: [{ label: 'NOVICE', line: 'n' }, { label: 'FAIR', line: 'f' }, { label: 'GOOD', line: 'g' }, { label: 'EXPERT', line: 'e' }, { label: 'COMMODORE', line: 'c' }, { label: 'IMPOSSIBLE', line: 'i' }] };
    case 'password': case 'tournament': case 'password-verify': return { kind: 'auto' };
    case 'course': case 'torpedo-course': case 'direction': case 'bank-course': return { kind: 'wheel', min: 0, max: 360, step: 1, commit: 'SET COURSE', cancel: '-1' };
    case 'distance': return { kind: 'slider', min: 0, max: 15, step: 0.1, commit: 'ENGAGE', cancel: '-1' };
    case 'computer-distance': case 'range': return { kind: 'slider', min: 0, max: 15, step: 0.1, commit: 'SET' };
    case 'warp-factor': return { kind: 'slider', min: 1, max: 10, step: 0.1, commit: 'SET WARP', cancel: '-1' };
    case 'computer-warp': return { kind: 'slider', min: 1, max: 10, step: 0.1, commit: 'SET' };
    case 'how-long': return { kind: 'slider', min: 0, max: Math.max(0.1, readout?.mission.timeLeft ?? 15), step: 0.1, commit: 'REST', cancel: '0' };
    case 'manual-automatic': return { kind: 'pills', choices: [{ label: 'MANUAL', line: 'm' }, { label: 'AUTOMATIC', line: 'a' }] };
    case 'units': return { kind: 'slider', min: 0, max: Math.max(10, readout?.ship.energy ?? 5000), step: 10, commit: 'FIRE', cancel: '0' };
    case 'bank-units': return { kind: 'slider', min: 0, max: Math.max(10, readout?.ship.energy ?? 5000), step: 10, commit: 'SET', cancel: '0' };
    case 'spread': return { kind: 'slider', min: 0, max: 1, step: 0.05, commit: 'SET' };
    case 'burst': case 'status-report': case 'another': case 'yes-no': return { kind: 'yesno', choices: [{ label: 'YES', line: 'y' }, { label: 'NO', line: 'n' }] };
    case 'burst-angle': return { kind: 'pills', choices: [1, 2, 3, 5, 8, 10, 12, 15].map((n: number) => ({ label: `${n}°`, line: String(n) })), cancel: '0' };
    case 'up-down': return { kind: 'pills', choices: [{ label: 'UP', line: 'u' }, { label: 'DOWN', line: 'd' }] };
    case 'request': return { kind: 'pills', choices: [
      { label: 'CHART', line: 'ch' }, { label: 'TRAJECTORY', line: 't' }, { label: 'COURSE', line: 'c' }, { label: 'MOVE', line: 'm' }, { label: 'SCORE', line: 's' },
      { label: 'PHASER EFFECT', line: 'p' }, { label: 'WARP COST', line: 'w' }, { label: 'IMPULSE COST', line: 'i' }, { label: 'DISTRESS LIST', line: 'd' },
    ] };
    case 'quadrant': case 'quadrant-y': return { kind: 'slider', min: 0, max: NQUADS - 1, step: 1, commit: 'SET' };
    case 'sector': case 'sector-y': return { kind: 'slider', min: 0, max: NSECTS - 1, step: 1, commit: 'SET' };
    case 'command': case 'unknown': default: return { kind: 'text' };
  }
}
