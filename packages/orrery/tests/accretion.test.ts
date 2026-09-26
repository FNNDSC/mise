/**
 * @file Accretion: feeds grow in the order they were made, like on like,
 * no two overlapping, each molecule whole, the same coral every time.
 */
import { describe, it, expect } from '@jest/globals';
import { accretion_layout, feedLikeness_of } from '../src/layout/accretion.js';
import { layoutEngine_get, layoutNeeds_missing } from '../src/layout/registry.js';
import { PHYSICS_DEFAULT, type LayoutNode, type Positions, type Vec3 } from '../src/layout/types.js';

/** A feed running plugins in a chain, made at `created`. */
const feed = (id: number, plugins: string[], created: number): LayoutNode[] => plugins.map((plugin, i): LayoutNode => ({
  id: `feed:${id}:${i}`, parents: i === 0 ? [] : [`feed:${id}:${i - 1}`], radius: 0.5, group: `feed:${id}`, attrs: { plugin, createdAt: created },
}));

/** Two families, made alternately, and a lonely feed made last. */
function lab(): LayoutNode[] {
  const nodes: LayoutNode[] = [];
  for (let i = 0; i < 16; i++) {
    nodes.push(...(i % 2 === 0 ? feed(i, ['pl-dircopy', 'pl-dcm2niix', 'pl-fastsurfer'], i) : feed(i, ['pl-dircopy', 'pl-civet', 'pl-report'], i)));
  }
  nodes.push(...feed(16, ['pl-lonely'], 16));
  return nodes;
}

/** A feed's centre: the mean of its nodes. */
const centre = (p: Positions, id: number, size: number): Vec3 => {
  const out: Vec3 = [0, 0, 0];
  for (let i = 0; i < size; i++) for (let a = 0; a < 3; a++) out[a] = (out[a] as number) + ((p[`feed:${id}:${i}`] as Vec3)[a] as number) / size;
  return out;
};
const gap = (a: Vec3, b: Vec3): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

describe('feedLikeness_of', () => {
  it('weighs what both ran over what either ran', () => {
    const weights = new Map([['a', 1], ['b', 1], ['c', 2], ['landmark', 0]]);
    expect(feedLikeness_of(new Set(['a', 'b']), new Set(['a', 'b']), weights)).toBe(1);
    expect(feedLikeness_of(new Set(['a', 'landmark']), new Set(['c', 'landmark']), weights)).toBe(0);
    expect(feedLikeness_of(new Set(['a', 'c']), new Set(['c']), weights)).toBeCloseTo(2 / 3, 9);
    expect(feedLikeness_of(new Set(['landmark']), new Set(['landmark']), weights)).toBe(0);
  });
});

describe('accretion_layout', () => {
  const { positions, arrival } = accretion_layout(lab(), PHYSICS_DEFAULT);

  it('places every node, the oldest feed at the heart, arrivals in creation order', () => {
    expect(Object.keys(positions)).toHaveLength(16 * 3 + 1);
    expect(gap(centre(positions, 0, 3), [0, 0, 0])).toBeLessThan(1e-6);
    expect(arrival['feed:0:0']).toBe(0);
    expect(arrival['feed:7:2']).toBe(7);
    expect(arrival['feed:16:0']).toBe(16);
  });

  it('unfolds each molecule whole and compact, each its own way: feeds alike are not clones', () => {
    // A chain of three: two edges of 0.5 + 0.5 + 1.4, never further apart than that.
    const span = (id: number): number => gap(positions[`feed:${id}:0`] as Vec3, positions[`feed:${id}:2`] as Vec3);
    for (let id = 0; id < 16; id++) expect(span(id)).toBeLessThanOrEqual(4.8 + 1e-9);
    expect(gap(positions['feed:0:0'] as Vec3, positions['feed:0:1'] as Vec3)).toBeCloseTo(2.4, 9);
    const heading = (id: number): Vec3 => { const a = positions[`feed:${id}:0`] as Vec3; const b = positions[`feed:${id}:2`] as Vec3; return [b[0] - a[0], b[1] - a[1], b[2] - a[2]]; };
    expect(gap(heading(0), heading(2))).toBeGreaterThan(0.1);
  });

  it('grows like on like: a feed\'s nearest neighbour is mostly of its own family', () => {
    let kin: number = 0;
    for (let id = 1; id < 16; id++) {
      const mine: Vec3 = centre(positions, id, 3);
      let nearest: number = -1;
      let best: number = Infinity;
      for (let other = 0; other < 16; other++) {
        if (other === id) continue;
        const d: number = gap(mine, centre(positions, other, 3));
        if (d < best) { best = d; nearest = other; }
      }
      if (nearest % 2 === id % 2) kin += 1;
    }
    expect(kin).toBeGreaterThanOrEqual(12);
  });

  it('stands no two feeds in one another: stages of different feeds keep apart', () => {
    let closest: number = Infinity;
    const ids = Object.keys(positions);
    for (const a of ids) for (const b of ids) {
      if (a.split(':')[1] === b.split(':')[1]) continue;
      closest = Math.min(closest, gap(positions[a] as Vec3, positions[b] as Vec3));
    }
    expect(closest).toBeGreaterThan(0.5);
  });

  it('lets a newcomer accrete onto what has grown, and moves nothing already there', () => {
    const grown: LayoutNode[] = lab().filter((node) => node.group !== 'feed:16').map((node) => ({ ...node, seed: positions[node.id] as Vec3, frozen: true }));
    const late = accretion_layout([...grown, ...feed(17, ['pl-dircopy', 'pl-civet', 'pl-report'], 17)], PHYSICS_DEFAULT);
    for (const node of grown) expect(late.positions[node.id]).toEqual(positions[node.id]);
    const mine: Vec3 = centre(late.positions, 17, 3);
    const nearest: number = Math.min(...Array.from({ length: 16 }, (_v, id) => gap(mine, centre(positions, id, 3))));
    expect(nearest).toBeLessThan(10);
    expect(late.arrival['feed:17:0']).toBe(16);
  });

  it('grows the same coral every time', () => {
    expect(accretion_layout(lab(), PHYSICS_DEFAULT).positions).toEqual(positions);
  });

  it('answers the seeds when every node is held, and sets an anchor at the centre', () => {
    const held: LayoutNode[] = feed(1, ['pl-x'], 0).map((node) => ({ ...node, seed: [3, 4, 5] as Vec3, frozen: true }));
    expect(accretion_layout(held, PHYSICS_DEFAULT).positions).toEqual({ 'feed:1:0': [3, 4, 5] });
    const anchored = accretion_layout([{ id: 'hub', parents: [], radius: 1, group: null }, ...feed(1, ['pl-x'], 0)], PHYSICS_DEFAULT);
    expect(anchored.positions['hub']).toEqual([0, 0, 0]);
  });

  it('is registered as ACCRETION, needing each stage\'s plugin', () => {
    const engine = layoutEngine_get('accretion');
    expect(engine?.label).toBe('ACCRETION');
    expect(layoutNeeds_missing(engine!, [{ id: 'x', parents: [], radius: 1, group: 'g' }])).toEqual(['plugin']);
    expect(engine!.run({ nodes: lab(), physics: PHYSICS_DEFAULT }, () => undefined).arrival?.['feed:16:0']).toBe(16);
  });
});
