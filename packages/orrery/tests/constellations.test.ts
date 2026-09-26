/**
 * @file Constellations: plugins that run together sit together, a feed's
 * stages lie by their plugins' stars, a landmark pulls nothing, a plugin
 * weighs by how little it is used, and the sky is the same run to run.
 */
import { describe, it, expect } from '@jest/globals';
import { constellations_layout, pluginWeights_of, LANDMARK_SHARE } from '../src/layout/constellations.js';
import { layoutEngine_get, layoutNeeds_missing } from '../src/layout/registry.js';
import { PHYSICS_DEFAULT, type LayoutNode, type Positions } from '../src/layout/types.js';

const star = (plugin: string): LayoutNode => ({ id: `star:${plugin}`, parents: [], radius: 0.8, group: null, attrs: { kind: 'star', plugin } });
/** A feed running plugins in a chain. */
const feed = (id: number, plugins: string[]): LayoutNode[] => plugins.map((plugin, i): LayoutNode => ({
  id: `feed:${id}:${i}`, parents: i === 0 ? [] : [`feed:${id}:${i - 1}`], radius: 0.5, group: `feed:${id}`, attrs: { plugin },
}));
const distance = (p: Positions, a: string, b: string): number => Math.hypot(...(p[a] as number[]).map((v, i) => v - (p[b] as number[])[i]!));

/** Two families of pipeline: dircopy → dcm2niix → fastsurfer, and dircopy → civet → report; plus a lonely one. */
function sky(): LayoutNode[] {
  const nodes: LayoutNode[] = ['pl-dircopy', 'pl-dcm2niix', 'pl-fastsurfer', 'pl-civet', 'pl-report', 'pl-lonely'].map(star);
  for (let i = 0; i < 6; i++) nodes.push(...feed(i, ['pl-dircopy', 'pl-dcm2niix', 'pl-fastsurfer']));
  for (let i = 6; i < 12; i++) nodes.push(...feed(i, ['pl-dircopy', 'pl-civet', 'pl-report']));
  nodes.push(...feed(12, ['pl-lonely']));
  return nodes;
}

describe('pluginWeights_of', () => {
  it('weighs a plugin by how few feeds ran it, and gives a landmark nothing', () => {
    const weights = pluginWeights_of(new Map([['rare', 1], ['common', 5], ['everywhere', 10]]), 10);
    expect(weights.get('rare')).toBeCloseTo(Math.log(10), 9);
    expect(weights.get('common')).toBeCloseTo(Math.log(2), 9);
    expect(weights.get('everywhere')).toBe(0);
    expect(LANDMARK_SHARE).toBe(0.9);
  });
});

describe('constellations_layout', () => {
  const positions: Positions = constellations_layout(sky(), PHYSICS_DEFAULT);

  it('places every node', () => {
    expect(Object.keys(positions)).toHaveLength(sky().length);
    for (const at of Object.values(positions)) for (const v of at) expect(Number.isFinite(v)).toBe(true);
  });

  it('sets plugins that run together closer than plugins that never do', () => {
    expect(distance(positions, 'star:pl-dcm2niix', 'star:pl-fastsurfer')).toBeLessThan(distance(positions, 'star:pl-dcm2niix', 'star:pl-report'));
    expect(distance(positions, 'star:pl-civet', 'star:pl-report')).toBeLessThan(distance(positions, 'star:pl-civet', 'star:pl-fastsurfer'));
  });

  it('lays a feed\'s stage nearer its own plugin\'s star than another family\'s', () => {
    expect(distance(positions, 'feed:0:2', 'star:pl-fastsurfer')).toBeLessThan(distance(positions, 'feed:0:2', 'star:pl-report'));
    expect(distance(positions, 'feed:7:1', 'star:pl-civet')).toBeLessThan(distance(positions, 'feed:7:1', 'star:pl-fastsurfer'));
  });

  it('draws the same sky from the same space', () => {
    expect(constellations_layout(sky(), PHYSICS_DEFAULT)).toEqual(positions);
  });

  it('holds a frozen node at its seed, and says how far it has come', () => {
    const nodes = sky().map((node) => (node.id === 'feed:3:0' ? { ...node, seed: [9, 9, 9] as [number, number, number], frozen: true } : node));
    let last = 0;
    const held = constellations_layout(nodes, PHYSICS_DEFAULT, (f) => { last = f; });
    expect(held['feed:3:0']).toEqual([9, 9, 9]);
    expect(last).toBe(1);
  });

  it('hands back a space whose every body is held exactly as it stood', () => {
    const held = sky().map((node, i) => ({ ...node, seed: [i, -i, i / 2] as [number, number, number], frozen: true }));
    const out = constellations_layout(held, PHYSICS_DEFAULT);
    held.forEach((node) => expect(out[node.id]).toEqual(node.seed));
  });

  it('settles a space with no stars by its edges alone', () => {
    const plain = constellations_layout(feed(1, ['a', 'b']), PHYSICS_DEFAULT);
    expect(Object.keys(plain)).toEqual(['feed:1:0', 'feed:1:1']);
  });
});

describe('the constellations engine', () => {
  it('is registered, and needs each stage\'s plugin', () => {
    const engine = layoutEngine_get('constellations');
    expect(engine?.label).toBe('CONSTELLATIONS');
    expect(layoutNeeds_missing(engine!, [{ id: 'x', parents: [], radius: 1, group: null }])).toEqual(['plugin']);
    expect(Object.keys(engine!.run({ nodes: sky(), physics: PHYSICS_DEFAULT }, () => undefined).positions)).toHaveLength(sky().length);
  });
});
