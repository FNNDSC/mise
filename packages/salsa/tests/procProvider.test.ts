/**
 * @file Unit tests for the pure helpers in the /proc VFS provider.
 *
 * @module
 */
import { describe, it, expect } from '@jest/globals';
import { feedStatus_derive, procPath_parse } from '../src/vfs/providers/proc';

function feed(p: Partial<Record<string, number>>): any {
  return { erroredJobs: 0, startedJobs: 0, scheduledJobs: 0, createdJobs: 0, cancelledJobs: 0, finishedJobs: 0, ...p };
}

describe('feedStatus_derive', () => {
  it('errored wins', () => expect(feedStatus_derive(feed({ erroredJobs: 1, finishedJobs: 9 }))).toBe('finishedWithError'));
  it('running when work in flight', () => expect(feedStatus_derive(feed({ scheduledJobs: 2 }))).toBe('running'));
  it('cancelled when cancelled and none finished', () => expect(feedStatus_derive(feed({ cancelledJobs: 1 }))).toBe('cancelled'));
  it('finishedSuccessfully when only finished', () => expect(feedStatus_derive(feed({ finishedJobs: 3 }))).toBe('finishedSuccessfully'));
  it('empty otherwise', () => expect(feedStatus_derive(feed({}))).toBe('empty'));
});

describe('procPath_parse', () => {
  it('extracts the feed id', () => {
    expect(procPath_parse('/proc/jobs/feed_42')).toEqual({ feedID: 42, instanceID: null, virtualFile: null });
  });
  it('extracts an instance id from a trailing _<n> segment', () => {
    const r = procPath_parse('/proc/jobs/feed_42/dircopy_7');
    expect(r.feedID).toBe(42);
    expect(r.instanceID).toBe(7);
    expect(r.virtualFile).toBeNull();
  });
  it('returns nulls for the bare /proc/jobs root', () => {
    expect(procPath_parse('/proc/jobs')).toEqual({ feedID: null, instanceID: null, virtualFile: null });
  });
});
