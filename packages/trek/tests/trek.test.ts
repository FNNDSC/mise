/**
 * @file trek, against the original: every fixture game's transcript is the
 * one the NetBSD C printed for the same seed and the same answers
 * (tests/fixtures/trek, recorded from the C built with glibc's random()),
 * byte for byte. Then the pieces the transcripts cannot reach: the dump
 * slot, a win and its promotion, the styled scans and the flags.
 */
import { describe, it, expect, beforeEach } from '@jest/globals';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
const chalk = (await import('chalk')).default;
const { trek_play, trekArgs_parse } = await import('../src/trek.js');
const { trekLine_style } = await import('../src/style.js');
const { TrekIO, TrekReset } = await import('../src/io.js');
const { TrekRandom } = await import('../src/rand.js');
const { state_create } = await import('../src/state.js');
const { win } = await import('../src/win.js');
const { ENTERPRISE, QUEENE, E_HIDDEN, E_GHOST, E_KDESB, E_ENSLV, MAXEVENTS } = await import('../src/consts.js');
const { abandon } = await import('../src/abandon.js');
const { setwarp } = await import('../src/setwarp.js');
const { dumpssradio } = await import('../src/dumpssradio.js');
const { schedule } = await import('../src/schedule.js');
const { sprintf } = await import('../src/printf.js');
const { snapshot_take, snapshot_restore } = await import('../src/state.js');
type TrekTerminal = import('../src/io.js').TrekTerminal;
type Trek = import('../src/context.js').Trek;
type TrekDump = import('../src/context.js').TrekDump;
type TrekState = import('../src/state.js').TrekState;
type TrekEvent = import('../src/state.js').TrekEvent;
type Snapshot = import('../src/state.js').Snapshot;
type Now = import('../src/state.js').Now;
type Quad = import('../src/state.js').Quad;

/** A scripted terminal and the transcript of what it was shown. */
interface ScriptedTerminal {
  /** The terminal the game plays on. */
  terminal: TrekTerminal;
  /** Everything the terminal was shown, prompts included. */
  transcript_get: () => string;
}

/** A game on a scripted terminal and the transcript of what it printed. */
interface ScriptedTrek {
  /** The game: state, terminal and random numbers. */
  t: Trek;
  /** Everything printed so far, the game's output flushed first. */
  transcript_get: () => string;
}

const FIXTURES: string = join(process.cwd(), 'tests', 'fixtures', 'trek');

/**
 * Strips the ANSI colour codes from text.
 *
 * @param text - Styled text.
 * @returns The text without its escape sequences.
 */
const text_unstyle: (text: string) => string = (text: string): string => text.replace(/\x1b\[[0-9;]*m/g, '');

/**
 * Makes a terminal that answers from a script and keeps what it is shown; EOF when the script ends.
 *
 * @param script - The answers, in order.
 * @returns The terminal and its transcript.
 */
function scriptedTerminal_make(script: string[]): ScriptedTerminal {
  let out: string = '';
  const terminal: TrekTerminal = {
    text_write: (text: string): void => { out += text; },
    question_ask: async (prompt: string): Promise<string | null> => { out += prompt; return script.length > 0 ? (script.shift() as string) : null; },
    seconds_sleep: async (): Promise<void> => {},
  };
  return { terminal, transcript_get: (): string => out };
}

/**
 * Reads the lines of an input fixture.
 *
 * @param file - The fixture's path.
 * @returns Its lines, without a trailing empty one.
 */
function script_read(file: string): string[] {
  const lines: string[] = readFileSync(file, 'utf8').split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}


describe('trek plays as the original', () => {
  const games: string[] = readdirSync(FIXTURES).filter((name: string): boolean => name.endsWith('.in')).sort();

  it('has fixture games', () => {
    expect(games.length).toBeGreaterThan(4);
  });

  for (const game of games) {
    it(`${game}: the C's transcript, byte for byte`, async () => {
      const seed: number = Number(/-(\d+)\.in$/.exec(game)?.[1]);
      const { terminal, transcript_get } = scriptedTerminal_make(script_read(join(FIXTURES, game)));
      const code: number = await trek_play(terminal, { seed, fast: 1, trace: 0, styled: false }, { saved: null });
      expect(transcript_get()).toBe(readFileSync(join(FIXTURES, game.replace(/\.in$/, '.out')), 'utf8'));
      expect([0, 1]).toContain(code);
    }, 30_000);
  }
});

describe('the dump slot', () => {
  it('dump keeps the game, and a restart length brings it back', async () => {
    const dump: TrekDump = { saved: null };
    const first: ScriptedTerminal = scriptedTerminal_make(['', 's', 'n', 'pw', 'srscan', 'dump', 'terminate', 'y', 'restart', 'srscan', 'terminate', 'n']);
    expect(await trek_play(first.terminal, { seed: 9, fast: 1, trace: 0, styled: false }, dump)).toBe(0);
    expect(dump.saved).not.toBeNull();
    const scans: string[] = first.transcript_get().split('Short range sensor scan').slice(2).map((scan: string): string => scan.split('\nCommand')[0] as string);
    expect(scans).toHaveLength(2);
    expect(scans[1]).toBe(scans[0]);
  });

  it('restart with nothing dumped says so and asks again', async () => {
    const { terminal, transcript_get } = scriptedTerminal_make(['', 'restart', 's', 'n', 'pw', 'terminate', 'n']);
    expect(await trek_play(terminal, { seed: 9, fast: 1, trace: 0, styled: false }, { saved: null })).toBe(0);
    expect(transcript_get()).toContain('cannot restart\nWhat length game: ');
  });
});

describe('winning', () => {
  it('congratulates, scores, promotes a clean captain, and asks for another game', async () => {
    const { terminal, transcript_get } = scriptedTerminal_make(['']);
    const t: Trek = { s: state_create(), io: new TrekIO(terminal), rnd: new TrekRandom(1), dump: { saved: null } };
    Object.assign(t.s.Game, { skill: 2, killk: 20, helps: 0, killb: 0, killinhab: 0, kills: 0, deaths: 0 });
    Object.assign(t.s.Param, { klingpwr: 400, date: 2000 });
    Object.assign(t.s.Now, { date: 2002, klings: 0 });
    t.s.Ship.ship = ENTERPRISE;
    await expect(win(t)).rejects.toBeInstanceOf(TrekReset);
    t.io.fflush();
    expect(transcript_get()).toContain('Congratulations, you have saved the Federation');
    expect(transcript_get()).toContain('from fair to good');
  });
});

/**
 * Makes a game state on a scripted terminal, for one routine at a time.
 *
 * @param script - The answers, in order.
 * @returns The game and its transcript.
 */
function scriptedTrek_make(script: string[]): ScriptedTrek {
  const { terminal, transcript_get } = scriptedTerminal_make(script);
  const t: Trek = { s: state_create(), io: new TrekIO(terminal), rnd: new TrekRandom(3), dump: { saved: null } };
  return { t, transcript_get: (): string => { t.io.fflush(); return transcript_get(); } };
}

describe('routines the transcripts rarely reach', () => {
  it('abandon: a captain with captives to trade is put in charge of the Faire Queene', async () => {
    const { t, transcript_get } = scriptedTrek_make([]);
    Object.assign(t.s.Game, { skill: 1, captives: 40 });
    Object.assign(t.s.Now, { bases: 1 });
    t.s.Now.base[0] = { x: 2, y: 3 };
    Object.assign(t.s.Ship, { ship: ENTERPRISE, cond: 0, crew: 300, quadx: 0, quady: 0, sectx: 4, secty: 4 });
    t.s.Param.damprob.fill(100);
    t.s.Event.forEach((e: TrekEvent): void => { e.date = 1e300; e.evcode = 0; });
    for (const row of t.s.Sect) row.fill('.');
    await abandon(t, 0);
    expect(t.s.Ship.ship).toBe(QUEENE);
    expect(transcript_get()).toContain('Entire crew of 300 left to die in outer space');
    expect(transcript_get()).toContain('the Fairie Queene');
    await abandon(t, 0);
    expect(transcript_get()).toContain('You may not abandon ye Faire Queene');
  });

  it('setwarp: refuses below 1 and above 10, warns above 6', async () => {
    const { t, transcript_get } = scriptedTrek_make(['0.5', '11', '8', '-1']);
    for (let n: number = 0; n < 4; n++) await setwarp(t, 0);
    expect(transcript_get()).toContain('Minimum warp speed is 1.0');
    expect(transcript_get()).toContain('Maximum speed is warp 10.0');
    expect(transcript_get()).toContain('Damage to warp engines may occur above warp 6.0');
    expect(t.s.Ship.warp).toBe(8);
    expect(t.s.Ship.warp3).toBe(512);
  });

  it('dumpssradio: a ghost call is cleared, a hidden one stays (as the C, which switches on the hidden code)', () => {
    const { t, transcript_get } = scriptedTrek_make([]);
    t.s.Event.forEach((e: TrekEvent): void => { e.evcode = 0; });
    t.s.Quad[1]![2]!.qsystemname = 5;
    const ghost: number = schedule(t, E_ENSLV | E_GHOST, 1, 1, 2, 5);
    t.s.Event[ghost]!.evcode |= E_HIDDEN;
    const hidden: number = schedule(t, E_KDESB, 1, 3, 3, 0);
    t.s.Event[hidden]!.evcode |= E_HIDDEN;
    expect(dumpssradio(t)).toBe(0);
    expect(transcript_get()).toMatch(/Starsystem .+ in quadrant 1,2 is no longer distressed/);
    expect(t.s.Event[ghost]!.evcode).toBe(0);
    expect(t.s.Event[hidden]!.evcode).toBe(E_KDESB | E_HIDDEN);
  });

  it('schedule: a full queue is fatal, as errx', () => {
    const { t, transcript_get } = scriptedTrek_make([]);
    t.s.Event.forEach((e: TrekEvent): void => { e.evcode = 1; });
    expect(() => schedule(t, E_KDESB, 1, 0, 0, 0)).toThrow('trek exited 1');
    expect(transcript_get()).toContain('Cannot schedule event');
    expect(MAXEVENTS).toBe(t.s.Event.length);
  });

  it('a snapshot restores in place: what a routine holds stays the live state', () => {
    const s: TrekState = state_create();
    s.Now.date = 2100;
    s.Quad[0]![0]!.stars = 4;
    const snap: Snapshot = snapshot_take(s);
    const held: Now = s.Now;
    const quad: Quad = s.Quad[0]![0]!;
    s.Now.date = 2200;
    quad.stars = 9;
    snapshot_restore(s, snap);
    expect(held.date).toBe(2100);
    expect(quad.stars).toBe(4);
    expect(s.Now).toBe(held);
  });
});

describe('printf, as C', () => {
  it('pads, signs, rounds half to even, and takes widths from arguments', () => {
    expect(sprintf('%5d|%-5d|%05d|%+d|% d', 42, 42, 42, 42, 42)).toBe('   42|42   |00042|+42| 42');
    expect(sprintf('%.0f %.0f %.1f %.2f', 2.5, 3.5, 0.25, 1.005)).toBe('2 4 0.2 1.00');
    expect(sprintf('%*d|%-*s|%.*f', 4, 7, 3, 'a', 1, 2.25)).toBe('   7|a  |2.2');
    expect(sprintf('%x %o %X %c %c %%', 255, 8, 255, 65, 'B')).toBe('ff 10 FF A B %');
    expect(sprintf('%e %g %g', 12345.678, 0.0001, 1e20)).toBe('1.234568e+04 0.0001 1e+20');
    expect(sprintf('%14.14s|%-3s|%ld', 'abcdefghijklmnopq', 'x', 7)).toBe('abcdefghijklmn|x  |7');
  });
});

describe('the styled scans', () => {
  beforeEach(() => { chalk.level = 1; });

  it('a short range row keeps its columns, wears glyphs, colours its condition', () => {
    const row: string = '1 . * # @ K E . . . . 1   condition     RED';
    const shown: string = trekLine_style(row);
    expect(shown).not.toBe(row);
    expect(text_unstyle(shown)).toBe('1 · ✶ ◈ ◉ K E · · · · 1   condition     RED');
    expect(shown).toContain(chalk.red.bold('RED'));
    expect(text_unstyle(shown).length).toBe(row.length);
  });

  it('a long range row colours its counts by place, and other lines pass', () => {
    const row: string = '0 !   7 ! 113 ! /// !';
    expect(text_unstyle(trekLine_style(row))).toBe(row);
    expect(trekLine_style(row)).toContain(chalk.red.bold('1'));
    expect(trekLine_style('Command: ')).toBe('Command: ');
  });

  it('styled play shows the same words as classic', async () => {
    const script: string[] = ['', 's', 'n', 'pw', 'lrscan', 'terminate', 'n'];
    const classic: ScriptedTerminal = scriptedTerminal_make([...script]);
    await trek_play(classic.terminal, { seed: 5, fast: 1, trace: 0, styled: false }, { saved: null });
    const styled: ScriptedTerminal = scriptedTerminal_make([...script]);
    await trek_play(styled.terminal, { seed: 5, fast: 1, trace: 0, styled: true }, { saved: null });
    expect(styled.transcript_get()).not.toBe(classic.transcript_get());
    expect(text_unstyle(styled.transcript_get()).replace(/·/g, '.').replace(/✶/g, '*').replace(/◈/g, '#').replace(/◉/g, '@')).toBe(classic.transcript_get());
  });
});

describe('the flags', () => {
  it('reads --classic, -f, -s, --seed and --credits, and refuses anything else by name', () => {
    expect(trekArgs_parse(['--classic', '-f', '-f', '--seed', '42'], 7)).toEqual({ classic: true, fast: 3, seed: 42, credits: false });
    expect(trekArgs_parse(['-s'], 7)).toEqual({ classic: false, fast: 0, seed: 7, credits: false });
    expect(trekArgs_parse(['--credits'], 7)).toEqual({ classic: false, fast: 1, seed: 7, credits: true });
    expect(trekArgs_parse(['--warp'], 7)).toEqual({ refusal: "trek: unknown option '--warp'\ntrek: usage: trek [--classic] [-f | -s] [--seed N] [--credits]" });
    expect(trekArgs_parse(['extra'], 7)).toEqual({ refusal: 'trek: usage: trek [--classic] [-f | -s] [--seed N] [--credits]' });
    expect(trekArgs_parse(['--seed'], 7)).toHaveProperty('refusal');
  });
});

describe('the credits', () => {
  it('the credits command shows them at the Command: prompt, last in ? and free of time', async () => {
    const { terminal, transcript_get } = scriptedTerminal_make(['', 's', 'n', 'pw', '?', 'credits', 'terminate', 'n']);
    await trek_play(terminal, { seed: 42, fast: 1, trace: 0, styled: false });
    const shown: string = transcript_get();
    expect(shown).toContain('Ported line for line to TypeScript by Rudolph Pienaar');
    expect(shown).toContain('https://chrisproject.org');
    expect(shown).toMatch(/warp\s+credits\n/);
    const dates: string[] = [...shown.matchAll(/stardate\s+([\d.]+)/g)].map((m: RegExpMatchArray): string => m[1] as string);
    expect(new Set(dates).size).toBe(1);
  });
});

describe('the state shown', () => {
  it('is shown at every Command: prompt, as a deep copy, and prints nothing', async () => {
    const shown: TrekState[] = [];
    const script: string[] = ['', 's', 'n', 'pw', 'srscan', 'terminate', 'n'];
    let out: string = '';
    const terminal: TrekTerminal = {
      text_write: (text: string): void => { out += text; },
      question_ask: async (prompt: string): Promise<string | null> => { out += prompt; return script.length > 0 ? (script.shift() as string) : null; },
      seconds_sleep: async (): Promise<void> => {},
      state_show: (state: TrekState): void => { shown.push(state); },
    };
    await trek_play(terminal, { seed: 42, fast: 1, trace: 0, styled: false }, { saved: null });
    // one state per Command: prompt (srscan, terminate), none for the setup questions
    expect(shown.length).toBe((out.match(/\nCommand: /g) ?? []).length);
    expect(shown.length).toBeGreaterThanOrEqual(2);
    const first: TrekState = shown[0] as TrekState;
    expect(first.Ship.energy).toBeGreaterThan(0);
    expect(first.Now.klings).toBeGreaterThan(0);
    expect(first.Quad.length).toBe(8);
    expect(first.Sect.length).toBe(10);
    // a copy: the host's keeping an old state does not hold the live one
    expect(shown[1]).not.toBe(first);
    expect((shown[1] as TrekState).Ship).not.toBe(first.Ship);
    // nothing printed for it: the transcript is the game's own words only
    expect(out).not.toContain('state');
  });

  it('a styled game shows its state too: the styling wrapper passes it through', async () => {
    const shown: TrekState[] = [];
    const script: string[] = ['', 's', 'n', 'pw', 'terminate', 'n'];
    const terminal: TrekTerminal = {
      text_write: (): void => undefined,
      question_ask: async (): Promise<string | null> => (script.length > 0 ? (script.shift() as string) : null),
      seconds_sleep: async (): Promise<void> => {},
      state_show: (state: TrekState): void => { shown.push(state); },
    };
    await trek_play(terminal, { seed: 42, fast: 1, trace: 0, styled: true }, { saved: null });
    expect(shown.length).toBeGreaterThanOrEqual(1);
  });

  it('end of input is asked for once: after a null the terminal is not asked again, and the game ends', async () => {
    let asks: number = 0;
    let nulls: number = 0;
    const script: string[] = ['', 's', 'n', 'pw'];
    const terminal: TrekTerminal = {
      text_write: (): void => undefined,
      question_ask: async (): Promise<string | null> => { asks++; if (script.length > 0) return script.shift() as string; nulls++; return null; },
      seconds_sleep: async (): Promise<void> => {},
    };
    const code: number = await trek_play(terminal, { seed: 42, fast: 1, trace: 0, styled: false }, { saved: null });
    expect(nulls).toBe(1);
    expect(asks).toBe(5);
    expect(code).toBe(1);
  });

  it('a terminal without state_show is never asked for it', async () => {
    const { terminal, transcript_get } = scriptedTerminal_make(['', 's', 'n', 'pw', 'terminate', 'n']);
    await trek_play(terminal, { seed: 42, fast: 1, trace: 0, styled: false }, { saved: null });
    expect(transcript_get()).toContain('\nCommand: ');
  });
});
