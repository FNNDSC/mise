/**
 * @file The ChRIS backend's task source: each feed an analysis in progress
 * or done, its jobs the steps counted.
 *
 * `/proc/jobs` stays the ChRIS backend's own mount (feeds, and the plugin
 * instances in them); this source is how the core reads the same feeds as
 * tasks, for whatever reads tasks of any backend.
 *
 * @module
 */
import { procCache_get, type ProcFeed } from '@fnndsc/cumin';
import type { Task, TaskState } from '@fnndsc/menu';
import type { TaskSource } from '../core/backend.js';

/**
 * Where a feed stands, as a task: running while a job runs, queued while one
 * waits, else failed if a job errored, cancelled if it was stopped before
 * any finished, done otherwise.
 *
 * @param feed - The feed's job counts.
 * @returns Its state.
 */
export function feedTask_state(feed: ProcFeed): TaskState {
  if (feed.startedJobs > 0) return 'running';
  if (feed.scheduledJobs + feed.createdJobs > 0) return 'queued';
  if (feed.erroredJobs > 0) return 'failed';
  if (feed.cancelledJobs > 0 && feed.finishedJobs === 0) return 'cancelled';
  return 'done';
}

/**
 * A feed as a task: `feed_<id>`, its title, its jobs as progress.
 *
 * @param feed - The feed.
 * @returns The task.
 */
export function feedTask_of(feed: ProcFeed): Task {
  const settled: number = feed.finishedJobs + feed.erroredJobs + feed.cancelledJobs;
  const total: number = settled + feed.startedJobs + feed.scheduledJobs + feed.createdJobs;
  return {
    id: `feed_${feed.id}`,
    label: feed.title || `feed_${feed.id}`,
    state: feedTask_state(feed),
    progress: { current: settled, total, unit: 'jobs' },
    started: feed.creationDate,
  };
}

/** The ChRIS backend's feeds, as tasks; `/proc/jobs` is its own mount. */
export const chrisJobsSource: TaskSource = {
  id: 'jobs',
  label: 'ChRIS feeds and their jobs',
  mounted: true,
  list: async (): Promise<Task[]> => procCache_get().feeds_find('').map(feedTask_of),
};
