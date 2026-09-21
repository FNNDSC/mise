/**
 * @file The space of everything run here: every feed its own collapsed DAG,
 * floating free, like shapes pulled together by an unseen anchor.
 */
import { describe, it, expect } from '@jest/globals';
import { universeGraph_build, LandedFeeds, shape_of, groupId_of, anchorId_of, type LandedFeed } from '../../src/features/dag/universe.js';

const chain: LandedFeed = { id: 1, jobs: 3, status: 'finishedSuccessfully', chain: ['pl-dircopy', 'pl-dcm2niix'], groups: [
  { plugin: 'pl-dircopy', count: 1, status: 'finishedSuccessfully', parent: null },
  { plugin: 'pl-dcm2niix', count: 2, status: 'finishedSuccessfully', parent: 0 },
] };
const fan: LandedFeed = { id: 2, jobs: 301, status: 'finishedWithError', chain: ['pl-dircopy', 'pl-dcm2niix'], groups: [
  { plugin: 'pl-dircopy', count: 1, status: 'finishedSuccessfully', parent: null },
  { plugin: 'pl-dcm2niix', count: 300, status: 'finishedWithError', parent: 0 },
] };
const other: LandedFeed = { id: 3, jobs: 1, status: 'started', chain: ['pl-simplefsapp'], groups: [
  { plugin: 'pl-simplefsapp', count: 1, status: 'started', parent: null },
] };

describe('universeGraph_build', () => {
  it('draws every feed as its own collapsed DAG, counts as weight, status as hue', () => {
    const graph = universeGraph_build([fan]);
    const root = graph.nodes.find((n) => n.id === groupId_of(2, 0));
    const conversions = graph.nodes.find((n) => n.id === groupId_of(2, 1));
    expect(root).toMatchObject({ label: 'pl-dircopy', metric: 1, status: 'finishedSuccessfully' });
    expect(root?.count).toBeUndefined();
    expect(conversions).toMatchObject({ label: 'pl-dcm2niix', metric: 300, count: 300, status: 'finishedWithError', parentIds: [groupId_of(2, 0)] });
  });

  it('hangs feeds of one shape from one unseen anchor, and different shapes apart', () => {
    const graph = universeGraph_build([chain, fan, other]);
    const anchors = graph.nodes.filter((n) => n.ghost === true);
    expect(anchors.map((n) => n.id).sort()).toEqual([anchorId_of(shape_of(chain)), anchorId_of(shape_of(other))].sort());
    expect(shape_of(chain)).toBe(shape_of(fan));
    expect(graph.nodes.find((n) => n.id === groupId_of(1, 0))?.parentIds).toEqual([anchorId_of(shape_of(chain))]);
    expect(graph.nodes.find((n) => n.id === groupId_of(2, 0))?.parentIds).toEqual([anchorId_of(shape_of(chain))]);
    expect(graph.nodes.find((n) => n.id === groupId_of(3, 0))?.parentIds).toEqual([anchorId_of(shape_of(other))]);
  });

  it('draws the same graph whatever order the feeds landed in, and skips a feed with no jobs', () => {
    expect(universeGraph_build([other, fan, chain])).toEqual(universeGraph_build([chain, fan, other]));
    expect(universeGraph_build([{ id: 9, jobs: 0, status: 'created', chain: [], groups: [] }]).nodes).toEqual([]);
  });
});

describe('LandedFeeds', () => {
  it('keeps one report per feed, the newest winning, and counts shapes', () => {
    const feeds: LandedFeeds = new LandedFeeds();
    expect(feeds.take([chain, fan, other])).toBe(true);
    expect(feeds.take([chain, fan, other])).toBe(false);
    expect(feeds.shapes()).toBe(2);
    expect(feeds.take([{ ...fan, groups: [fan.groups[0]!, { ...fan.groups[1]!, count: 301 }] }])).toBe(true);
    expect(feeds.all().find((f) => f.id === 2)?.groups[1]?.count).toBe(301);
    feeds.clear();
    expect(feeds.size()).toBe(0);
  });
});
