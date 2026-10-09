/**
 * @file The lab's pulse, from the roster's counters.
 *
 * @module
 */
import type { ProcFeed } from '@fnndsc/cumin';

/** The lab's pulse: jobs in flight, jobs waiting, and the feeds that errored, from the roster's counters. */
export interface JobsState {
  running: number;
  runningFeeds: number;
  scheduled: number;
  errored: number;
  erroredFeeds: number;
}

/**
 * Derives the lab's pulse from the roster: each feed's job counters are
 * kept current by the visit delta and the roster sync, so no call is made.
 *
 * @param feeds - Every feed the index holds.
 * @returns The sums, and how many feeds carry each.
 */
export function jobsState_derive(feeds: ReadonlyArray<ProcFeed>): JobsState {
  const state: JobsState = { running: 0, runningFeeds: 0, scheduled: 0, errored: 0, erroredFeeds: 0 };
  for (const feed of feeds) {
    state.running += feed.startedJobs;
    if (feed.startedJobs > 0) state.runningFeeds += 1;
    state.scheduled += feed.scheduledJobs + feed.createdJobs;
    state.errored += feed.erroredJobs;
    if (feed.erroredJobs > 0) state.erroredFeeds += 1;
  }
  return state;
}
