/**
 * @file The universe grown by accretion: every feed its own molecule, no
 * hub and no star, each stage carrying its plugin and its feed's creation
 * time; a feed with no time still stands, and grows last.
 */
import { describe, it, expect } from '@jest/globals';
import { accretionGraph_build, descendedGraph_build, groupId_of, universeSettings_parse, type LandedFeed } from '../../src/features/universe/space.js';

const made: LandedFeed = { id: 1, title: 'made', jobs: 3, status: 'finishedSuccessfully', chain: ['pl-dircopy', 'pl-dcm2niix'], createdAt: '2026-01-02T03:04:05Z', groups: [
  { plugin: 'pl-dircopy', count: 1, errored: 0, status: 'finishedSuccessfully', parent: null },
  { plugin: 'pl-dcm2niix', count: 2, errored: 0, status: 'finishedSuccessfully', parent: 0 },
] };
const timeless: LandedFeed = { id: 2, title: 'timeless', jobs: 1, status: 'finishedSuccessfully', chain: ['pl-civet'], groups: [
  { plugin: 'pl-civet', count: 1, errored: 0, status: 'finishedSuccessfully', parent: null },
] };

describe('accretionGraph_build', () => {
  const graph = accretionGraph_build([timeless, made]);

  it('marks every stage with its plugin and its feed\'s creation time, with no hub and no star', () => {
    expect(graph.nodes.map((n) => n.id).sort()).toEqual([groupId_of(1, 0), groupId_of(1, 1), groupId_of(2, 0)].sort());
    expect(graph.nodes.find((n) => n.id === groupId_of(1, 1))?.attrs).toEqual({ plugin: 'pl-dcm2niix', createdAt: Date.parse('2026-01-02T03:04:05Z') });
    expect(graph.nodes.some((n) => n.ghost === true || n.ring === true || n.attrs?.['kind'] === 'star')).toBe(false);
  });

  it('leaves a feed with no creation time untimed: the engine grows it last', () => {
    expect(graph.nodes.find((n) => n.id === groupId_of(2, 0))?.attrs).toEqual({ plugin: 'pl-civet' });
  });

  it('stands behind an entered feed, and is kept as a frame choice', () => {
    const entered = { nodes: [{ id: 'node:9', label: 'x', parentIds: [], joinParentIds: [] }] };
    const behind = descendedGraph_build([timeless, made], 1, entered as never, 'jobs', false, graph);
    expect(behind.nodes.filter((n) => n.dim === true).map((n) => n.id)).toEqual([groupId_of(2, 0)]);
    expect(universeSettings_parse(JSON.stringify({ arrangement: 'accretion' })).arrangement).toBe('accretion');
  });
});
