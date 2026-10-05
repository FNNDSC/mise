/**
 * @file Time and sky on the games shelf: the moon, the stardate, the
 * Discordian date, the sun at a place, and the chimes.
 */
import { jest, describe, it, expect, afterEach } from '@jest/globals';

const published: unknown[] = [];
jest.unstable_mockModule('@fnndsc/cumin', () => ({
  envelope_ok: (rendered: string, model?: unknown) => ({ status: 'ok', rendered, model }),
  envelope_error: (rendered: string, _errors?: unknown, renderedErr?: string) => (renderedErr !== undefined ? { status: 'error', rendered, renderedErr } : { status: 'error', rendered }),
}));
jest.unstable_mockModule('../src/core/ambient.js', () => ({ ambient_publish: (event: unknown): void => { published.push(event); } }));
jest.unstable_mockModule('../src/builtins/sys/weather.js', () => ({
  WEATHER_DEFAULT_PLACE: 'Boston',
  place_find: async (_fetch: unknown, name: string) => (name === 'Nowhere' ? null : { name, region: 'MA', country: 'US', latitude: 42.36, longitude: -71.06, timezone: 'America/New_York' }),
}));

const { moon_phase, moon_draw, stardate_of, ddate_of, ordinal_of, builtin_pom, builtin_ddate, builtin_sunrise, sun_fetch } = await import('../src/builtins/games/sky.js');
const { chime_set, chimes_list, chimes_cancel, duration_parse, leave_delay, span_words, builtin_timer, builtin_leave, builtin_stopwatch, stopwatch_reset } = await import('../src/builtins/games/chimes.js');

const plain = (text: string): string => text.replace(/\x1b\[[0-9;]*m/g, '');

describe('pom', () => {
  it('knows a new moon and a full moon', () => {
    const newMoon = moon_phase(new Date('2000-01-06T18:14:00Z'));
    expect(newMoon.name).toBe('New Moon');
    expect(newMoon.illumination).toBeLessThan(0.01);
    const full = moon_phase(new Date('2000-01-21T04:40:00Z'));
    expect(full.name).toBe('Full Moon');
    expect(full.illumination).toBeGreaterThan(0.99);
    expect(moon_phase(new Date('2000-01-14T00:00:00Z')).name).toBe('First Quarter');
  });

  it('draws a disc and says the percent', async () => {
    const rows: string[] = moon_draw(moon_phase(new Date('2000-01-21T04:40:00Z')));
    expect(rows.length).toBe(9);
    expect(rows.join('')).toMatch(/@/);
    const out: string = plain((await builtin_pom(['2000-01-21T04:40:00Z'])).rendered);
    expect(out).toMatch(/Full Moon: 100% of the Full/);
    expect((await builtin_pom(['never'])).status).toBe('error');
  });
});

describe('stardate and ddate', () => {
  it('reckons the stardate two ways', () => {
    const sd = stardate_of(new Date('2026-10-05T12:00:00Z'));
    expect(sd.kelvin).toBe('2026.278');
    expect(Number(sd.tng)).toBeCloseTo(-296239.7, 1);
  });

  it('knows the Discordian calendar, its holy days and St. Tib', async () => {
    const d = ddate_of(new Date(2026, 9, 5));
    expect(d).toMatchObject({ yold: 3192, season: 'Bureaucracy', day: 59, weekday: 'Pungenday', holyday: null, tibs: false });
    expect(ddate_of(new Date(2026, 0, 5)).holyday).toBe('Mungday');
    expect(ddate_of(new Date(2026, 0, 1))).toMatchObject({ season: 'Chaos', day: 1, weekday: 'Sweetmorn' });
    expect(ddate_of(new Date(2028, 1, 29)).tibs).toBe(true);
    expect(ddate_of(new Date(2028, 2, 1))).toMatchObject({ season: 'Chaos', day: 60 });
    expect(ordinal_of(1)).toBe('1st'); expect(ordinal_of(12)).toBe('12th'); expect(ordinal_of(23)).toBe('23rd'); expect(ordinal_of(57)).toBe('57th');
    expect(plain((await builtin_ddate(['2026-10-05T12:00:00'])).rendered)).toBe('Today is Pungenday, the 59th day of Bureaucracy in the YOLD 3192\n');
  });
});

describe('sunrise', () => {
  const fakeFetch = async (url: string): Promise<Response> => {
    expect(url).toContain('daily=sunrise,sunset,daylight_duration');
    return { ok: true, status: 200, json: async () => ({ daily: { time: ['2026-10-05', '2026-10-06'], sunrise: ['2026-10-05T06:48', '2026-10-06T06:49'], sunset: ['2026-10-05T18:14', '2026-10-06T18:12'], daylight_duration: [41160, 40980] } }) } as unknown as Response;
  };

  it('asks for the sun at a place and says the days', async () => {
    const days = await sun_fetch(fakeFetch as never, { name: 'Boston', region: '', country: '', latitude: 1, longitude: 2, timezone: 'auto' });
    expect(days.length).toBe(2);
    const out: string = plain((await builtin_sunrise([], fakeFetch as never)).rendered);
    expect(out).toContain('Boston, MA, US');
    expect(out).toMatch(/today\s+2026-10-05\s+sunrise 06:48\s+sunset 18:14\s+11h 26m of daylight/);
    expect((await builtin_sunrise(['Nowhere'], fakeFetch as never)).status).toBe('error');
  });
});

describe('chimes', () => {
  afterEach(() => { chimes_cancel('all'); published.length = 0; jest.useRealTimers(); stopwatch_reset(); });

  it('reads durations and leave times', () => {
    expect(duration_parse('90s')).toBe(90_000);
    expect(duration_parse('5m')).toBe(300_000);
    expect(duration_parse('1h30m')).toBe(5_400_000);
    expect(duration_parse('2:30')).toBe(150_000);
    expect(duration_parse('1:00:00')).toBe(3_600_000);
    expect(duration_parse('7')).toBe(420_000);
    expect(duration_parse('soon')).toBeNull();
    expect(span_words(5_400_000)).toBe('1h 30m');
    expect(span_words(90_000)).toBe('1m 30s');
    const now: Date = new Date(2026, 9, 5, 17, 0, 0);
    expect(leave_delay('+0030', now)).toBe(30 * 60_000);
    expect(leave_delay('1730', now)).toBe(30 * 60_000);
    expect(leave_delay('16:00', now)).toBe(23 * 3_600_000);
    expect(leave_delay('2560', now)).toBeNull();
  });

  it('sounds a chime on the ambient channel when its time comes, and no sooner', () => {
    jest.useFakeTimers();
    const chime = chime_set(2_000, 'tea', 'timer');
    expect(chimes_list().map((c) => c.id)).toEqual([chime.id]);
    jest.advanceTimersByTime(1_900);
    expect(published.length).toBe(0);
    jest.advanceTimersByTime(200);
    expect(published.length).toBe(1);
    const event = published[0] as { kind: string; envelope: { model: { kind: string; data: { text: string } } } };
    expect(event.kind).toBe('envelope');
    expect(event.envelope.model.kind).toBe('games.chime');
    expect(event.envelope.model.data.text).toBe('tea');
    expect(chimes_list()).toEqual([]);
  });

  it('timer sets, lists and cancels; leave sets its three words', async () => {
    jest.useFakeTimers();
    const set = plain((await builtin_timer(['5m', 'tea'])).rendered);
    expect(set).toMatch(/^timer \d+ set: 5m 00s from now/);
    expect(plain((await builtin_timer([])).rendered)).toMatch(/timer\s+in 5m 00s\s+tea/);
    expect((await builtin_timer(['soon'])).status).toBe('error');
    expect(plain((await builtin_timer(['cancel'])).rendered)).toBe('1 chime cancelled\n');
    expect(plain((await builtin_leave(['+0030'])).rendered)).toMatch(/^Alarm set for \d\d:\d\d \(in 30m 00s\)\./);
    expect(chimes_list().filter((c) => c.source === 'leave').length).toBe(4);
    expect(plain((await builtin_leave([])).rendered)).toMatch(/^leaving at \d\d:\d\d — in 30m 00s/);
    expect(plain((await builtin_leave(['cancel'])).rendered)).toBe('leave cancelled\n');
    expect((await builtin_leave(['noon'])).status).toBe('error');
  });

  it('a stopwatch starts, laps, stops and resumes', async () => {
    jest.useFakeTimers();
    expect(plain((await builtin_stopwatch(['start'])).rendered)).toBe('stopwatch started\n');
    jest.advanceTimersByTime(1_500);
    expect(plain((await builtin_stopwatch(['lap'])).rendered)).toMatch(/^lap 1: 00:01\.5/);
    jest.advanceTimersByTime(2_000);
    expect(plain((await builtin_stopwatch(['stop'])).rendered)).toBe('stopped at 00:03.5\n');
    jest.advanceTimersByTime(10_000);
    expect(plain((await builtin_stopwatch([])).rendered)).toMatch(/^00:03\.5 \(stopped\)\n  lap 1  00:01\.5/);
    expect((await builtin_stopwatch(['lap'])).status).toBe('error');
    expect(plain((await builtin_stopwatch(['start'])).rendered)).toContain('resuming at 00:03.5');
  });
});
