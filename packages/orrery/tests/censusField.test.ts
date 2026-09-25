/**
 * @file The census: shells of jobs, anchors that count but draw nothing,
 * tubes while few and lines past that, points of light under stars, the
 * wave's flare, and a job picked by a ray.
 */
import { describe, it, expect } from '@jest/globals';
import * as THREE from 'three';
import { CensusField, type CensusNode } from '../src/draw/censusField.js';
import { StarField } from '../src/draw/starField.js';
import { TubeField } from '../src/draw/tubeField.js';
import type { Palette } from '../src/draw/palette.js';

const c = (r = 1, g = 1, b = 1): THREE.Color => new THREE.Color(r, g, b);
const palette: Palette = { running: c(), done: c(), error: c(1, 0, 0), template: c(), unknown: c(), edge: c(0.5, 0.2, 0), join: c(), root: c(), pulse: c(0, 1, 1) };

function census() {
  const parent = new THREE.Group();
  const stars = new StarField(parent);
  const tubes = new TubeField({ parent, node: () => undefined, sphere: () => undefined, palette: () => palette });
  const field = new CensusField({ parent, stars, tubes, starsView: () => ({ pixelRatio: 1, heightPx: 800, fovDeg: 50 }) });
  return { parent, stars, tubes, field };
}

const nodes = (fan: number): CensusNode[] => [
  { id: 'hub', position: new THREE.Vector3(-10, 0, 0), radius: 0.3, count: 1, color: c(), dim: false, ember: false, state: 'rest', parents: [], ghost: true },
  { id: 'r', position: new THREE.Vector3(0, 0, 0), radius: 0.5, count: 1, color: c(), dim: false, ember: false, state: 'done', parents: ['hub'] },
  { id: 'f', position: new THREE.Vector3(0, 5, 0), radius: 0.5, count: fan, color: c(0, 1, 0), dim: false, ember: false, state: 'done', parents: ['r'] },
];

describe('CensusField', () => {
  it('draws a shell of jobs for each stage; an anchor counts in the centre and draws none', () => {
    const { field, tubes } = census();
    const cloud = field.build(nodes(12), false, palette);
    expect(field.drawn()).toBe(true);
    expect(field.ids().length).toBe(13);
    expect(field.ids().filter((id) => id === 'f').length).toBe(12);
    expect(cloud.center.x).toBeCloseTo(-10 / 3, 9);
    expect(tubes.censusCount()).toBe(12);
  });

  it('keeps lines past the tube cap', () => {
    const { field, tubes, parent } = census();
    field.build(nodes(20_001), false, palette);
    expect(tubes.censusCount()).toBe(0);
    expect(parent.children.some((o) => o instanceof THREE.LineSegments)).toBe(true);
  });

  it('draws jobs as points of light under stars', () => {
    const { field, stars } = census();
    field.build(nodes(4), true, palette);
    expect(field.drawn()).toBe(false);
    expect(stars.count()).toBe(5);
  });

  it('flares every job of a stage with the wave, and says when the wave is done', () => {
    const { field, parent } = census();
    field.build(nodes(3), false, palette);
    const peak = field.flare((id) => (id === 'f' ? 450 : undefined), 450 + 350, c(0, 1, 1), 700);
    expect(peak).toBe(450);
    const mesh = parent.children.find((o) => o instanceof THREE.InstancedMesh) as THREE.InstancedMesh;
    const lit = new THREE.Color();
    mesh.getColorAt(1, lit);
    expect(lit.toArray().map((v) => Number(v.toFixed(6)))).toEqual([0, 1, 1]);
  });

  it('picks the stage behind the job a ray meets, lighting it', () => {
    const { field } = census();
    field.build(nodes(1), false, palette);
    const ray = new THREE.Raycaster(new THREE.Vector3(0, 5, 10), new THREE.Vector3(0, 0, -1));
    expect(field.pick(ray)).toBe('f');
    field.clear();
    expect(field.pick(ray)).toBeNull();
    expect(field.ids().length).toBe(0);
  });
});
