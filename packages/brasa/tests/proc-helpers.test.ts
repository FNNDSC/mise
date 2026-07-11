/**
 * @file Unit tests for the pure `proc` builtin helpers.
 *
 * @module
 */
import { describe, it, expect } from '@jest/globals';
import {
  feedStatus_derive, statusColor, jobFields_select,
  procEntries_filterBySearch, procCsv_render, feedId_parse, DEFAULT_JOB_FIELDS,
  type ProcJobEntry,
} from '../src/builtins/proc.helpers.js';

function feed(p: Partial<Record<string, number>>): any {
  return { erroredJobs: 0, startedJobs: 0, scheduledJobs: 0, createdJobs: 0, cancelledJobs: 0, finishedJobs: 0, ...p };
}

describe('feedStatus_derive', () => {
  it('errored takes precedence', () => expect(feedStatus_derive(feed({ erroredJobs: 1, finishedJobs: 5 }))).toBe('finishedWithError'));
  it('running when work in flight', () => expect(feedStatus_derive(feed({ startedJobs: 1 }))).toBe('running'));
  it('cancelled when cancelled and none finished', () => expect(feedStatus_derive(feed({ cancelledJobs: 2 }))).toBe('cancelled'));
  it('finishedSuccessfully when only finished', () => expect(feedStatus_derive(feed({ finishedJobs: 3 }))).toBe('finishedSuccessfully'));
  it('empty otherwise', () => expect(feedStatus_derive(feed({}))).toBe('empty'));
});

describe('statusColor', () => {
  it('preserves the underlying label text', () => {
    expect(statusColor('running')).toContain('running');
    expect(statusColor('whatever')).toContain('whatever');
  });
});

describe('jobFields_select', () => {
  it('splits and trims a comma list', () => expect(jobFields_select('id, title ,status')).toEqual(['id', 'title', 'status']));
  it('falls back to defaults when empty', () => expect(jobFields_select('')).toEqual([...DEFAULT_JOB_FIELDS]));
});

describe('procEntries_filterBySearch', () => {
  const entries = [{ title: 'Brain MRI' }, { title: 'spine ct' }] as unknown as ProcJobEntry[];
  it('returns all for empty search', () => expect(procEntries_filterBySearch(entries, '')).toHaveLength(2));
  it('filters case-insensitively by title', () => {
    expect(procEntries_filterBySearch(entries, 'brain').map(e => e.title)).toEqual(['Brain MRI']);
  });
});

describe('procCsv_render', () => {
  it('emits a quoted header and rows, escaping quotes', () => {
    const rows = [{ id: 1, title: 'a"b' }] as unknown as ProcJobEntry[];
    expect(procCsv_render(rows, ['id', 'title'])).toBe('"id","title"\n"1","a""b"');
  });
});

describe('feedId_parse', () => {
  it('parses bare and feed_ prefixed ids', () => {
    expect(feedId_parse('123')).toBe(123);
    expect(feedId_parse('feed_45')).toBe(45);
  });
  it('returns null for malformed input', () => {
    expect(feedId_parse('feed_x')).toBeNull();
    expect(feedId_parse('abc')).toBeNull();
  });
});
