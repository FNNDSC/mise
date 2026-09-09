/**
 * @file CUBE pace: how long a page of a list takes to come back.
 *
 * Every paged read of CUBE (feeds, public feeds, plugin instances) is timed
 * as it passes through {@link resource_call}, and the last twenty samples
 * are kept. The daemon's telemetry carries the median so a surface can say
 * what a walk costs in time, not only in pages.
 *
 * @module
 */

/** The chrisapi methods that fetch one page of a list. */
const PAGE_METHODS: ReadonlySet<string> = new Set(['getFeeds', 'getPublicFeeds', 'getPluginInstances']);

/** How many recent page timings the register keeps. */
export const PACE_WINDOW: number = 20;

/** What the register says about CUBE's pace. */
export interface CubePace {
  /** Median wall time of one page fetch over the window, in milliseconds. */
  msPerPage: number;
  /** How many page fetches the median is over. */
  samples: number;
  /** When the latest sample landed (epoch milliseconds). */
  at: number;
}

const samples: Array<{ ms: number; at: number }> = [];

/**
 * Whether a chrisapi method is a paged list read the register times.
 *
 * @param methodName - The method about to be invoked.
 * @returns True for the page fetchers.
 */
export function pace_isPageMethod(methodName: string): boolean {
  return PAGE_METHODS.has(methodName);
}

/**
 * Records one page fetch's wall time.
 *
 * @param ms - How long the fetch took.
 * @param at - When it landed (default now).
 */
export function pace_note(ms: number, at: number = Date.now()): void {
  samples.push({ ms, at });
  if (samples.length > PACE_WINDOW) samples.splice(0, samples.length - PACE_WINDOW);
}

/**
 * The pace CUBE is serving pages at, or null before any page was timed.
 *
 * @returns The median over the window, its size, and the latest sample's time.
 */
export function pace_get(): CubePace | null {
  if (samples.length === 0) return null;
  const sorted: number[] = samples.map((s): number => s.ms).sort((a: number, b: number): number => a - b);
  const mid: number = Math.floor(sorted.length / 2);
  const median: number = sorted.length % 2 === 1 ? (sorted[mid] as number) : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
  return { msPerPage: Math.round(median), samples: samples.length, at: (samples[samples.length - 1] as { at: number }).at };
}

/** Forgets every sample (tests). */
export function pace_reset(): void {
  samples.length = 0;
}
