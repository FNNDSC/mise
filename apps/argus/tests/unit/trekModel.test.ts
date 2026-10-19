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
import { BRIDGE_COMMANDS, bearing_of, question_classify, question_control, range_of, readout_build, readout_diff, type BridgeReadout } from '../../src/features/trek/model.js';

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

  it('lists the C\'s sixteen devices, none under repair at the start', () => {
    const readout: BridgeReadout = readout_build(shown[0] as TrekState);
    expect(readout.devices).toHaveLength(16);
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
    expect(bearing_of({ x: 4, y: 5 }, { x: 0, y: 5 })).toBeCloseTo(0);
    expect(bearing_of({ x: 4, y: 5 }, { x: 4, y: 9 })).toBeCloseTo(90);
    expect(bearing_of({ x: 4, y: 5 }, { x: 9, y: 5 })).toBeCloseTo(180);
    expect(bearing_of({ x: 4, y: 5 }, { x: 4, y: 0 })).toBeCloseTo(270);
    expect(bearing_of({ x: 4, y: 5 }, { x: 1, y: 7 })).toBeCloseTo(33.69, 1);
    expect(range_of({ x: 4, y: 5 }, { x: 1, y: 7 })).toBeCloseTo(3.606, 2);
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
