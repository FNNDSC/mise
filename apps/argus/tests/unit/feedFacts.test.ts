/**
 * @file A feed node's facts, the one way both doors show them.
 */
import { describe, it, expect } from '@jest/globals';
import type { FeedDagNode } from '@fnndsc/menu';
import { feedFacts_rows } from '../../src/features/feed/facts.js';

const node = (extra: Partial<FeedDagNode> = {}): FeedDagNode =>
  ({ id: '9', label: 'pl-dcm2niix', parentIds: [], joinParentIds: [], instanceId: 9, pluginName: 'pl-dcm2niix', status: 'finishedSuccessfully', vfsPath: '/proc/jobs/feed_2/pl-dcm2niix_9', ...extra }) as FeedDagNode;

describe('feedFacts_rows', () => {
  it('names the node, where it stands, what it cost and where its data is; a settled node without metrics is awaiting warmup', () => {
    const rows = feedFacts_rows(node());
    expect(rows.map(([label]) => label)).toEqual(['PLUGIN', 'INSTANCE', 'STATUS', 'WALL', 'SIZE', 'DATA']);
    expect(Object.fromEntries(rows)['WALL']).toBe('awaiting warmup');
    expect(Object.fromEntries(feedFacts_rows(node({ status: 'started' })))['SIZE']).toBe('in flight');
  });

  it('a ×N group says it is one of many, its count by state, and its faults', () => {
    const rows = Object.fromEntries(feedFacts_rows(node({
      status: 'finishedWithError',
      tally: { count: 300, done: 288, error: 12, running: 0, other: 0, anomalies: [{ id: '41', status: 'finishedWithError' }, { id: '57', status: 'finishedWithError' }] },
    })));
    expect(rows['REP. INSTANCE']).toBe('9');
    expect(rows['COUNT']).toBe('×300 — 288 done, 12 err, 0 live, 0 other');
    expect(rows['FAULTS']).toBe('41 57 …');
  });
});
