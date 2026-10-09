/**
 * @file The showpieces — `sl`, `cmatrix`, `rain`, `asciiquarium` — and the
 * arcade: `tetris`, `snake`.
 *
 * Each is a program a surface with a canvas runs: ARGUS opens its GAMES
 * pane on the `games.show` model and draws. The console gets the text: a
 * still of the show, or the words that there is nothing to play here and
 * where there is.
 *
 * @module
 */
import chalk from 'chalk';
import { CommandEnvelope, envelope_ok } from '@fnndsc/menu';

/** The programs a GAMES pane can run. */
export type ShowProgram = 'sl' | 'cmatrix' | 'rain' | 'aquarium' | 'tetris' | 'snake';

/**
 * The starship `sl` sends across the screen (a typo's punishment, as the
 * train was): the Constitution-class refit, side view, from the Star Trek
 * ASCII Art blog (startrekasciiart.blogspot.com, "Constitution Class -
 * Refit", 2011; artist uncredited there; re-use granted with attribution
 * retained). Nose to the right: it flies left to right.
 */
export const STARSHIP: ReadonlyArray<string> = [
  '___________________          _-_         ',
  '\\__(==========/_=_/ ____.---\'---`---.____',
  '            \\_ \\    \\----._________.----/',
  '              \\ \\   /  /    `-_-\'        ',
  '          __,--`.`-\'..\'-_                ',
  '         /____          ||               ',
  '              `--.____,-\'                ',
];

/** The glyphs `cmatrix` rains. */
export const MATRIX_GLYPHS: string = 'ﾊﾐﾋｰｳｼﾅﾓﾆｻﾜﾂｵﾘｱﾎﾃﾏｹﾒｴｶｷﾑﾕﾗｾﾈｽﾀﾇﾍ0123456789Z:・.=*+-<>¦|';

/** A still of a show, for a console with no canvas. */
export function still_of(program: ShowProgram, random: () => number = Math.random): string[] {
  const pick = (s: string): string => s[Math.floor(random() * s.length)] as string;
  switch (program) {
    case 'sl': return [...STARSHIP];
    case 'cmatrix': return Array.from({ length: 6 }, (): string => Array.from({ length: 40 }, (): string => (random() < 0.35 ? pick(MATRIX_GLYPHS) : ' ')).join(''));
    case 'rain': return Array.from({ length: 5 }, (_: unknown, row: number): string => Array.from({ length: 40 }, (): string => (random() < 0.12 ? (row === 4 ? 'o' : '|') : ' ')).join(''));
    case 'aquarium': return [
      '  ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~',
      '        ><>           o              ',
      '                 <><      o          ',
      '    ><>                        ><>   ',
      '  )(   )(      )(        )(   )(  )( ',
      '  ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^',
    ];
    case 'tetris': return [
      '  |          |', '  |    ##    |', '  |   ##     |', '  |          |', '  |  # #  ## |', '  | ####  ###|', '  +----------+',
    ];
    case 'snake': return ['  . . . . . . . .', '  . @ o o o . . .', '  . . . . o . . .', '  . . * . . . . .'];
  }
}

/** What the console says beside a still: where the moving one is. */
function note_of(program: ShowProgram, arcade: boolean): string {
  return arcade
    ? chalk.gray(`${program} plays in ARGUS: type it there and the GAMES pane opens with the keys live (arrows; Esc gives the keyboard back).`)
    : chalk.gray(`a still; ARGUS draws ${program} moving in its GAMES pane.`);
}

function show_run(program: ShowProgram, args: string[], arcade: boolean): CommandEnvelope {
  const still: string[] = still_of(program);
  return envelope_ok(`${still.join('\n')}\n${note_of(program, arcade)}\n`, { kind: 'games.show', data: { program, args, arcade } });
}

/** `sl`: a starship crosses the screen. */
export async function builtin_sl(args: string[]): Promise<CommandEnvelope> { return show_run('sl', args, false); }
/** `cmatrix`: the glyph rain. */
export async function builtin_cmatrix(args: string[]): Promise<CommandEnvelope> { return show_run('cmatrix', args, false); }
/** `rain`: rain. */
export async function builtin_rain(args: string[]): Promise<CommandEnvelope> { return show_run('rain', args, false); }
/** `asciiquarium`: fish. */
export async function builtin_asciiquarium(args: string[]): Promise<CommandEnvelope> { return show_run('aquarium', args, false); }
/** `tetris`: falling blocks, in ARGUS. */
export async function builtin_tetris(args: string[]): Promise<CommandEnvelope> { return show_run('tetris', args, true); }
/** `snake`: the snake, in ARGUS. */
export async function builtin_snake(args: string[]): Promise<CommandEnvelope> { return show_run('snake', args, true); }
