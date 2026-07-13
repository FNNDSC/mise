/**
 * @file Builtin cal.
 *
 * Prints a month or year calendar, in the spirit of the UNIX `cal` command,
 * with today highlighted: `cal` (current month), `cal <year>` (whole year), and
 * `cal <month> <year>`. Pure computation — no host `cal` binary, no subprocess —
 * so it behaves the same in a local shell, over a CALYPSO daemon, and in the
 * standalone binary.
 *
 * @module
 */
import { CommandEnvelope, envelope_ok, envelope_error } from '@fnndsc/cumin';
import chalk from 'chalk';

const MONTHS_LONG: readonly string[] = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const WEEKDAY_HEADER: string = 'Su Mo Tu We Th Fr Sa';
/** Visible width of one month block (the weekday header width). */
const BLOCK_WIDTH: number = WEEKDAY_HEADER.length;

/** Today, for highlighting, or null when the rendered month is not the current one. */
interface Today {
  year: number;
  month: number;
  day: number;
}

function center(text: string, width: number): string {
  if (text.length >= width) return text;
  const left: number = Math.floor((width - text.length) / 2);
  return ' '.repeat(left) + text + ' '.repeat(width - text.length - left);
}

/**
 * Renders one month as a list of fixed-width lines: a centered title, the
 * weekday header, and the week rows. Optionally padded to `weekRows` rows so
 * month blocks align in a year grid.
 *
 * @param year - The year.
 * @param month - The 0-based month.
 * @param today - Today's date for highlighting, or null.
 * @param weekRows - Minimum week rows to emit (blank-padded); 0 for no padding.
 * @param titleWithYear - Whether the title includes the year.
 * @returns The month's lines, each {@link BLOCK_WIDTH} visible columns wide.
 */
function month_render(year: number, month: number, today: Today | null, weekRows: number, titleWithYear: boolean): string[] {
  const title: string = titleWithYear ? `${MONTHS_LONG[month]} ${year}` : MONTHS_LONG[month];
  const firstDow: number = new Date(year, month, 1).getDay();
  const daysInMonth: number = new Date(year, month + 1, 0).getDate();

  const cells: string[] = [];
  for (let i = 0; i < firstDow; i++) cells.push('  ');
  for (let d = 1; d <= daysInMonth; d++) {
    const label: string = String(d).padStart(2, ' ');
    const isToday: boolean = today !== null && today.year === year && today.month === month && today.day === d;
    cells.push(isToday ? chalk.inverse(label) : label);
  }
  while (cells.length % 7 !== 0) cells.push('  ');

  const rows: string[] = [];
  for (let i = 0; i < cells.length; i += 7) {
    rows.push(cells.slice(i, i + 7).join(' '));
  }
  while (rows.length < weekRows) rows.push(' '.repeat(BLOCK_WIDTH));

  return [center(title, BLOCK_WIDTH), WEEKDAY_HEADER, ...rows];
}

/** Renders a single month with today highlighted where applicable. */
function calendar_month(year: number, month: number, today: Today): string {
  const active: Today | null = today.year === year && today.month === month ? today : null;
  return `${month_render(year, month, active, 0, true).join('\n')}\n`;
}

/** Renders a full year as a 3-across grid of month blocks. */
function calendar_year(year: number, today: Today): string {
  const gap: string = '   ';
  const blocks: string[][] = [];
  for (let m = 0; m < 12; m++) {
    const active: Today | null = today.year === year && today.month === m ? today : null;
    blocks.push(month_render(year, m, active, 6, false));
  }

  const lines: string[] = [center(String(year), BLOCK_WIDTH * 3 + gap.length * 2), ''];
  for (let row = 0; row < 4; row++) {
    const trio: string[][] = [blocks[row * 3], blocks[row * 3 + 1], blocks[row * 3 + 2]];
    const height: number = Math.max(...trio.map((b: string[]) => b.length));
    for (let i = 0; i < height; i++) {
      lines.push(trio.map((b: string[]) => b[i] ?? ' '.repeat(BLOCK_WIDTH)).join(gap).replace(/\s+$/, ''));
    }
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
}

/**
 * Reports a calendar as a command envelope.
 *
 * `cal` shows the current month; `cal <year>` a whole year; `cal <month> <year>`
 * a specific month.
 *
 * @param args - Command arguments.
 * @returns An envelope carrying the calendar, or an error envelope on bad input.
 */
export async function builtin_cal(args: string[]): Promise<CommandEnvelope> {
  const now: Date = new Date();
  const today: Today = { year: now.getFullYear(), month: now.getMonth(), day: now.getDate() };
  const nums: number[] = args.filter((a: string) => /^\d+$/.test(a)).map(Number);

  if (nums.length === 0) {
    return envelope_ok(calendar_month(today.year, today.month, today), { kind: 'sys.cal', data: { year: today.year, month: today.month + 1 } });
  }
  if (nums.length === 1) {
    const year: number = nums[0];
    if (year < 1 || year > 9999) return envelope_error(`${chalk.red(`cal: year ${year} out of range (1..9999)`)}\n`);
    return envelope_ok(calendar_year(year, today), { kind: 'sys.cal', data: { year } });
  }
  const [month, year]: number[] = nums;
  if (month < 1 || month > 12) return envelope_error(`${chalk.red(`cal: ${month} is not a month number (1..12)`)}\n`);
  if (year < 1 || year > 9999) return envelope_error(`${chalk.red(`cal: year ${year} out of range (1..9999)`)}\n`);
  return envelope_ok(calendar_month(year, month - 1, today), { kind: 'sys.cal', data: { year, month } });
}
