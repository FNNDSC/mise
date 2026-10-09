/**
 * @file `figlet` and `banner`: big letters.
 *
 * One bundled face, five rows tall, drawn in `#` the way `banner` always
 * was; `figlet` fills with `█` for a solid look. Letters, digits and the
 * punctuation a title needs. A glyph is five strings of equal width; the
 * row of a word is its glyphs' rows side by side with one column between.
 *
 * @module
 */
import { text_input } from './stdin.js';
import { CommandEnvelope, envelope_ok, envelope_error } from '@fnndsc/menu';

/** The face: each glyph five rows, `#` for ink. */
const FACE: Readonly<Record<string, ReadonlyArray<string>>> = {
  A: [' ### ', '#   #', '#####', '#   #', '#   #'],
  B: ['#### ', '#   #', '#### ', '#   #', '#### '],
  C: [' ####', '#    ', '#    ', '#    ', ' ####'],
  D: ['#### ', '#   #', '#   #', '#   #', '#### '],
  E: ['#####', '#    ', '#### ', '#    ', '#####'],
  F: ['#####', '#    ', '#### ', '#    ', '#    '],
  G: [' ####', '#    ', '#  ##', '#   #', ' ####'],
  H: ['#   #', '#   #', '#####', '#   #', '#   #'],
  I: ['#####', '  #  ', '  #  ', '  #  ', '#####'],
  J: ['    #', '    #', '    #', '#   #', ' ### '],
  K: ['#   #', '#  # ', '###  ', '#  # ', '#   #'],
  L: ['#    ', '#    ', '#    ', '#    ', '#####'],
  M: ['#   #', '## ##', '# # #', '#   #', '#   #'],
  N: ['#   #', '##  #', '# # #', '#  ##', '#   #'],
  O: [' ### ', '#   #', '#   #', '#   #', ' ### '],
  P: ['#### ', '#   #', '#### ', '#    ', '#    '],
  Q: [' ### ', '#   #', '# # #', '#  # ', ' ## #'],
  R: ['#### ', '#   #', '#### ', '#  # ', '#   #'],
  S: [' ####', '#    ', ' ### ', '    #', '#### '],
  T: ['#####', '  #  ', '  #  ', '  #  ', '  #  '],
  U: ['#   #', '#   #', '#   #', '#   #', ' ### '],
  V: ['#   #', '#   #', '#   #', ' # # ', '  #  '],
  W: ['#   #', '#   #', '# # #', '## ##', '#   #'],
  X: ['#   #', ' # # ', '  #  ', ' # # ', '#   #'],
  Y: ['#   #', ' # # ', '  #  ', '  #  ', '  #  '],
  Z: ['#####', '   # ', '  #  ', ' #   ', '#####'],
  '0': [' ### ', '#  ##', '# # #', '##  #', ' ### '],
  '1': ['  #  ', ' ##  ', '  #  ', '  #  ', '#####'],
  '2': [' ### ', '#   #', '  ## ', ' #   ', '#####'],
  '3': ['#### ', '    #', ' ### ', '    #', '#### '],
  '4': ['#  # ', '#  # ', '#####', '   # ', '   # '],
  '5': ['#####', '#    ', '#### ', '    #', '#### '],
  '6': [' ### ', '#    ', '#### ', '#   #', ' ### '],
  '7': ['#####', '    #', '   # ', '  #  ', '  #  '],
  '8': [' ### ', '#   #', ' ### ', '#   #', ' ### '],
  '9': [' ### ', '#   #', ' ####', '    #', ' ### '],
  ' ': ['   ', '   ', '   ', '   ', '   '],
  '.': [' ', ' ', ' ', ' ', '#'],
  ',': [' ', ' ', ' ', '#', '#'],
  '!': ['#', '#', '#', ' ', '#'],
  '?': [' ### ', '#   #', '   # ', '     ', '  #  '],
  '-': ['     ', '     ', '#####', '     ', '     '],
  '_': ['     ', '     ', '     ', '     ', '#####'],
  ':': [' ', '#', ' ', '#', ' '],
  '/': ['    #', '   # ', '  #  ', ' #   ', '#    '],
  '+': ['     ', '  #  ', '#####', '  #  ', '     '],
  '=': ['     ', '#####', '     ', '#####', '     '],
  '*': ['     ', '# # #', ' ### ', '# # #', '     '],
  '#': [' # # ', '#####', ' # # ', '#####', ' # # '],
  '(': [' #', '# ', '# ', '# ', ' #'],
  ')': ['# ', ' #', ' #', ' #', '# '],
  '\'': ['#', '#', ' ', ' ', ' '],
  '"': ['# #', '# #', '   ', '   ', '   '],
  '&': [' ## ', '#  #', ' ## ', '# # ', ' # #'],
  '@': [' ### ', '#  ##', '# # #', '#  # ', ' ### '],
  '%': ['#   #', '   # ', '  #  ', ' #   ', '#   #'],
};

/** The rows of the face, five. */
export const FACE_ROWS: number = 5;

/**
 * Sets a text in the face.
 *
 * @param text - The words; lowercase is set as capitals, an unknown character as `?`.
 * @param ink - The character to draw with.
 * @returns The five rows (more for several lines).
 */
export function figlet_render(text: string, ink: string = '#'): string[] {
  const rows: string[] = [];
  for (const line of text.split('\n')) {
    const glyphs: ReadonlyArray<string>[] = [...line.toUpperCase()].map((c: string): ReadonlyArray<string> => FACE[c] ?? FACE['?'] as ReadonlyArray<string>);
    for (let r: number = 0; r < FACE_ROWS; r++) {
      const row: string = glyphs.map((g: ReadonlyArray<string>): string => g[r] ?? '').join(' ').replace(/#/g, ink).trimEnd();
      rows.push(row);
    }
    rows.push('');
  }
  rows.pop();
  return rows;
}

async function big_run(args: string[], ink: string, name: string): Promise<CommandEnvelope> {
  const text: string | null = text_input(args);
  if (text === null) return envelope_error('', undefined, `${name}: nothing to set (give words, or pipe them in)\n`);
  const said: string = text.replace(/\n$/, '');
  return envelope_ok(`${figlet_render(said, ink).join('\n')}\n`, { kind: 'games.figlet', data: { text: said, ink } });
}

/** `figlet [text]`: big letters, solid. */
export async function builtin_figlet(args: string[]): Promise<CommandEnvelope> {
  return big_run(args, '█', 'figlet');
}

/** `banner [text]`: big letters in `#`, as banner always drew them. */
export async function builtin_banner(args: string[]): Promise<CommandEnvelope> {
  return big_run(args, '#', 'banner');
}
