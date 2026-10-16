/**
 * @file trek, against the original: every fixture game's transcript is the
 * one the NetBSD C printed for the same seed and the same answers
 * (tests/fixtures/trek, recorded from the C built with glibc's random()),
 * byte for byte. Then the pieces the transcripts cannot reach: the dump
 * slot, a win and its promotion, the styled scans and the command's flags.
 */
import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cuminMock_install } from './support/cuminMock.js';

cuminMock_install(() => ({
  envelope_ok: (rendered: string, model?: unknown) => ({ status: 'ok', rendered, model }),
  envelope_error: (rendered: string, _errors?: unknown, renderedErr?: string) => (renderedErr !== undefined ? { status: 'error', rendered, renderedErr } : { status: 'error', rendered }),
}));
const answers: string[] = [];
let written: string = '';
jest.unstable_mockModule('../src/core/question.js', () => ({
  repl_question: async (prompt: string): Promise<string> => {
    written += prompt;
    const next: string | undefined = answers.shift();
    if (next === undefined) throw new Error('no surface');
    return next;
  },
}));
jest.unstable_mockModule('../src/core/sink.js', () => ({ sink_get: () => ({ data_write: (text: string): void => { written += text; } }) }));

const chalk = (await import('chalk')).default;
const { trek_play, builtin_trek } = await import('../src/builtins/games/trek/trek.js');
const { trekLine_style } = await import('../src/builtins/games/trek/style.js');
const { TrekIO, TrekReset } = await import('../src/builtins/games/trek/io.js');
const { TrekRandom } = await import('../src/builtins/games/trek/rand.js');
const { state_new } = await import('../src/builtins/games/trek/state.js');
const { win } = await import('../src/builtins/games/trek/win.js');
const { ENTERPRISE, QUEENE, E_HIDDEN, E_GHOST, E_KDESB, E_ENSLV, MAXEVENTS } = await import('../src/builtins/games/trek/consts.js');
const { abandon } = await import('../src/builtins/games/trek/abandon.js');
const { setwarp } = await import('../src/builtins/games/trek/setwarp.js');
const { dumpssradio } = await import('../src/builtins/games/trek/dumpssradio.js');
const { schedule } = await import('../src/builtins/games/trek/schedule.js');
const { sprintf } = await import('../src/builtins/games/trek/printf.js');
const { snapshot_take, snapshot_restore } = await import('../src/builtins/games/trek/state.js');
type TrekTerminal = import('../src/builtins/games/trek/io.js').TrekTerminal;

const FIXTURES: string = join(process.cwd(), 'tests', 'fixtures', 'trek');
const plain = (text: string): string => text.replace(/\x1b\[[0-9;]*m/g, '');

/** A terminal that answers from a script and keeps what it is shown; EOF when the script ends. */
function terminal_scripted(script: string[]): { terminal: TrekTerminal; out: () => string } {
  let out: string = '';
  const terminal: TrekTerminal = {
    write: (text: string): void => { out += text; },
    ask: async (prompt: string): Promise<string | null> => { out += prompt; return script.length > 0 ? (script.shift() as string) : null; },
    sleep: async (): Promise<void> => {},
  };
  return { terminal, out: (): string => out };
}

/** The lines of an input fixture. */
function script_read(file: string): string[] {
  const lines: string[] = readFileSync(file, 'utf8').split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}

beforeEach(() => { answers.length = 0; written = ''; });

describe('trek plays as the original', () => {
  const games: string[] = readdirSync(FIXTURES).filter((name: string): boolean => name.endsWith('.in')).sort();

  it('has fixture games', () => {
    expect(games.length).toBeGreaterThan(4);
  });

  for (const game of games) {
    it(`${game}: the C's transcript, byte for byte`, async () => {
      const seed: number = Number(/-(\d+)\.in$/.exec(game)?.[1]);
      const { terminal, out } = terminal_scripted(script_read(join(FIXTURES, game)));
      const code: number = await trek_play(terminal, { seed, fast: 1, trace: 0, styled: false }, { saved: null });
      expect(out()).toBe(readFileSync(join(FIXTURES, game.replace(/\.in$/, '.out')), 'utf8'));
      expect([0, 1]).toContain(code);
    }, 30_000);
  }
});

describe('the dump slot', () => {
  it('dump keeps the game, and a restart length brings it back', async () => {
    const dump = { saved: null };
    const first = terminal_scripted(['', 's', 'n', 'pw', 'srscan', 'dump', 'terminate', 'y', 'restart', 'srscan', 'terminate', 'n']);
    expect(await trek_play(first.terminal, { seed: 9, fast: 1, trace: 0, styled: false }, dump)).toBe(0);
    expect(dump.saved).not.toBeNull();
    const scans: string[] = first.out().split('Short range sensor scan').slice(2).map((scan: string): string => scan.split('\nCommand')[0] as string);
    expect(scans).toHaveLength(2);
    expect(scans[1]).toBe(scans[0]);
  });

  it('restart with nothing dumped says so and asks again', async () => {
    const { terminal, out } = terminal_scripted(['', 'restart', 's', 'n', 'pw', 'terminate', 'n']);
    expect(await trek_play(terminal, { seed: 9, fast: 1, trace: 0, styled: false }, { saved: null })).toBe(0);
    expect(out()).toContain('cannot restart\nWhat length game: ');
  });
});

describe('winning', () => {
  it('congratulates, scores, promotes a clean captain, and asks for another game', async () => {
    const { terminal, out } = terminal_scripted(['']);
    const t = { s: state_new(), io: new TrekIO(terminal), rnd: new TrekRandom(1), dump: { saved: null } };
    Object.assign(t.s.Game, { skill: 2, killk: 20, helps: 0, killb: 0, killinhab: 0, kills: 0, deaths: 0 });
    Object.assign(t.s.Param, { klingpwr: 400, date: 2000 });
    Object.assign(t.s.Now, { date: 2002, klings: 0 });
    t.s.Ship.ship = ENTERPRISE;
    await expect(win(t)).rejects.toBeInstanceOf(TrekReset);
    t.io.fflush();
    expect(out()).toContain('Congratulations, you have saved the Federation');
    expect(out()).toContain('from fair to good');
  });
});

/** A game state on a scripted terminal, for one routine at a time. */
function trek_on(script: string[]): { t: import('../src/builtins/games/trek/context.js').Trek; out: () => string } {
  const { terminal, out } = terminal_scripted(script);
  const t = { s: state_new(), io: new TrekIO(terminal), rnd: new TrekRandom(3), dump: { saved: null } };
  return { t, out: (): string => { t.io.fflush(); return out(); } };
}

describe('routines the transcripts rarely reach', () => {
  it('abandon: a captain with captives to trade is put in charge of the Faire Queene', async () => {
    const { t, out } = trek_on([]);
    Object.assign(t.s.Game, { skill: 1, captives: 40 });
    Object.assign(t.s.Now, { bases: 1 });
    t.s.Now.base[0] = { x: 2, y: 3 };
    Object.assign(t.s.Ship, { ship: ENTERPRISE, cond: 0, crew: 300, quadx: 0, quady: 0, sectx: 4, secty: 4 });
    t.s.Param.damprob.fill(100);
    t.s.Event.forEach((e) => { e.date = 1e300; e.evcode = 0; });
    for (const row of t.s.Sect) row.fill('.');
    await abandon(t, 0);
    expect(t.s.Ship.ship).toBe(QUEENE);
    expect(out()).toContain('Entire crew of 300 left to die in outer space');
    expect(out()).toContain('the Fairie Queene');
    await abandon(t, 0);
    expect(out()).toContain('You may not abandon ye Faire Queene');
  });

  it('setwarp: refuses below 1 and above 10, warns above 6', async () => {
    const { t, out } = trek_on(['0.5', '11', '8', '-1']);
    for (let n: number = 0; n < 4; n++) await setwarp(t, 0);
    expect(out()).toContain('Minimum warp speed is 1.0');
    expect(out()).toContain('Maximum speed is warp 10.0');
    expect(out()).toContain('Damage to warp engines may occur above warp 6.0');
    expect(t.s.Ship.warp).toBe(8);
    expect(t.s.Ship.warp3).toBe(512);
  });

  it('dumpssradio: a ghost call is cleared, a hidden one stays (as the C, which switches on the hidden code)', () => {
    const { t, out } = trek_on([]);
    t.s.Event.forEach((e) => { e.evcode = 0; });
    t.s.Quad[1]![2]!.qsystemname = 5;
    const ghost: number = schedule(t, E_ENSLV | E_GHOST, 1, 1, 2, 5);
    t.s.Event[ghost]!.evcode |= E_HIDDEN;
    const hidden: number = schedule(t, E_KDESB, 1, 3, 3, 0);
    t.s.Event[hidden]!.evcode |= E_HIDDEN;
    expect(dumpssradio(t)).toBe(0);
    expect(out()).toMatch(/Starsystem .+ in quadrant 1,2 is no longer distressed/);
    expect(t.s.Event[ghost]!.evcode).toBe(0);
    expect(t.s.Event[hidden]!.evcode).toBe(E_KDESB | E_HIDDEN);
  });

  it('schedule: a full queue is fatal, as errx', () => {
    const { t, out } = trek_on([]);
    t.s.Event.forEach((e) => { e.evcode = 1; });
    expect(() => schedule(t, E_KDESB, 1, 0, 0, 0)).toThrow('trek exited 1');
    expect(out()).toContain('Cannot schedule event');
    expect(MAXEVENTS).toBe(t.s.Event.length);
  });

  it('a snapshot restores in place: what a routine holds stays the live state', () => {
    const s = state_new();
    s.Now.date = 2100;
    s.Quad[0]![0]!.stars = 4;
    const snap = snapshot_take(s);
    const held = s.Now;
    const quad = s.Quad[0]![0]!;
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
    expect(plain(shown)).toBe('1 · ✶ ◈ ◉ K E · · · · 1   condition     RED');
    expect(shown).toContain(chalk.red.bold('RED'));
    expect(plain(shown).length).toBe(row.length);
  });

  it('a long range row colours its counts by place, and other lines pass', () => {
    const row: string = '0 !   7 ! 113 ! /// !';
    expect(plain(trekLine_style(row))).toBe(row);
    expect(trekLine_style(row)).toContain(chalk.red.bold('1'));
    expect(trekLine_style('Command: ')).toBe('Command: ');
  });

  it('styled play shows the same words as classic', async () => {
    const script: string[] = ['', 's', 'n', 'pw', 'lrscan', 'terminate', 'n'];
    const classic = terminal_scripted([...script]);
    await trek_play(classic.terminal, { seed: 5, fast: 1, trace: 0, styled: false }, { saved: null });
    const styled = terminal_scripted([...script]);
    await trek_play(styled.terminal, { seed: 5, fast: 1, trace: 0, styled: true }, { saved: null });
    expect(styled.out()).not.toBe(classic.out());
    expect(plain(styled.out()).replace(/·/g, '.').replace(/✶/g, '*').replace(/◈/g, '#').replace(/◉/g, '@')).toBe(classic.out());
  });
});

describe('the trek command', () => {
  it('refuses an unknown flag by name', async () => {
    const refused = await builtin_trek(['--warp']);
    expect(refused.status).toBe('error');
    expect((refused as { renderedErr?: string }).renderedErr).toContain("unknown option '--warp'");
    expect(((await builtin_trek(['extra'])) as { renderedErr?: string }).renderedErr).toContain('usage: trek');
  });

  it('plays a seeded classic game through the session, prompts as questions', async () => {
    answers.push('', 's', 'n', 'pw', 'terminate', 'n');
    const ended = await builtin_trek(['--classic', '--seed', '42', '-f', '-s']);
    expect(ended.status).toBe('ok');
    expect(ended.model).toEqual({ kind: 'games.trek', data: { seed: 42, exit: 0 } });
    expect(written).toContain('S T A R   T R E K');
    expect(written).toContain('What length game: ');
    expect(written).toContain('\nCommand: ');
  });

  it('says so when the session cannot ask', async () => {
    const ended = await builtin_trek(['--seed', '1']);
    expect(ended.status).toBe('error');
    expect((ended as { renderedErr?: string }).renderedErr).toContain('trek: cannot ask here');
  });
});
