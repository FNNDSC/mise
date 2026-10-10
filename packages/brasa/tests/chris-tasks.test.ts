/**
 * @file The ChRIS backend's feeds, read as tasks.
 */
import { jest, describe, it, expect } from '@jest/globals';
import type { ProcFeed } from '@fnndsc/cumin';

const FEEDS: ProcFeed[] = [];
jest.unstable_mockModule('@fnndsc/cumin', () => ({ procCache_get: () => ({ feeds_find: () => FEEDS }) }));
const { feedTask_of, feedTask_state, chrisJobsSource } = await import('../src/chris/tasks.js');

/** A feed with these job counts. */
function feed(counts: Partial<ProcFeed> = {}): ProcFeed {
  return {
    id: 12, title: 'brain run', ownerUsername: 'u', public: false, creationDate: '2026-10-09T10:00:00Z',
    finishedJobs: 0, erroredJobs: 0, startedJobs: 0, scheduledJobs: 0, cancelledJobs: 0, createdJobs: 0, ...counts,
  };
}

describe('a feed as a task', () => {
  it('stands where its jobs do', () => {
    expect(feedTask_state(feed({ startedJobs: 1, finishedJobs: 3 }))).toBe('running');
    expect(feedTask_state(feed({ scheduledJobs: 2 }))).toBe('queued');
    expect(feedTask_state(feed({ createdJobs: 1 }))).toBe('queued');
    expect(feedTask_state(feed({ finishedJobs: 3, erroredJobs: 1 }))).toBe('failed');
    expect(feedTask_state(feed({ cancelledJobs: 2 }))).toBe('cancelled');
    expect(feedTask_state(feed({ finishedJobs: 2, cancelledJobs: 1 }))).toBe('done');
    expect(feedTask_state(feed({ finishedJobs: 4 }))).toBe('done');
  });

  it('is named as /proc/jobs names it, its jobs counted as progress', () => {
    expect(feedTask_of(feed({ finishedJobs: 3, erroredJobs: 1, startedJobs: 1, scheduledJobs: 2 }))).toEqual({
      id: 'feed_12', label: 'brain run', state: 'running',
      progress: { current: 4, total: 7, unit: 'jobs' }, started: '2026-10-09T10:00:00Z',
    });
    expect(feedTask_of(feed({ title: '' })).label).toBe('feed_12');
  });

  it('lists every feed the index holds, and keeps /proc/jobs its own mount', async () => {
    FEEDS.splice(0, FEEDS.length, feed({ id: 1, finishedJobs: 1 }), feed({ id: 2, startedJobs: 1 }));
    expect((await chrisJobsSource.list()).map((task) => `${task.id}:${task.state}`)).toEqual(['feed_1:done', 'feed_2:running']);
    expect(chrisJobsSource.mounted).toBe(true);
    expect(chrisJobsSource.id).toBe('jobs');
  });
});
