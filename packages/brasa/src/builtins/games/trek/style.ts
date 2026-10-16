/**
 * @file The scans as the bridge shows them: the game's own lines, each
 * read once it is complete, with the short range grid in glyphs and
 * colours and the long range counts coloured by what they count.
 *
 * Only the look changes: every glyph is one column wide, so the layout and
 * the words are the original's, and `trek --classic` (or a plain output)
 * skips this entirely.
 *
 * @module
 */
import chalk from 'chalk';

/** A short range scan row: its number, ten sectors, its number again, the status beside it. */
const SRS_ROW: RegExp = /^(\d) ((?:[^ ] |  ){10})(\d)(.*)$/;

/** A long range scan row: its number, then the cells between bars. */
const LRS_ROW: RegExp = /^(\d|\s) !(.*)$/;

/** A sector's glyph and colour. */
const SECTOR: Readonly<Record<string, (one: string) => string>> = {
  '.': (): string => chalk.gray('·'),
  '*': (): string => chalk.yellow('✶'),
  '#': (): string => chalk.green.bold('◈'),
  '@': (): string => chalk.magenta('◉'),
  K: (one: string): string => chalk.red.bold(one),
  E: (one: string): string => chalk.cyan.bold(one),
  Q: (one: string): string => chalk.cyan.bold(one),
};

/** A condition's colour, on the status line that names it. */
const CONDITION: Readonly<Record<string, (word: string) => string>> = {
  GREEN: (word: string): string => chalk.green.bold(word),
  YELLOW: (word: string): string => chalk.yellow.bold(word),
  RED: (word: string): string => chalk.red.bold(word),
  DOCKED: (word: string): string => chalk.cyan.bold(word),
};

/**
 * The status beside a scan row, its condition coloured.
 *
 * @param status - The text after the row.
 * @returns The text, styled.
 */
function status_style(status: string): string {
  return status.replace(/^(\s*condition\s+)(GREEN|YELLOW|RED|DOCKED)/, (_all: string, lead: string, word: string): string => `${lead}${(CONDITION[word] as (word: string) => string)(word)}`);
}

/**
 * A long range count, coloured by place: Klingons in the hundreds, starbases
 * in the tens, stars in the units.
 *
 * @param digits - The count as printed.
 * @returns The count, styled.
 */
function count_style(digits: string): string {
  const places: string[] = digits.split('');
  return places.map((digit: string, at: number): string => {
    const fromRight: number = places.length - 1 - at;
    if (fromRight === 0) return chalk.yellow(digit);
    if (fromRight === 1) return chalk.green(digit);
    return chalk.red.bold(digit);
  }).join('');
}

/**
 * One line of the game, styled when it is a scan's.
 *
 * @param line - A complete line, without its newline.
 * @returns The line to show.
 */
export function trekLine_style(line: string): string {
  const srs: RegExpExecArray | null = SRS_ROW.exec(line);
  if (srs !== null) {
    const [, row = '', cells = '', again = '', status = ''] = srs;
    let shown: string = '';
    for (let at: number = 0; at < cells.length; at += 2) {
      const one: string = cells[at] as string;
      const glyph = SECTOR[one];
      shown += `${glyph === undefined ? one : glyph(one)} `;
    }
    return `${chalk.gray(row)} ${shown}${chalk.gray(again)}${status_style(status)}`;
  }
  const lrs: RegExpExecArray | null = LRS_ROW.exec(line);
  if (lrs !== null && line.endsWith('!')) {
    const [, row = '', cells = ''] = lrs;
    const body: string = cells
      .replace(/\d+/g, (digits: string): string => count_style(digits))
      .replace(/!/g, chalk.gray('!'))
      .replace(/\*/g, chalk.gray('*'))
      .replace(/\/\/\//g, chalk.red('///'));
    return `${chalk.gray(row)} ${chalk.gray('!')}${body}`;
  }
  if (/^ {2}-+$/.test(line)) return chalk.gray(line);
  return line;
}
