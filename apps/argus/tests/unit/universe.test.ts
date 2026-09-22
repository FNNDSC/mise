/**
 * @file The space of everything run here: every feed its own collapsed DAG,
 * floating free, like shapes pulled together by an unseen anchor.
 */
import { describe, it, expect } from '@jest/globals';
import { universeGraph_build, LandedFeeds, shape_of, groupId_of, anchorId_of, universeTip_of, universeStoreKey_of, storedPositions_parse, jobsMetric_of, erroredShare_of, enteredFeed_build, descendedGraph_build, sphereIds_of, instanceId_of, shapeWords_of, shapeWords_brief, clusterTip_of, clusterIds_of, clusterGraph_build, type LandedFeed } from '../../src/features/dag/universe.js';
import type { FeedDagModel } from '@fnndsc/menu';

const chain: LandedFeed = { id: 1, title: 'chain', jobs: 3, status: 'finishedSuccessfully', chain: ['pl-dircopy', 'pl-dcm2niix'], groups: [
  { plugin: 'pl-dircopy', count: 1, errored: 0, status: 'finishedSuccessfully', parent: null },
  { plugin: 'pl-dcm2niix', count: 2, errored: 0, status: 'finishedSuccessfully', parent: 0 },
] };
const fan: LandedFeed = { id: 2, title: 'shot-cohort', jobs: 301, status: 'finishedWithError', chain: ['pl-dircopy', 'pl-dcm2niix'], groups: [
  { plugin: 'pl-dircopy', count: 1, errored: 0, status: 'finishedSuccessfully', parent: null },
  { plugin: 'pl-dcm2niix', count: 300, errored: 12, status: 'finishedWithError', parent: 0 },
] };
const other: LandedFeed = { id: 3, title: '', jobs: 1, status: 'started', chain: ['pl-simplefsapp'], groups: [
  { plugin: 'pl-simplefsapp', count: 1, errored: 0, status: 'started', parent: null },
] };

describe('universeGraph_build', () => {
  it('draws every feed as its own collapsed DAG, counts as weight, status as hue', () => {
    const graph = universeGraph_build([fan]);
    const root = graph.nodes.find((n) => n.id === groupId_of(2, 0));
    const conversions = graph.nodes.find((n) => n.id === groupId_of(2, 1));
    expect(root).toMatchObject({ label: 'pl-dircopy', metric: jobsMetric_of(1), status: 'finishedSuccessfully' });
    expect(root?.count).toBeUndefined();
    expect(root?.share).toBeUndefined();
    expect(conversions).toMatchObject({ label: 'pl-dcm2niix', metric: jobsMetric_of(300), count: 300, status: 'finishedWithError', parentIds: [groupId_of(2, 0)], share: 12 / 300 });
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
    expect(universeGraph_build([{ id: 9, title: 'empty', jobs: 0, status: 'created', chain: [], groups: [] }]).nodes).toEqual([]);
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

describe('universeTip_of', () => {
  it('names the group and the feed a sphere stands for, and nothing for an anchor', () => {
    const feeds: LandedFeeds = new LandedFeeds();
    feeds.take([fan, other]);
    expect(universeTip_of(groupId_of(2, 1), feeds)).toBe('pl-dcm2niix ×300 · 12 errored · feed 2 · shot-cohort');
    expect(universeTip_of(groupId_of(2, 0), feeds)).toBe('pl-dircopy · finishedSuccessfully · feed 2 · shot-cohort');
    // A feed without a name is named by its number alone.
    expect(universeTip_of(groupId_of(3, 0), feeds)).toBe('pl-simplefsapp · started · feed 3');
    expect(universeTip_of(anchorId_of(shape_of(fan)), feeds)).toBeNull();
    expect(universeTip_of(groupId_of(99, 0), feeds)).toBeNull();
  });
});

describe('remembered positions', () => {
  it('keys the memory by identity', () => {
    expect(universeStoreKey_of('chris', 'https://cube/api/v1/')).toBe('argus.universe.chris@https://cube/api/v1/');
  });
  it('reads what was written and nothing that was not', () => {
    expect(storedPositions_parse(null)).toEqual({});
    expect(storedPositions_parse('')).toEqual({});
    expect(storedPositions_parse('not json')).toEqual({});
    expect(storedPositions_parse('[1,2,3]')).toEqual({});
    expect(storedPositions_parse(JSON.stringify({ 'feed:1:0': [1, 2.5, -3], bad: [1, 2], worse: ['a', 'b', 'c'], nan: [1, 2, null] })))
      .toEqual({ 'feed:1:0': [1, 2.5, -3] });
  });
});

describe('a sphere weighs its jobs honestly', () => {
  it('sizes on a log scale, so a giant is a few times a fan rather than hundreds', () => {
    expect(jobsMetric_of(1)).toBeCloseTo(1);
    expect(jobsMetric_of(300) / jobsMetric_of(1)).toBeLessThan(10);
    expect(jobsMetric_of(80000) / jobsMetric_of(300)).toBeLessThan(2.5);
    expect(jobsMetric_of(0)).toBe(jobsMetric_of(1));
  });
  it('hues by the errored share, and not at all when clean', () => {
    expect(erroredShare_of({ plugin: 'p', count: 80000, errored: 12, status: 'finishedWithError', parent: null })).toBeCloseTo(12 / 80000);
    expect(erroredShare_of({ plugin: 'p', count: 3, errored: 3, status: 'finishedWithError', parent: null })).toBe(1);
    expect(erroredShare_of({ plugin: 'p', count: 3, errored: 0, status: 'finishedSuccessfully', parent: null })).toBeUndefined();
  });
  it('on the feeds scale every sphere weighs the same', () => {
    const graph = universeGraph_build([fan, chain], 'feeds');
    expect(graph.nodes.filter((n) => n.ghost !== true).every((n) => n.metric === 1)).toBe(true);
    expect(universeGraph_build([fan], 'jobs').nodes.find((n) => n.id === groupId_of(2, 1))?.metric).toBeCloseTo(jobsMetric_of(300));
  });
});

describe('the descent into a feed', () => {
  const model: FeedDagModel = {
    feedId: 2,
    feedName: 'shot-cohort',
    nodes: [
      { id: '10', label: 'pl-dircopy', parentIds: [], joinParentIds: [], instanceId: 10, pluginName: 'pl-dircopy', status: 'finishedSuccessfully', vfsPath: '/proc/jobs/feed_2/pl-dircopy_10/data' },
      { id: '11', label: 'pl-dcm2niix', parentIds: ['10'], joinParentIds: [], instanceId: 11, pluginName: 'pl-dcm2niix', status: 'finishedWithError', vfsPath: '/proc/jobs/feed_2/pl-dircopy_10/pl-dcm2niix_11/data',
        tally: { count: 300, done: 288, error: 12, running: 0, other: 0 } },
      { id: '12', label: 'pl-fastsurfer', parentIds: ['11', '99'], joinParentIds: [], instanceId: 12, pluginName: 'pl-fastsurfer', status: 'started', vfsPath: '/proc/jobs/feed_2/x/pl-fastsurfer_12/data' },
    ],
  };
  it('turns the kernel graph into scene nodes: ids by feed, the fan kept ×N with its share, roots free of any anchor', () => {
    const entered = enteredFeed_build(model);
    expect(entered.nodes.map((n) => n.id)).toEqual([instanceId_of(2, '10'), instanceId_of(2, '11'), instanceId_of(2, '12')]);
    expect(entered.nodes[0]).toMatchObject({ label: 'pl-dircopy', parentIds: [], metric: jobsMetric_of(1) });
    expect(entered.nodes[1]).toMatchObject({ parentIds: [instanceId_of(2, '10')], count: 300, share: 12 / 300, metric: jobsMetric_of(300) });
    // A parent the model does not carry is dropped, not invented.
    expect(entered.nodes[2]?.parentIds).toEqual([instanceId_of(2, '11')]);
    expect(entered.payloads.get(instanceId_of(2, '11'))?.instanceId).toBe(11);
  });
  it('replaces the entered feed molecule and dims every other feed, halos included', () => {
    const entered = enteredFeed_build(model);
    const graph = descendedGraph_build([chain, fan, other], 2, entered);
    expect(graph.nodes.some((n) => n.id.startsWith('feed:2:'))).toBe(false);
    expect(graph.nodes.filter((n) => n.id.startsWith('inst:2:'))).toHaveLength(3);
    const others = graph.nodes.filter((n) => n.id.startsWith('feed:'));
    expect(others.length).toBeGreaterThan(0);
    expect(others.every((n) => n.dim === true)).toBe(true);
    // The halos dim with the feeds they gather: inside a feed, nothing else is lit.
    expect(graph.nodes.filter((n) => n.ghost === true).every((n) => n.dim === true)).toBe(true);
    expect(sphereIds_of(2, fan)).toEqual([groupId_of(2, 0), groupId_of(2, 1)]);
  });
});

describe('a cluster has a handle', () => {
  it('draws every anchor as a halo counting the feeds of its shape', () => {
    const graph = universeGraph_build([chain, fan, other]);
    const halo = graph.nodes.find((n) => n.id === anchorId_of(shape_of(fan)));
    expect(halo).toMatchObject({ ghost: true, halo: true, count: 2, label: 'pl-dircopy > pl-dcm2niix' });
    expect(graph.nodes.find((n) => n.id === anchorId_of(shape_of(other)))).toMatchObject({ halo: true, count: 1 });
  });
  it('says a shape in words, each plugin once in pipeline order', () => {
    expect(shapeWords_of(shape_of(fan))).toBe('pl-dircopy > pl-dcm2niix');
    expect(shapeWords_of('r:pl-a>0:pl-b>0:pl-b>2:pl-c')).toBe('pl-a > pl-b > pl-c');
    expect(shapeWords_brief('r:pl-a>0:pl-b>0:pl-b>2:pl-c')).toBe('pl-a > pl-b > pl-c');
    expect(shapeWords_brief('r:a>0:b>1:c>2:d>3:e')).toBe('a > b > c … +2');
  });
  it('tips a halo with the shape and its count, and nothing else', () => {
    const feeds: LandedFeeds = new LandedFeeds();
    feeds.take([chain, fan, other]);
    expect(clusterTip_of(anchorId_of(shape_of(fan)), feeds)).toBe('pl-dircopy > pl-dcm2niix · 2 feeds');
    expect(clusterTip_of(anchorId_of(shape_of(other)), feeds)).toBe('pl-simplefsapp · 1 feed');
    expect(clusterTip_of(groupId_of(2, 0), feeds)).toBeNull();
  });
  it('gathers the spheres of a shape, and lights only them in the cluster view', () => {
    const feeds: LandedFeeds = new LandedFeeds();
    feeds.take([chain, fan, other]);
    const ids = clusterIds_of(shape_of(fan), feeds);
    expect(ids.sort()).toEqual([groupId_of(1, 0), groupId_of(1, 1), groupId_of(2, 0), groupId_of(2, 1)].sort());
    const graph = clusterGraph_build([chain, fan, other], shape_of(fan));
    const lit = graph.nodes.filter((n) => n.dim !== true).map((n) => n.id).sort();
    expect(lit).toEqual([anchorId_of(shape_of(fan)), ...ids].sort());
    expect(graph.nodes.find((n) => n.id === groupId_of(3, 0))?.dim).toBe(true);
    expect(graph.nodes.find((n) => n.id === anchorId_of(shape_of(other)))?.dim).toBe(true);
  });
});
