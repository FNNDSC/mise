/**
 * @file Builtin date.
 *
 * Prints the current date and time, in the spirit of the UNIX `date` command:
 * the default human format, `-u` for UTC, and `+FORMAT` strftime-style format
 * strings. Pure computation — no host `date` binary, no subprocess — so it
 * behaves the same in a local shell, over a CALYPSO daemon, and in the
 * standalone binary. It reports the time only; it never sets the clock.
 *
 * @module
 */
import { CommandEnvelope, envelope_ok } from '@fnndsc/cumin';

const DAYS_LONG: readonly string[] = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAYS_SHORT: readonly string[] = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS_LONG: readonly string[] = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const MONTHS_SHORT: readonly string[] = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** The default output format, matching UNIX `date`: `Sun Jul 13 20:30:00 EDT 2026`. */
const DEFAULT_FORMAT: string = '%a %b %e %H:%M:%S %Z %Y';

/** Composite specifiers, expanded to their component format before the simple pass. */
const COMPOSITE: Record<string, string> = {
  D: '%m/%d/%y',
  F: '%Y-%m-%d',
  T: '%H:%M:%S',
  R: '%H:%M',
  c: '%a %b %e %H:%M:%S %Y',
};

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** The short timezone name (e.g. `EDT`), or `UTC` in UTC mode. */
function timezone_abbrev(date: Date, utc: boolean): string {
  if (utc) return 'UTC';
  try {
    const parts: Intl.DateTimeFormatPart[] = new Intl.DateTimeFormat('en-US', { timeZoneName: 'short' }).formatToParts(date);
    return parts.find((p: Intl.DateTimeFormatPart) => p.type === 'timeZoneName')?.value ?? '';
  } catch {
    return '';
  }
}

/** The numeric UTC offset as `+hhmm` / `-hhmm` (`+0000` in UTC mode). */
function timezone_offset(date: Date, utc: boolean): string {
  const minutes: number = utc ? 0 : -date.getTimezoneOffset();
  const sign: string = minutes < 0 ? '-' : '+';
  const abs: number = Math.abs(minutes);
  return `${sign}${pad2(Math.floor(abs / 60))}${pad2(abs % 60)}`;
}

/** The 1-based day of the year. */
function day_ofYear(year: number, month: number, day: number): number {
  const start: number = Date.UTC(year, 0, 1);
  const current: number = Date.UTC(year, month, day);
  return Math.floor((current - start) / 86_400_000) + 1;
}

/**
 * Formats a date with a strftime-style format string.
 *
 * @param date - The instant to format.
 * @param format - A strftime-style format string (e.g. `%Y-%m-%d`).
 * @param utc - Whether to render in UTC rather than local time.
 * @returns The formatted string.
 */
export function date_format(date: Date, format: string, utc: boolean): string {
  const year: number = utc ? date.getUTCFullYear() : date.getFullYear();
  const month: number = utc ? date.getUTCMonth() : date.getMonth();
  const day: number = utc ? date.getUTCDate() : date.getDate();
  const dow: number = utc ? date.getUTCDay() : date.getDay();
  const hours: number = utc ? date.getUTCHours() : date.getHours();
  const minutes: number = utc ? date.getUTCMinutes() : date.getMinutes();
  const seconds: number = utc ? date.getUTCSeconds() : date.getSeconds();
  const hour12: number = hours % 12 === 0 ? 12 : hours % 12;

  const simple: Record<string, string> = {
    Y: String(year),
    y: pad2(year % 100),
    m: pad2(month + 1),
    d: pad2(day),
    e: String(day).padStart(2, ' '),
    H: pad2(hours),
    I: pad2(hour12),
    M: pad2(minutes),
    S: pad2(seconds),
    p: hours < 12 ? 'AM' : 'PM',
    P: hours < 12 ? 'am' : 'pm',
    A: DAYS_LONG[dow],
    a: DAYS_SHORT[dow],
    B: MONTHS_LONG[month],
    b: MONTHS_SHORT[month],
    h: MONTHS_SHORT[month],
    j: String(day_ofYear(year, month, day)).padStart(3, '0'),
    u: String(dow === 0 ? 7 : dow),
    w: String(dow),
    Z: timezone_abbrev(date, utc),
    z: timezone_offset(date, utc),
    s: String(Math.floor(date.getTime() / 1000)),
    n: '\n',
    t: '\t',
    '%': '%',
  };

  const expanded: string = format.replace(/%[DFTRc]/g, (m: string): string => COMPOSITE[m[1]]);
  return expanded.replace(/%([A-Za-z%])/g, (m: string, code: string): string => (code in simple ? simple[code] : m));
}

/**
 * Reports the current date/time as a command envelope.
 *
 * Supports `-u`/`--utc` for UTC and a `+FORMAT` strftime-style argument;
 * otherwise the default `date` format is used.
 *
 * @param args - Command arguments.
 * @returns An envelope carrying the formatted date and an ISO/unix model.
 */
export async function builtin_date(args: string[]): Promise<CommandEnvelope> {
  const utc: boolean = args.includes('-u') || args.includes('--utc');
  const formatArg: string | undefined = args.find((a: string) => a.startsWith('+'));
  const now: Date = new Date();
  const rendered: string = date_format(now, formatArg ? formatArg.slice(1) : DEFAULT_FORMAT, utc);
  return envelope_ok(`${rendered}\n`, {
    kind: 'sys.date',
    data: { iso: now.toISOString(), unix: Math.floor(now.getTime() / 1000) },
  });
}
