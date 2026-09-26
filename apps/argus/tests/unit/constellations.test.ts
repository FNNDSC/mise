/**
 * @file The universe as constellations: every feed its own molecule with no
 * hub, each stage marked with its plugin, one ringed star per plugin sized
 * by the feeds that ran it; a star's tip says what it is.
 */
import { describe, it, expect } from '@jest/globals';
import { constellationsGraph_build, pluginStarId_of, pluginOfStar, pluginTip_of, descendedGraph_build, groupId_of, LandedFeeds, universeSettings_parse, type LandedFeed } from '../../src/features/dag/universe.js';

const chain: LandedFeed = { id: 1, title: 'chain', jobs: 3, status: 'finishedSuccessfully', chain: ['pl-dircopy', 'pl-dcm2niix'], groups: [
  { plugin: 'pl-dircopy', count: 1, errored: 0, status: 'finishedSuccessfully', parent: null },
  { plugin: 'pl-dcm2niix', count: 2, errored: 0, status: 'finishedSuccessfully', parent: 0 },
] };
const fan: LandedFeed = { id: 2, title: 'fan', jobs: 301, status: 'finishedWithError', chain: ['pl-dircopy', 'pl-dcm2niix'], groups: [
  { plugin: 'pl-dircopy', count: 1, errored: 0, status: 'finishedSuccessfully', parent: null },
  { plugin: 'pl-dcm2niix', count: 300, errored: 12, status: 'finishedWithError', parent: 0 },
] };

describe('constellationsGraph_build', () => {
  const graph = constellationsGraph_build([fan, chain]);

  it('marks every stage with its plugin, and hangs no feed from a hub', () => {
    const root = graph.nodes.find((n) => n.id === groupId_of(1, 0));
    expect(root?.attrs).toEqual({ plugin: 'pl-dircopy' });
    expect(root?.parentIds).toEqual([]);
    expect(graph.nodes.find((n) => n.id === groupId_of(2, 1))?.parentIds).toEqual([groupId_of(2, 0)]);
    expect(graph.nodes.some((n) => n.ghost === true || n.halo === true)).toBe(false);
  });

  it('adds one ringed star per plugin, sized by the log of the feeds that ran it', () => {
    const stars = graph.nodes.filter((n) => n.ring === true);
    expect(stars.map((n) => n.id)).toEqual([pluginStarId_of('pl-dcm2niix'), pluginStarId_of('pl-dircopy')]);
    expect(stars[0]).toMatchObject({ label: 'pl-dcm2niix', attrs: { kind: 'star', plugin: 'pl-dcm2niix' }, metric: 1 + Math.log(2), parentIds: [] });
  });

  it('keeps the sky behind a feed that is entered', () => {
    const entered = { nodes: [{ id: 'feed:2:x', label: 'x', parentIds: [], joinParentIds: [] }] } as unknown as Parameters<typeof descendedGraph_build>[2];
    const behind = descendedGraph_build([fan, chain], 2, entered, 'jobs', true);
    expect(behind.nodes.some((n) => n.id === pluginStarId_of('pl-dircopy') && n.dim === true)).toBe(true);
    expect(behind.nodes.some((n) => n.id.startsWith('feed:2:0'))).toBe(false);
  });
});

describe('a plugin star', () => {
  it('knows its plugin, and its tip says how many feeds ran it and how much of it failed', () => {
    expect(pluginOfStar(pluginStarId_of('pl-dcm2niix'))).toBe('pl-dcm2niix');
    expect(pluginOfStar(groupId_of(1, 0))).toBeNull();
    const feeds = new LandedFeeds();
    feeds.take([chain, fan]);
    expect(pluginTip_of(pluginStarId_of('pl-dcm2niix'), feeds)).toBe('pl-dcm2niix · 2 feeds · 4% errored');
    expect(pluginTip_of(pluginStarId_of('pl-dircopy'), feeds)).toBe('pl-dircopy · 2 feeds · 0% errored');
    expect(pluginTip_of(groupId_of(1, 0), feeds)).toBeNull();
  });

  it('is kept as a layout choice', () => {
    expect(universeSettings_parse(JSON.stringify({ arrangement: 'constellations' })).arrangement).toBe('constellations');
  });
});
