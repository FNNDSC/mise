/**
 * @file The showpieces and the arcade, played in a terminal.
 *
 * The kernel's `sl`, `cmatrix`, `rain`, `asciiquarium`, `tetris` and `snake`
 * answer with a `games.show` model naming a program (`@fnndsc/menu/games`).
 * A chell on a terminal plays it in place: the alternate screen, the cursor
 * hidden, the program's grid drawn in the console's hues once a tick, its
 * keys read raw. q, Esc or Ctrl-C gives the screen back as it was. A model
 * marked `pane` is ARGUS's to draw in its GAMES pane; a chell whose output
 * is not a terminal (a pipe, a file) only prints the still the kernel sent.
 *
 * @module
 */
import * as readline from 'readline';
import type { CommandEnvelope } from '@fnndsc/menu';
import { terminalState_mark } from './lineDiscipline.js';
import { PROGRAMS, program_isName, type GameProgram, type Grid, type Palette, type ProgramName } from '@fnndsc/menu/games';

/** What a `games.show` model asks a terminal to play. */
export interface GameShow {
  program: ProgramName;
}

/** The terminal a game plays on. */
export interface GameTerminal {
  input: NodeJS.ReadStream;
  output: NodeJS.WriteStream;
}

/** The console's hues, as the GAMES pane reads them in the LCARS scheme. */
const HUES: Readonly<Record<keyof Palette, string>> = { lit: '#ffaa44', dim: '#ffeecc', warn: '#ff7766', cool: '#ff9911' };

/** The keys a program reads, by the names a keyboard event gives them. */
const KEY_NAMES: Readonly<Record<string, string>> = { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight', space: ' ', return: 'Enter' };

/**
 * The program a command's answer asks a terminal to play, when there is one.
 *
 * @param envelopes - The command's envelopes.
 * @returns The show, or null when none (or one marked for ARGUS's pane).
 */
export function gameShow_of(envelopes: ReadonlyArray<CommandEnvelope>): GameShow | null {
  for (const envelope of envelopes) {
    if (envelope.model?.kind !== 'games.show') continue;
    const data = envelope.model.data as { program?: unknown; pane?: unknown } | undefined;
    if (data?.pane === true || typeof data?.program !== 'string' || !program_isName(data.program)) return null;
    return { program: data.program };
  }
  return null;
}

/**
 * Whether this process can play a game: its input and its output are a terminal.
 *
 * @param terminal - The streams.
 * @returns True on a terminal.
 */
export function gameTerminal_is(terminal: GameTerminal = { input: process.stdin, output: process.stdout }): boolean {
  return terminal.input.isTTY === true && terminal.output.isTTY === true;
}

/** A hex hue as a 24-bit foreground escape. */
function hue_escape(hex: string): string {
  const value: number = parseInt(hex.slice(1), 16);
  return `\u001b[38;2;${(value >> 16) & 255};${(value >> 8) & 255};${value & 255}m`;
}

/** One frame: a cell per column and row, each with the escape of its hue. */
class Frame implements Grid {
  public readonly cols: number;
  public readonly rows: number;
  private readonly glyphs: string[];
  private readonly hues: string[];

  constructor(cols: number, rows: number) {
    this.cols = cols;
    this.rows = rows;
    this.glyphs = new Array<string>(cols * rows).fill(' ');
    this.hues = new Array<string>(cols * rows).fill('');
  }

  public put(col: number, row: number, glyph: string, hue: string): void {
    if (col < 0 || row < 0 || col >= this.cols || row >= this.rows) return;
    this.glyphs[row * this.cols + col] = glyph;
    // A program may name a hue of its own (`#ffffff`, cmatrix's head) beside the palette's escapes.
    this.hues[row * this.cols + col] = hue.startsWith('#') ? hue_escape(hue) : hue;
  }

  public text(col: number, row: number, words: string, hue: string): void {
    [...words].forEach((glyph: string, i: number): void => this.put(col + i, row, glyph, hue));
  }

  /** The frame as one write: home, every row (a hue escape only where it changes), no scrolling. */
  public render(status: string): string {
    let out: string = '\u001b[H';
    for (let row: number = 0; row < this.rows; row++) {
      let current: string = '';
      for (let col: number = 0; col < this.cols; col++) {
        const at: number = row * this.cols + col;
        const hue: string = this.hues[at] ?? '';
        if (hue !== current && (this.glyphs[at] ?? ' ') !== ' ') { out += hue; current = hue; }
        out += this.glyphs[at] ?? ' ';
      }
      out += '\r\n';
    }
    return `${out}\u001b[0m\u001b[7m${status.slice(0, this.cols).padEnd(this.cols)}\u001b[0m\u001b[J`;
  }
}

/**
 * Plays a program on the terminal until q, Esc or Ctrl-C.
 *
 * @param show - What to play.
 * @param terminal - The terminal (stdin and stdout by default).
 * @returns Resolves once the screen is given back.
 */
export function game_play(show: GameShow, terminal: GameTerminal = { input: process.stdin, output: process.stdout }): Promise<void> {
  const { input, output } = terminal;
  const palette: Palette = { lit: hue_escape(HUES.lit), dim: hue_escape(HUES.dim), warn: hue_escape(HUES.warn), cool: hue_escape(HUES.cool) };
  let program: GameProgram = PROGRAMS[show.program]();
  const size = (): { cols: number; rows: number } => ({ cols: Math.max(10, output.columns ?? 80), rows: Math.max(6, (output.rows ?? 24) - 1) });

  return new Promise<void>((resolve: () => void): void => {
    // Whoever reads the keys now (readline, at the prompt) is set aside, and
    // put back after: no key typed at the game reaches the line being edited.
    const saved: Array<(...args: unknown[]) => void> = input.listeners('keypress') as Array<(...args: unknown[]) => void>;
    input.removeAllListeners('keypress');
    readline.emitKeypressEvents(input);
    const wasRaw: boolean = input.isRaw === true;
    input.setRawMode?.(true);
    input.resume();
    output.write('\u001b[?1049h\u001b[?25l\u001b[2J');
    // A browser's terminal reads that the game has the screen (and the keys).
    terminalState_mark('playing', (chunk: string): void => { output.write(chunk); });

    const draw = (): void => {
      const { cols, rows } = size();
      const frame: Frame = new Frame(cols, rows);
      program.draw(frame, palette);
      const ended: string = program.over?.() === true ? ' · OVER: r plays again' : '';
      output.write(frame.render(` ${program.title}${program.status !== undefined ? ` · ${program.status()}` : ''}${ended} · q leaves`));
    };
    const tick = (): void => { program.step(size(), Math.random); draw(); };
    const clock: ReturnType<typeof setInterval> = setInterval(tick, program.tick);
    const resized = (): void => { output.write('\u001b[2J'); draw(); };
    output.on('resize', resized);

    const leave = (): void => {
      clearInterval(clock);
      output.off('resize', resized);
      input.off('keypress', keyed);
      input.setRawMode?.(wasRaw);
      for (const listener of saved) input.on('keypress', listener);
      output.write('\u001b[0m\u001b[?25h\u001b[?1049l');
      terminalState_mark('busy', (chunk: string): void => { output.write(chunk); });
      resolve();
    };
    const keyed = (sequence: string | undefined, key: { name?: string; ctrl?: boolean } | undefined): void => {
      const name: string = key?.name ?? sequence ?? '';
      if ((key?.ctrl === true && name === 'c') || name === 'escape' || name === 'q') { leave(); return; }
      if (name === 'r' && program.over?.() === true) { program = PROGRAMS[show.program](); output.write('\u001b[2J'); draw(); return; }
      const word: string = KEY_NAMES[name] ?? sequence ?? name;
      if (program.key?.(word) === true) draw();
    };
    input.on('keypress', keyed);
    tick();
  });
}
