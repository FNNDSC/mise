/**
 * @file Time and sky from the shelf: `pom`, `stardate`, `ddate`, `sunrise`.
 *
 * `pom` is BSD's phase of the moon; `stardate` reckons the day two ways;
 * `ddate` is the Discordian calendar, holy days included; `sunrise` asks
 * Open-Meteo (the service `weather` already uses, no key) when the sun
 * rises and sets at a place.
 *
 * @module
 */
import { CommandEnvelope, envelope_ok, envelope_error } from '@fnndsc/cumin';
import chalk from 'chalk';
import { WEATHER_DEFAULT_PLACE, place_find, type WeatherFetch, type WeatherPlace } from '../sys/weather.js';

/* --------------------------------------------------------------- moon */

/** A reference new moon: 2000-01-06 18:14 UTC, as a Julian day. */
const NEW_MOON_JD: number = 2451550.1;
/** The synodic month, in days. */
const SYNODIC_DAYS: number = 29.530588853;

/** A date as a Julian day. */
export function julianDay_of(date: Date): number {
  return date.getTime() / 86_400_000 + 2440587.5;
}

/** The moon's state on a date. */
export interface MoonPhase {
  /** 0 at new, 0.5 at full, in [0, 1). */
  phase: number;
  /** The lit fraction, 0..1. */
  illumination: number;
  /** The phase's name. */
  name: string;
  /** Days to the next full moon and the next new moon. */
  toFull: number;
  toNew: number;
}

/** Where the moon stands on a date. */
export function moon_phase(date: Date): MoonPhase {
  const cycles: number = (julianDay_of(date) - NEW_MOON_JD) / SYNODIC_DAYS;
  const phase: number = cycles - Math.floor(cycles);
  const illumination: number = (1 - Math.cos(2 * Math.PI * phase)) / 2;
  const near = (p: number): boolean => Math.abs(phase - p) < 0.034 || Math.abs(phase - p - 1) < 0.034;
  const name: string = near(0) ? 'New Moon' : near(0.25) ? 'First Quarter' : near(0.5) ? 'Full Moon' : near(0.75) ? 'Last Quarter'
    : phase < 0.25 ? 'Waxing Crescent' : phase < 0.5 ? 'Waxing Gibbous' : phase < 0.75 ? 'Waning Gibbous' : 'Waning Crescent';
  const toFull: number = ((0.5 - phase + 1) % 1) * SYNODIC_DAYS;
  const toNew: number = ((1 - phase) % 1) * SYNODIC_DAYS;
  return { phase, illumination, name, toFull, toNew };
}

/** A small moon, lit from the side the phase lights. */
export function moon_draw(phase: MoonPhase): string[] {
  const lit: number = phase.illumination;
  const waxing: boolean = phase.phase < 0.5;
  const rows: string[] = [];
  const radius: number = 4;
  for (let y: number = -radius; y <= radius; y++) {
    let row: string = '';
    for (let x: number = -radius * 2; x <= radius * 2; x++) {
      const dx: number = x / 2;
      const inside: boolean = dx * dx + y * y <= radius * radius + 0.5;
      if (!inside) { row += ' '; continue; }
      const half: number = Math.sqrt(Math.max(0, radius * radius - y * y));
      // The terminator: a chord moving across the disc as the phase goes.
      const edge: number = (1 - 2 * lit) * half;
      const bright: boolean = waxing ? dx >= edge : dx <= -edge;
      row += bright ? '@' : '.';
    }
    rows.push(row.trimEnd());
  }
  return rows;
}

/** `pom [YYYY-MM-DD]` */
export async function builtin_pom(args: string[]): Promise<CommandEnvelope> {
  const date: Date = args.length > 0 ? new Date(args.join(' ')) : new Date();
  if (Number.isNaN(date.getTime())) return envelope_error('', undefined, `pom: '${args.join(' ')}' is not a date (try pom 2026-12-25)\n`);
  const moon: MoonPhase = moon_phase(date);
  const percent: number = Math.round(moon.illumination * 100);
  const trend: string = moon.name === 'Full Moon' || moon.name === 'New Moon' ? '' : moon.phase < 0.5 ? ' (waxing)' : ' (waning)';
  const lines: string[] = [
    `The Moon is ${chalk.bold(moon.name)}${trend}: ${percent}% of the Full`,
    `${chalk.gray(`next full moon in ${moon.toFull.toFixed(1)} days, next new moon in ${moon.toNew.toFixed(1)} days`)}`,
    ...moon_draw(moon).map((row: string): string => `   ${row}`),
  ];
  return envelope_ok(`${lines.join('\n')}\n`, { kind: 'games.pom', data: { date: date.toISOString(), ...moon } });
}

/* ----------------------------------------------------------- stardate */

/** Days into the year, 1-based, and the year's length. */
function yearDay_of(date: Date): { day: number; days: number; fraction: number } {
  const start: number = Date.UTC(date.getUTCFullYear(), 0, 1);
  const next: number = Date.UTC(date.getUTCFullYear() + 1, 0, 1);
  const elapsed: number = date.getTime() - start;
  const days: number = Math.round((next - start) / 86_400_000);
  return { day: Math.floor(elapsed / 86_400_000) + 1, days, fraction: elapsed / (next - start) };
}

/** The stardate two ways: the Kelvin films' `YYYY.DDD`, and TNG's thousand-per-year from 2323. */
export function stardate_of(date: Date): { kelvin: string; tng: string } {
  const { day, fraction } = yearDay_of(date);
  const year: number = date.getUTCFullYear();
  const kelvin: string = `${year}.${String(day).padStart(3, '0')}`;
  const tng: number = (year - 2323) * 1000 + fraction * 1000;
  return { kelvin, tng: tng.toFixed(1) };
}

/** `stardate` */
export async function builtin_stardate(args: string[]): Promise<CommandEnvelope> {
  const date: Date = args.length > 0 ? new Date(args.join(' ')) : new Date();
  if (Number.isNaN(date.getTime())) return envelope_error('', undefined, `stardate: '${args.join(' ')}' is not a date\n`);
  const sd = stardate_of(date);
  const lines: string[] = [
    `Stardate ${chalk.bold(sd.kelvin)}`,
    chalk.gray(`(Kelvin reckoning: the year and the day of it; by TNG's count it is ${sd.tng} — that era is still ahead of us)`),
  ];
  return envelope_ok(`${lines.join('\n')}\n`, { kind: 'games.stardate', data: { date: date.toISOString(), ...sd } });
}

/* -------------------------------------------------------------- ddate */

const SEASONS: ReadonlyArray<string> = ['Chaos', 'Discord', 'Confusion', 'Bureaucracy', 'The Aftermath'];
const WEEKDAYS: ReadonlyArray<string> = ['Sweetmorn', 'Boomtime', 'Pungenday', 'Prickle-Prickle', 'Setting Orange'];
const APOSTLE_DAYS: ReadonlyArray<string> = ['Mungday', 'Mojoday', 'Syaday', 'Zaraday', 'Maladay'];
const SEASON_DAYS: ReadonlyArray<string> = ['Chaoflux', 'Discoflux', 'Confuflux', 'Bureflux', 'Afflux'];

/** The Discordian date of a Gregorian one. */
export interface DiscordianDate {
  yold: number;
  season: string;
  day: number;
  weekday: string;
  holyday: string | null;
  tibs: boolean;
}

export function ddate_of(date: Date): DiscordianDate {
  const year: number = date.getFullYear();
  const yold: number = year + 1166;
  const start: Date = new Date(year, 0, 1);
  const doy: number = Math.round((new Date(year, date.getMonth(), date.getDate()).getTime() - start.getTime()) / 86_400_000) + 1;
  const leap: boolean = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  if (leap && doy === 60) return { yold, season: 'Chaos', day: 0, weekday: '', holyday: "St. Tib's Day", tibs: true };
  const adjusted: number = leap && doy > 60 ? doy - 1 : doy;
  const season: number = Math.floor((adjusted - 1) / 73);
  const day: number = ((adjusted - 1) % 73) + 1;
  const weekday: string = WEEKDAYS[(adjusted - 1) % 5] as string;
  const holyday: string | null = day === 5 ? (APOSTLE_DAYS[season] as string) : day === 50 ? (SEASON_DAYS[season] as string) : null;
  return { yold, season: SEASONS[season] as string, day, weekday, holyday, tibs: false };
}

/** 1st, 2nd, 3rd, 4th … 11th, 12th, 13th … 21st. */
export function ordinal_of(n: number): string {
  const rest: number = n % 100;
  if (rest >= 11 && rest <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
}

/** `ddate [YYYY-MM-DD]` */
export async function builtin_ddate(args: string[]): Promise<CommandEnvelope> {
  const date: Date = args.length > 0 ? new Date(args.join(' ')) : new Date();
  if (Number.isNaN(date.getTime())) return envelope_error('', undefined, `ddate: '${args.join(' ')}' is not a date\n`);
  const d: DiscordianDate = ddate_of(date);
  const line: string = d.tibs
    ? `Today is St. Tib's Day in the YOLD ${d.yold}`
    : `Today is ${d.weekday}, the ${ordinal_of(d.day)} day of ${d.season} in the YOLD ${d.yold}${d.holyday === null ? '' : `\nCelebrate ${d.holyday}!`}`;
  return envelope_ok(`${line}\n`, { kind: 'games.ddate', data: { date: date.toISOString(), ...d } });
}

/* ------------------------------------------------------------ sunrise */

const FORECAST_URL: string = 'https://api.open-meteo.com/v1/forecast';
const FETCH_TIMEOUT_MS: number = 8_000;

/** What Open-Meteo says of one day's sun. */
export interface SunDay { date: string; sunrise: string; sunset: string; daylightSeconds: number }

/**
 * Asks Open-Meteo when the sun rises and sets at a place, today and tomorrow.
 *
 * @param fetchFn - The fetch to use.
 * @param place - Where.
 */
export async function sun_fetch(fetchFn: WeatherFetch, place: WeatherPlace): Promise<SunDay[]> {
  const url: string = `${FORECAST_URL}?latitude=${place.latitude}&longitude=${place.longitude}&daily=sunrise,sunset,daylight_duration&timezone=auto&forecast_days=2`;
  const response: Response = await fetchFn(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`open-meteo answered ${response.status}`);
  const answer = (await response.json()) as { daily?: { time?: string[]; sunrise?: string[]; sunset?: string[]; daylight_duration?: number[] } };
  const daily = answer.daily ?? {};
  return (daily.time ?? []).map((date: string, i: number): SunDay => ({
    date,
    sunrise: daily.sunrise?.[i] ?? '',
    sunset: daily.sunset?.[i] ?? '',
    daylightSeconds: daily.daylight_duration?.[i] ?? 0,
  }));
}

/** `HH:MM` out of an ISO local time. */
const clock_of = (iso: string): string => iso.slice(11, 16) || '?';

/** `sunrise [place]` */
export async function builtin_sunrise(
  args: string[],
  fetchFn: WeatherFetch = (url: string, init?: RequestInit): Promise<Response> => fetch(url, init),
): Promise<CommandEnvelope> {
  const name: string = args.length > 0 ? args.join(' ') : WEATHER_DEFAULT_PLACE;
  try {
    const place: WeatherPlace | null = await place_find(fetchFn, name);
    if (place === null) return envelope_error('', undefined, `sunrise: no place called '${name}' that open-meteo knows\n`);
    const days: SunDay[] = await sun_fetch(fetchFn, place);
    if (days.length === 0) return envelope_error('', undefined, `sunrise: open-meteo had no days for ${place.name}\n`);
    const where: string = [place.name, place.region, place.country].filter((p: string): boolean => p.length > 0).join(', ');
    const lines: string[] = [chalk.bold(where)];
    for (const [i, day] of days.entries()) {
      const hours: number = Math.floor(day.daylightSeconds / 3600);
      const minutes: number = Math.round((day.daylightSeconds % 3600) / 60);
      lines.push(`${i === 0 ? 'today   ' : 'tomorrow'} ${day.date}  sunrise ${chalk.yellow(clock_of(day.sunrise))}  sunset ${chalk.yellow(clock_of(day.sunset))}  ${chalk.gray(`${hours}h ${String(minutes).padStart(2, '0')}m of daylight`)}`);
    }
    return envelope_ok(`${lines.join('\n')}\n`, { kind: 'games.sunrise', data: { place, days } });
  } catch (error: unknown) {
    return envelope_error('', undefined, `sunrise: ${error instanceof Error ? error.message : String(error)}\n`);
  }
}
