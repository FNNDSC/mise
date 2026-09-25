/**
 * @file The tube field against a fake scene: tubes carry the state of the
 * stage they run into, follow a pulled sphere, re-read a state that changed,
 * and light a replayed stage's lamp on the tubes' clock.
 */
import { describe, it, expect } from '@jest/globals';
import * as THREE from 'three';
import { TubeField, tubeMode_of, type TubeNode, type TubeOwner } from '../src/draw/tubeField.js';
import type { Palette } from '../src/draw/palette.js';
import { LAMP_DIM } from '../src/draw/lamps.js';
import type { NodeState } from '../src/types/encoding.js';

const palette: Palette = {
  running: new THREE.Color(1, 0.5, 0), done: new THREE.Color(1, 1, 0.8), error: new THREE.Color(1, 0, 0),
  template: new THREE.Color(1, 0.7, 0.3), unknown: new THREE.Color(0.3, 0.3, 0.3), edge: new THREE.Color(0.8, 0.3, 0),
  join: new THREE.Color(1, 0.8, 0.6), root: new THREE.Color(0.4, 0.7, 0.7), pulse: new THREE.Color(0.3, 0.8, 0.9),
};

/** A small molecule: a root, a child, a grandchild, and a join into the grandchild. */
function scene(states: Record<string, NodeState>) {
  const parent: THREE.Group = new THREE.Group();
  const nodes: Map<string, TubeNode> = new Map([
    ['r', { position: new THREE.Vector3(0, 0, 0), radius: 0.5, parents: [], joins: [], state: states['r'] ?? 'done' }],
    ['a', { position: new THREE.Vector3(0, 2, 0), radius: 0.5, parents: ['r'], joins: [], state: states['a'] ?? 'done' }],
    ['b', { position: new THREE.Vector3(2, 2, 0), radius: 0.5, parents: ['r'], joins: [], state: states['b'] ?? 'done' }],
    ['c', { position: new THREE.Vector3(0, 4, 0), radius: 0.5, parents: ['a'], joins: ['b'], state: states['c'] ?? 'done' }],
  ]);
  const spheres: Map<string, THREE.Mesh> = new Map();
  for (const [id, node] of nodes) {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(node.radius), new THREE.MeshStandardMaterial({ color: new THREE.Color(1, 1, 1) }));
    mesh.position.copy(node.position);
    spheres.set(id, mesh);
  }
  const field = new TubeField({ parent, node: (id) => nodes.get(id), sphere: (id) => spheres.get(id), palette: () => palette });
  const owner: TubeOwner = { tubes: null, mix: 1 };
  return { parent, nodes, spheres, field, owner, members: new Set(nodes.keys()), entries: [...nodes.keys()] };
}

describe('tube modes', () => {
  it('stream into work, replay what has run, rest otherwise', () => {
    expect(tubeMode_of('live')).toBe(1);
    expect(tubeMode_of('done')).toBe(2);
    expect(tubeMode_of('failed')).toBe(2);
    expect(tubeMode_of('rest')).toBe(0);
  });
});

describe('TubeField', () => {
  it('joins solid spheres: one tube per parent and join, coloured by the stage it runs into', () => {
    const { field, owner, entries, members, parent } = scene({ c: 'failed', b: 'live' });
    field.build(owner, entries, members);
    const mesh = owner.tubes as THREE.InstancedMesh;
    expect(mesh.count).toBe(4);
    expect(parent.children).toContain(mesh);
    expect(Array.from(mesh.geometry.getAttribute('aMode').array)).toEqual([2, 1, 2, 2]);
    const colors = Array.from(mesh.geometry.getAttribute('aColor').array);
    expect(colors.slice(6, 9)).toEqual([1, 0, 0]);
    expect(colors.slice(9, 12)).toEqual([1, 0, 0]);
    expect(field.materialCount()).toBe(1);
    expect(field.holds('c')).toBe(true);
    expect(field.holds('z')).toBe(false);
  });

  it('runs no tube to a sphere that is not solid', () => {
    const { field, owner, entries } = scene({});
    field.build(owner, ['r', 'a'], new Set(['r', 'a']));
    expect((owner.tubes as THREE.InstancedMesh).count).toBe(1);
  });

  it('follows a pulled sphere', () => {
    const { field, owner, entries, members, spheres } = scene({});
    field.build(owner, entries, members);
    (spheres.get('a') as THREE.Mesh).position.set(0, 6, 0);
    field.follow();
    const matrix = new THREE.Matrix4();
    (owner.tubes as THREE.InstancedMesh).getMatrixAt(0, matrix);
    expect(new THREE.Vector3().setFromMatrixPosition(matrix).toArray()).toEqual([0, 3, 0]);
  });

  it('re-reads a stage that started or finished, keeping the owner\'s fade', () => {
    const { field, owner, entries, members, nodes } = scene({ c: 'live' });
    owner.mix = 0.4;
    field.build(owner, entries, members);
    const before = owner.tubes;
    (nodes.get('c') as TubeNode).state = 'done';
    field.stale_mark();
    field.frame(performance.now());
    expect(owner.tubes).not.toBe(before);
    expect(Array.from((owner.tubes as THREE.InstancedMesh).geometry.getAttribute('aMode').array)).toEqual([2, 2, 2, 2]);
    expect(((owner.tubes as THREE.InstancedMesh).material as THREE.ShaderMaterial).uniforms['opacity']?.value).toBe(0.4);
    expect(field.materialCount()).toBe(1);
  });

  it('keeps a replayed stage dark until its pulse lands', () => {
    // A lamp that blooms draws its glow on a canvas; there is no page here.
    (globalThis as { document?: unknown }).document ??= { createElement: () => ({ width: 0, height: 0, getContext: () => null }) };
    const { field, owner, entries, members, spheres } = scene({});
    field.build(owner, entries, members);
    const born = ((owner.tubes as THREE.InstancedMesh).material as THREE.ShaderMaterial).uniforms['born']?.value as number;
    field.frame(born + 1);
    const c = (spheres.get('c') as THREE.Mesh).material as THREE.MeshStandardMaterial;
    expect(c.color.r).toBeCloseTo(LAMP_DIM, 6);
  });

  it('lets a set go, and forgets everything on a redraw', () => {
    const { field, owner, entries, members, parent } = scene({});
    field.build(owner, entries, members);
    field.release(owner.tubes as THREE.InstancedMesh);
    expect(field.materialCount()).toBe(0);
    expect(parent.children.length).toBe(0);
    field.census_build([{ from: new THREE.Vector3(), to: new THREE.Vector3(0, 1, 0), width: 0.1, color: palette.edge, mode: 2, start: 0 }], 0);
    expect(field.censusCount()).toBe(1);
    field.clear();
    expect(field.censusCount()).toBe(0);
    expect(field.materialCount()).toBe(0);
  });
});
