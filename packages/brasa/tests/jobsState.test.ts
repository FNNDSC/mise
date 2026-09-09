import { describe, it, expect } from '@jest/globals';
import { jobsState_derive } from '../src/core/jobsState.js';

const feed = (over: Record<string, number>) => ({
  id: 1, title: 'f', ownerUsername: 'u', public: false, creationDate: '',
  finishedJobs: 0, erroredJobs: 0, startedJobs: 0, scheduledJobs: 0, cancelledJobs: 0, createdJobs: 0, ...over,
});

describe('jobsState_derive', () => {
  it('sums the roster counters and counts the feeds that carry each', () => {
    const state = jobsState_derive([
      feed({ id: 1, startedJobs: 3, scheduledJobs: 1 }),
      feed({ id: 2, startedJobs: 1, createdJobs: 2, erroredJobs: 5 }),
      feed({ id: 3, erroredJobs: 1, finishedJobs: 40 }),
      feed({ id: 4, finishedJobs: 9 }),
    ]);
    expect(state).toEqual({ running: 4, runningFeeds: 2, scheduled: 3, errored: 6, erroredFeeds: 2 });
  });
  it('a quiet lab is zeros', () => {
    expect(jobsState_derive([])).toEqual({ running: 0, runningFeeds: 0, scheduled: 0, errored: 0, erroredFeeds: 0 });
  });
});
