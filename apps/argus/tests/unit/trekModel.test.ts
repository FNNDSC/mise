/**
 * @file The bridge's reading of a real game state, and its naming of the
 * engine's questions.
 *
 * The state comes from the engine itself: a seeded game played through
 * bsd-trek with the states it shows captured, so what the readout says is
 * checked against what the game printed for the same moment.
 */
import { describe, it, expect, beforeAll } from '@jest/globals';
import { trek_play } from 'bsd-trek';
import type { TrekState, TrekTerminal } from 'bsd-trek/host';
import {
  BRIDGE_COMMANDS, arrival_compute, bearing_compute, course_calc, impulseCost_compute, phaserEffect_compute, question_classify, question_control, range_compute, readout_build, readout_diff, repairTimes_compute, score_compute, warpCost_compute,
  type BridgeReadout, type DeviceState, type Place,
} from '../../src/features/trek/model.js';

const shown: TrekState[] = [];
let transcript: string = '';

beforeAll(async () => {
  const script: string[] = ['', 's', 'n', 'pw', 'srscan', 'lrscan', 'terminate', 'n'];
  const terminal: TrekTerminal = {
    text_write: (text: string): void => { transcript += text; },
    question_ask: async (prompt: string): Promise<string | null> => { transcript += prompt; return script.length > 0 ? (script.shift() as string) : null; },
    seconds_sleep: async (): Promise<void> => {},
    state_show: (state: TrekState): void => { shown.push(state); },
  };
  await trek_play(terminal, { seed: 42, fast: 1, trace: 0, styled: false }, { saved: null });
});

describe('the readout of a shown state', () => {
  it('reads the ship, the mission and the position as the status report prints them', () => {
    const readout: BridgeReadout = readout_build(shown[0] as TrekState);
    expect(readout.ship.energy).toBe(readout.ship.energyMax);
    expect(transcript).toContain(`shields       ${readout.ship.shieldsUp ? 'up' : 'down'}`);
    expect(readout.mission.klingonsLeft).toBe(readout.mission.klingonsStart);
    expect(readout.mission.killed).toBe(0);
    const { quadrant, sector } = readout.position;
    expect(transcript).toContain(`position      ${quadrant.x},${quadrant.y}/${sector.x},${sector.y}`);
    expect(transcript).toContain(`stardate      ${readout.mission.stardate.toFixed(2)}`);
    expect(transcript).toContain(`condition     ${readout.condition.name}`);
  });

  it('puts one ship on the scan where the state says, and every Klingon it knows', () => {
    const readout: BridgeReadout = readout_build(shown[0] as TrekState);
    const ships = readout.sectors.flat().filter((cell) => cell.kind === 'ship');
    expect(ships).toHaveLength(1);
    expect(ships[0]).toMatchObject({ x: readout.position.sector.x, y: readout.position.sector.y });
    const klingonCells = readout.sectors.flat().filter((cell) => cell.kind === 'klingon');
    expect(klingonCells).toHaveLength(readout.klingons.length);
    for (const k of readout.klingons) {
      expect(k.range).toBeGreaterThan(0);
      expect(k.bearing).toBeGreaterThanOrEqual(0);
      expect(k.bearing).toBeLessThan(360);
    }
  });

  it('marks the current quadrant scanned on the chart once a scan has run, and the chart is 8 by 8', () => {
    const after: BridgeReadout = readout_build(shown[shown.length - 1] as TrekState);
    expect(after.chart).toHaveLength(8);
    expect(after.chart.every((row) => row.length === 8)).toBe(true);
    const { quadrant } = after.position;
    const cell = after.chart[quadrant.x]?.[quadrant.y];
    expect(cell?.here).toBe(true);
    expect(cell?.code).not.toBeNull();
    expect(cell?.code).toHaveLength(3);
  });

  it('lists the C\'s fourteen devices (its table\'s two *ERR* rows are no device), none under repair at the start', () => {
    const readout: BridgeReadout = readout_build(shown[0] as TrekState);
    expect(readout.devices).toHaveLength(14);
    expect(readout.devices.some((device) => device.name.startsWith('*'))).toBe(false);
    expect(readout.devices[0]?.name).toBe('warp drive');
    expect(readout.damaged).toHaveLength(0);
  });

  it('diffs two readouts into the header\'s lines, and says nothing when nothing moved', () => {
    const first: BridgeReadout = readout_build(shown[0] as TrekState);
    expect(readout_diff(first, first)).toEqual([]);
    const poorer: BridgeReadout = { ...first, ship: { ...first.ship, energy: first.ship.energy - 120 }, mission: { ...first.mission, stardate: first.mission.stardate + 0.2 } };
    const lines = readout_diff(first, poorer);
    expect(lines.map((l) => l.label)).toEqual(['STARDATE', 'ENERGY']);
    expect(lines[1]).toMatchObject({ change: '−120', bad: true });
  });
});

describe('bearings, as the C steers', () => {
  it('0 is up the scan, 90 to the right, clockwise', () => {
    expect(bearing_compute({ x: 4, y: 5 }, { x: 0, y: 5 })).toBeCloseTo(0);
    expect(bearing_compute({ x: 4, y: 5 }, { x: 4, y: 9 })).toBeCloseTo(90);
    expect(bearing_compute({ x: 4, y: 5 }, { x: 9, y: 5 })).toBeCloseTo(180);
    expect(bearing_compute({ x: 4, y: 5 }, { x: 4, y: 0 })).toBeCloseTo(270);
    expect(bearing_compute({ x: 4, y: 5 }, { x: 1, y: 7 })).toBeCloseTo(33.69, 1);
    expect(range_compute({ x: 4, y: 5 }, { x: 1, y: 7 })).toBeCloseTo(3.606, 2);
  });
});

describe('the engine\'s questions, named from their prompts', () => {
  it('tells the helm\'s Course from a phaser bank\'s course, and the rest', () => {
    expect(question_classify('\nCommand: ')).toBe('command');
    expect(question_classify('\n   * * *   S T A R   T R E K   * * *\n\nPress return to continue.')).toBe('return');
    expect(question_classify('')).toBe('return');
    expect(question_classify('Course: ')).toBe('course');
    expect(question_classify('course: ')).toBe('bank-course');
    expect(question_classify('Distance: ')).toBe('distance');
    expect(question_classify('distance: ')).toBe('computer-distance');
    expect(question_classify('Torpedo course: ')).toBe('torpedo-course');
    expect(question_classify('Units to fire: ')).toBe('units');
    expect(question_classify('Manual or automatic: ')).toBe('manual-automatic');
    expect(question_classify('Do you want a burst: ')).toBe('burst');
    expect(question_classify('burst angle: ')).toBe('burst-angle');
    expect(question_classify('Warp factor: ')).toBe('warp-factor');
    expect(question_classify('How long: ')).toBe('how-long');
    expect(question_classify('Are you sure that is wise: ')).toBe('yes-no');
    expect(question_classify('Spock: Shall we cancel our rest period: ')).toBe('yes-no');
    expect(question_classify('What length game: ')).toBe('length');
    expect(question_classify('Enter a password: ')).toBe('password');
    expect(question_classify('Enter password verification: ')).toBe('password-verify');
    expect(question_classify('Another game: ')).toBe('another');
    expect(question_classify('Something new: ')).toBe('unknown');
  });

  it('names the questions the game really asked in the seeded game', () => {
    const asked: string[] = (transcript.match(/[^\n]*: $/gm) ?? []);
    expect(asked.length).toBeGreaterThan(0);
    const prompts: string[] = ['What length game: ', 'What skill game: ', 'Enter a password: ', 'Command: '];
    for (const prompt of prompts) expect(transcript).toContain(prompt);
    for (const prompt of prompts) expect(question_classify(prompt)).not.toBe('unknown');
  });

  it('gives each question a control, with ranges read from the readout', () => {
    const readout: BridgeReadout = readout_build(shown[0] as TrekState);
    expect(question_control('course', readout)).toMatchObject({ kind: 'wheel', max: 360 });
    expect(question_control('units', readout)).toMatchObject({ kind: 'slider', max: readout.ship.energy });
    expect(question_control('how-long', readout)).toMatchObject({ kind: 'slider', max: readout.mission.timeLeft });
    expect(question_control('burst', readout).kind).toBe('yesno');
    expect(question_control('return', readout).kind).toBe('auto');
    expect(question_control('unknown', readout).kind).toBe('text');
  });

  it('the command table sends the C\'s abbreviations', () => {
    const lines: string[] = BRIDGE_COMMANDS.map((c) => c.line);
    expect(lines).toEqual(expect.arrayContaining(['m', 'ram', 'w', 'i', 'do', 'u', 'r', 'p', 't', 'sh', 'cl', 'ca', 'v', 'c', 'help', 'dump', 'cr', 'abandon', 'destruct', 'terminate']));
    expect(new Set(lines).size).toBe(lines.length);
  });
});

describe("the bridge's arithmetic against the computer's own", () => {
  const states: TrekState[] = [];
  let words: string = '';

  beforeAll(async () => {
    // the computer: score, warp cost 3 at warp 5, phaser effect at range 0.36, impulse cost 1.5, course to 3,4/5,6
    const script: string[] = ['', 's', 'n', 'pw', 'c', 's', 'c', 'w', '3', '5', 'c', 'p', '0.36', 'c', 'i', '1.5', 'c', 'c', '3', '4', '5', '6', 'terminate', 'n'];
    const terminal: TrekTerminal = {
      text_write: (text: string): void => { words += text; },
      question_ask: async (prompt: string): Promise<string | null> => { words += prompt; return script.length > 0 ? (script.shift() as string) : null; },
      seconds_sleep: async (): Promise<void> => {},
      state_show: (state: TrekState): void => { states.push(state); },
    };
    await trek_play(terminal, { seed: 7, fast: 1, trace: 0, styled: false }, { saved: null });
  });

  it('scores a fresh game as the C does, item by item', () => {
    const readout: BridgeReadout = readout_build(states[0] as TrekState);
    const tally = score_compute(readout);
    const printed: RegExpMatchArray | null = words.match(/\*\*\*  TOTAL\s+(-?\d+)/);
    expect(printed).not.toBeNull();
    expect(tally.total).toBe(Number(printed?.[1]));
    expect(tally.items.some((item) => /Klingons remaining/.test(item.label))).toBe(true);
  });

  it('counts a warp move, an impulse move and a phaser shot as the computer prints them', () => {
    const readout: BridgeReadout = readout_build(states[0] as TrekState);
    const warp = warpCost_compute(3, 5, readout.param.warptime);
    expect(words).toContain(`Warp 5.00 distance 3.00 cost ${warp.stardates.toFixed(2)} stardates ${warp.units} (${warp.unitsShielded} w/ shlds up) units`);
    const impulse = impulseCost_compute(1.5);
    expect(words).toContain(`Distance 1.50 cost ${impulse.stardates.toFixed(2)} stardates ${impulse.units} units`);
    expect(words).toContain(`Phasers are ${phaserEffect_compute(0.36)}% effective at that range`);
  });

  it('works a course and distance out as kalc does', () => {
    const readout: BridgeReadout = readout_build(states[0] as TrekState);
    const calc = course_calc(readout, { quadrant: { x: 3, y: 4 }, sector: { x: 5, y: 6 } });
    expect(words).toContain(`to 3,4/5,6: course ${calc.course}  dist ${calc.distance.toFixed(3)}`);
    // a course of 0 runs up the scan: one sector is a tenth of a quadrant
    const up: Place = arrival_compute(readout, 0, 0.1);
    expect(up.quadrant.x * 10 + up.sector.x).toBe(readout.position.quadrant.x * 10 + readout.position.sector.x - 1);
    expect(up.quadrant.y * 10 + up.sector.y).toBe(readout.position.quadrant.y * 10 + readout.position.sector.y);
  });

  it('reports repair times only for a device that is down', () => {
    const readout: BridgeReadout = readout_build(states[0] as TrekState);
    const working = readout.devices.find((device) => device.repairAt === null);
    expect(working).toBeDefined();
    expect(repairTimes_compute(working as DeviceState, readout)).toBeNull();
    const down: DeviceState = { index: 0, name: 'warp drive', person: 'Scott', repairAt: readout.mission.stardate + 2 };
    const times = repairTimes_compute(down, readout);
    expect(times?.inFlight).toBeCloseTo(2.005, 3);
    expect(times?.docked).toBeCloseTo(2 * readout.param.dockfac + 0.005, 3);
  });
});
