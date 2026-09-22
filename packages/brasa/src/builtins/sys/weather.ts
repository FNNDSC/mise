/**
 * @file Builtin weather.
 *
 * Reports the weather at a place — the current conditions and the next few
 * days — from Open-Meteo, which needs no key and no account. A place is
 * geocoded by name through the same service, so `weather Boston` and
 * `weather Cape Town` both work, and a bare `weather` asks about Boston,
 * where the lab is.
 *
 * The report is a kernel fact like `date` or `fortune`: it renders once and
 * every surface shows the same text, and the typed model beneath it carries
 * the numbers for a surface that wants to draw them differently. The
 * network reached is the daemon's, so a host that cannot see the internet
 * says so in one line rather than hanging.
 *
 * @module
 */
import { CommandEnvelope, envelope_error, envelope_ok } from '@fnndsc/cumin';

/** Where `weather` looks when given no place. */
export const WEATHER_DEFAULT_PLACE: string = 'Boston';

/** Days of forecast shown when none are asked for. */
const DAYS_DEFAULT: number = 3;

/** The most forecast days Open-Meteo answers. */
const DAYS_MAX: number = 16;

/** How long one call may take before the report gives up. */
const FETCH_TIMEOUT_MS: number = 8_000;

/** The geocoder: a name to coordinates. */
const GEOCODE_URL: string = 'https://geocoding-api.open-meteo.com/v1/search';

/** The forecast itself. */
const FORECAST_URL: string = 'https://api.open-meteo.com/v1/forecast';

/**
 * A fetch the report goes through — the global one in a daemon, a stub in
 * a test.
 */
export type WeatherFetch = (url: string, init?: RequestInit) => Promise<Response>;

/** The compass, eight points, clockwise from north. */
const COMPASS: readonly string[] = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

/** WMO weather interpretation codes, as Open-Meteo reports them, in words. */
const CONDITIONS: Record<number, string> = {
  0: 'clear sky',
  1: 'mainly clear',
  2: 'partly cloudy',
  3: 'overcast',
  45: 'fog',
  48: 'rime fog',
  51: 'light drizzle',
  53: 'drizzle',
  55: 'dense drizzle',
  56: 'light freezing drizzle',
  57: 'freezing drizzle',
  61: 'light rain',
  63: 'rain',
  65: 'heavy rain',
  66: 'light freezing rain',
  67: 'freezing rain',
  71: 'light snow',
  73: 'snow',
  75: 'heavy snow',
  77: 'snow grains',
  80: 'light rain showers',
  81: 'rain showers',
  82: 'violent rain showers',
  85: 'light snow showers',
  86: 'heavy snow showers',
  95: 'thunderstorm',
  96: 'thunderstorm with light hail',
  99: 'thunderstorm with heavy hail',
};

/** A place the geocoder answered with. */
export interface WeatherPlace {
  name: string;
  region: string;
  country: string;
  latitude: number;
  longitude: number;
  timezone: string;
}

/** The conditions now. */
export interface WeatherNow {
  time: string;
  temperature: number;
  apparent: number;
  humidity: number;
  code: number;
  condition: string;
  windSpeed: number;
  windDirection: string;
}

/** One day of the forecast. */
export interface WeatherDay {
  date: string;
  low: number;
  high: number;
  code: number;
  condition: string;
}

/** The report, as the model beneath the rendered text. */
export interface WeatherReport {
  place: WeatherPlace;
  units: 'F' | 'C';
  now: WeatherNow;
  days: WeatherDay[];
}

/** What the geocoder answers, as much of it as the report reads. */
interface GeocodeAnswer {
  results?: Array<{
    name?: unknown;
    admin1?: unknown;
    country?: unknown;
    latitude?: unknown;
    longitude?: unknown;
    timezone?: unknown;
  }>;
}

/** What the forecast answers, as much of it as the report reads. */
interface ForecastAnswer {
  current?: {
    time?: unknown;
    temperature_2m?: unknown;
    apparent_temperature?: unknown;
    relative_humidity_2m?: unknown;
    weather_code?: unknown;
    wind_speed_10m?: unknown;
    wind_direction_10m?: unknown;
  };
  daily?: {
    time?: unknown;
    temperature_2m_max?: unknown;
    temperature_2m_min?: unknown;
    weather_code?: unknown;
  };
}

/** The words a call line was parsed into. */
interface WeatherArgs {
  place: string;
  celsius: boolean;
  days: number;
}

/**
 * Words a WMO weather code.
 *
 * @param code - The code Open-Meteo reported.
 * @returns The condition in words; an unknown code says so with its number.
 */
export function condition_ofCode(code: number): string {
  return CONDITIONS[code] ?? `conditions code ${code}`;
}

/**
 * Names a wind direction on the eight-point compass.
 *
 * @param degrees - Where the wind comes from, degrees clockwise from north.
 * @returns The compass point.
 */
export function compass_ofDegrees(degrees: number): string {
  const index: number = Math.round((((degrees % 360) + 360) % 360) / 45) % 8;
  return COMPASS[index];
}

/**
 * Reads a number out of an untyped JSON field.
 *
 * @param value - The field.
 * @returns The number, or null when the field is not one.
 */
function number_read(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Reads a string out of an untyped JSON field.
 *
 * @param value - The field.
 * @returns The string, or the empty string when the field is not one.
 */
function string_read(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/**
 * Parses the call line: a place in as many words as it takes, `-c` for
 * Celsius, `-d N` for the days shown. Any other flag is refused by name.
 *
 * @param args - The words after `weather`.
 * @returns The parsed call, or the refusal to print.
 */
export function weatherArgs_parse(args: string[]): WeatherArgs | string {
  const words: string[] = [];
  let celsius: boolean = false;
  let days: number = DAYS_DEFAULT;
  for (let i: number = 0; i < args.length; i++) {
    const arg: string = args[i];
    if (arg === '-c' || arg === '--celsius') {
      celsius = true;
    } else if (arg === '-d' || arg === '--days') {
      const value: number = parseInt(args[i + 1] ?? '', 10);
      if (!Number.isFinite(value) || value < 1 || value > DAYS_MAX) {
        return `weather: ${arg} takes a number of days, 1 to ${DAYS_MAX}`;
      }
      days = value;
      i++;
    } else if (arg.startsWith('-')) {
      return `weather: unknown option '${arg}' (usage: weather [place] [-c|--celsius] [-d|--days N])`;
    } else {
      words.push(arg);
    }
  }
  return { place: words.length > 0 ? words.join(' ') : WEATHER_DEFAULT_PLACE, celsius, days };
}

/**
 * Fetches one JSON answer, bounded in time.
 *
 * @param fetchFn - The fetch to go through.
 * @param url - What to ask.
 * @returns The parsed body.
 * @throws {Error} When the service is unreachable, answers an error, or
 *   answers something that is not JSON.
 */
async function json_fetch(fetchFn: WeatherFetch, url: string): Promise<unknown> {
  const response: Response = await fetchFn(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`open-meteo answered ${response.status}`);
  return response.json();
}

/**
 * Finds a place by name.
 *
 * @param fetchFn - The fetch to go through.
 * @param name - The place as the operator typed it.
 * @returns The first place the geocoder offers, or null when it offers none.
 */
export async function place_find(fetchFn: WeatherFetch, name: string): Promise<WeatherPlace | null> {
  const url: string = `${GEOCODE_URL}?name=${encodeURIComponent(name)}&count=1&language=en&format=json`;
  const answer: GeocodeAnswer = (await json_fetch(fetchFn, url)) as GeocodeAnswer;
  const first = answer.results?.[0];
  const latitude: number | null = number_read(first?.latitude);
  const longitude: number | null = number_read(first?.longitude);
  if (first === undefined || latitude === null || longitude === null) return null;
  return {
    name: string_read(first.name),
    region: string_read(first.admin1),
    country: string_read(first.country),
    latitude,
    longitude,
    timezone: string_read(first.timezone) || 'auto',
  };
}

/**
 * Fetches the conditions at a place.
 *
 * @param fetchFn - The fetch to go through.
 * @param place - Where.
 * @param celsius - Celsius and km/h rather than Fahrenheit and mph.
 * @param days - How many days of forecast.
 * @returns The report.
 * @throws {Error} When the service cannot be reached or answers without the
 *   fields a report is made of.
 */
export async function report_fetch(
  fetchFn: WeatherFetch,
  place: WeatherPlace,
  celsius: boolean,
  days: number,
): Promise<WeatherReport> {
  const query: string = [
    `latitude=${place.latitude}`,
    `longitude=${place.longitude}`,
    'current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,wind_direction_10m',
    'daily=weather_code,temperature_2m_max,temperature_2m_min',
    `temperature_unit=${celsius ? 'celsius' : 'fahrenheit'}`,
    `wind_speed_unit=${celsius ? 'kmh' : 'mph'}`,
    `timezone=${encodeURIComponent(place.timezone)}`,
    `forecast_days=${days}`,
  ].join('&');
  const answer: ForecastAnswer = (await json_fetch(fetchFn, `${FORECAST_URL}?${query}`)) as ForecastAnswer;
  const current = answer.current;
  const temperature: number | null = number_read(current?.temperature_2m);
  const code: number | null = number_read(current?.weather_code);
  if (current === undefined || temperature === null || code === null) {
    throw new Error('open-meteo answered without current conditions');
  }
  const now: WeatherNow = {
    time: string_read(current.time),
    temperature,
    apparent: number_read(current.apparent_temperature) ?? temperature,
    humidity: number_read(current.relative_humidity_2m) ?? 0,
    code,
    condition: condition_ofCode(code),
    windSpeed: number_read(current.wind_speed_10m) ?? 0,
    windDirection: compass_ofDegrees(number_read(current.wind_direction_10m) ?? 0),
  };
  const dates: unknown[] = Array.isArray(answer.daily?.time) ? answer.daily.time : [];
  const highs: unknown[] = Array.isArray(answer.daily?.temperature_2m_max) ? answer.daily.temperature_2m_max : [];
  const lows: unknown[] = Array.isArray(answer.daily?.temperature_2m_min) ? answer.daily.temperature_2m_min : [];
  const codes: unknown[] = Array.isArray(answer.daily?.weather_code) ? answer.daily.weather_code : [];
  const forecast: WeatherDay[] = [];
  for (let i: number = 0; i < dates.length; i++) {
    const high: number | null = number_read(highs[i]);
    const low: number | null = number_read(lows[i]);
    const dayCode: number | null = number_read(codes[i]);
    if (high === null || low === null || dayCode === null) continue;
    forecast.push({ date: string_read(dates[i]), low, high, code: dayCode, condition: condition_ofCode(dayCode) });
  }
  return { place, units: celsius ? 'C' : 'F', now, days: forecast };
}

/**
 * Names a forecast day: `today`, then the weekday and date.
 *
 * @param date - The day as `YYYY-MM-DD`.
 * @param index - Its position in the forecast, 0 being today.
 * @returns The label.
 */
function day_label(date: string, index: number): string {
  if (index === 0) return 'today';
  const parsed: Date = new Date(`${date}T12:00:00Z`);
  const weekday: string = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][parsed.getUTCDay()] ?? '';
  return `${weekday} ${date.slice(5)}`;
}

/**
 * Renders a report as the lines a terminal shows.
 *
 * @param report - The report.
 * @returns The text, with a trailing newline.
 */
export function report_render(report: WeatherReport): string {
  const unit: string = `°${report.units}`;
  const speed: string = report.units === 'C' ? 'km/h' : 'mph';
  const where: string = [report.place.name, report.place.region, report.place.country]
    .filter((part: string): boolean => part.length > 0)
    .join(', ');
  const when: string = report.now.time.replace('T', ' ');
  const lines: string[] = [
    `${where} · ${when}`,
    `  now       ${Math.round(report.now.temperature)}${unit} (feels ${Math.round(report.now.apparent)}${unit}) · ${report.now.condition} · wind ${Math.round(report.now.windSpeed)} ${speed} ${report.now.windDirection} · humidity ${Math.round(report.now.humidity)}%`,
  ];
  report.days.forEach((day: WeatherDay, index: number): void => {
    lines.push(`  ${day_label(day.date, index).padEnd(9)} ${Math.round(day.low)}–${Math.round(day.high)}${unit} · ${day.condition}`);
  });
  return `${lines.join('\n')}\n`;
}

/**
 * Reports the weather at a place.
 *
 * @param args - `[place…] [-c|--celsius] [-d|--days N]`.
 * @param fetchFn - The fetch to go through; the global one unless a test
 *   hands in its own.
 * @returns An envelope carrying the rendered report and the typed report
 *   beneath it; an error envelope when a flag is unknown, the place is not
 *   found, or the service cannot be reached.
 */
export async function builtin_weather(
  args: string[],
  fetchFn: WeatherFetch = (url: string, init?: RequestInit): Promise<Response> => fetch(url, init),
): Promise<CommandEnvelope> {
  const parsed: WeatherArgs | string = weatherArgs_parse(args);
  if (typeof parsed === 'string') return envelope_error(`${parsed}\n`);
  try {
    const place: WeatherPlace | null = await place_find(fetchFn, parsed.place);
    if (place === null) return envelope_error(`weather: no such place '${parsed.place}'\n`);
    const report: WeatherReport = await report_fetch(fetchFn, place, parsed.celsius, parsed.days);
    return envelope_ok(report_render(report), { kind: 'sys.weather', data: report });
  } catch (error: unknown) {
    const reason: string = error instanceof Error ? error.message : String(error);
    return envelope_error(`weather: ${reason}\n`);
  }
}
