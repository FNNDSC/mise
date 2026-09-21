/**
 * @file The space of everything run here: branches by pipeline shape, feeds as leaves.
 */
import { describe, it, expect } from '@jest/globals';
import { universeGraph_build, LandedFeeds, branchId_of, leafId_of, UNIVERSE_ROOT_ID, type LandedFeed } from '../../src/features/dag/universe.js';

const a: LandedFeed = { id: 1, jobs: 3, status: 'finished', chain: ['pl-dircopy', 'pl-dcm2niix'] };
const b: LandedFeed = { id: 2, jobs: 7, status: 'errored', chain: ['pl-dircopy', 'pl-dcm2niix', 'pl-fastsurfer'] };
const c: LandedFeed = { id: 3, jobs: 1, status: 'running', chain: ['pl-simplefsapp'] };

describe('universeGraph_build', () => {
  it('shares a trunk between feeds that began the same way', () => {
    const graph = universeGraph_build([b, a, c]);
    const ids: string[] = graph.nodes.map((n) => n.id);
    expect(ids[0]).toBe(UNIVERSE_ROOT_ID);
    expect(ids.filter((id) => id.startsWith('branch:'))).toEqual([
      'branch:pl-dircopy', 'branch:pl-dircopy>pl-dcm2niix', 'branch:pl-dircopy>pl-dcm2niix>pl-fastsurfer', 'branch:pl-simplefsapp',
    ]);
    const trunk = graph.nodes.find((n) => n.id === branchId_of(['pl-dircopy']));
    expect(trunk?.parentIds).toEqual([UNIVERSE_ROOT_ID]);
    expect(trunk?.count).toBe(2);
    expect(trunk?.label).toBe('pl-dircopy');
  });

  it('hangs each feed from the twig its shape ends at, sized and hued by what it is', () => {
    const graph = universeGraph_build([a, b, c]);
    const leafB = graph.nodes.find((n) => n.id === leafId_of(2));
    expect(leafB).toMatchObject({ parentIds: ['branch:pl-dircopy>pl-dcm2niix>pl-fastsurfer'], status: 'errored', metric: 7, label: '' });
    const leafC = graph.nodes.find((n) => n.id === leafId_of(3));
    expect(leafC?.parentIds).toEqual(['branch:pl-simplefsapp']);
  });

  it('draws the same graph whatever order the feeds landed in', () => {
    expect(universeGraph_build([c, b, a])).toEqual(universeGraph_build([a, b, c]));
  });

  it('hangs a feed with no chain from the root', () => {
    const graph = universeGraph_build([{ id: 9, jobs: 0, status: 'created', chain: [] }]);
    expect(graph.nodes.find((n) => n.id === leafId_of(9))?.parentIds).toEqual([UNIVERSE_ROOT_ID]);
    expect(graph.nodes.find((n) => n.id === leafId_of(9))?.metric).toBe(1);
  });
});

describe('LandedFeeds', () => {
  it('keeps one report per feed, the newest winning, and says when something moved', () => {
    const feeds: LandedFeeds = new LandedFeeds();
    expect(feeds.take([a, b])).toBe(true);
    expect(feeds.take([a, b])).toBe(false);
    expect(feeds.take([{ ...a, status: 'errored' }])).toBe(true);
    expect(feeds.size()).toBe(2);
    expect(feeds.all().find((f) => f.id === 1)?.status).toBe('errored');
    feeds.clear();
    expect(feeds.size()).toBe(0);
  });
});
