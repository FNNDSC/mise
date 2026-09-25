/**
 * @file Picking: a solid sphere wins, a halo only over nothing solid, a
 * dimmed thing takes no pointer, a census picks by ray, a star within its
 * drawn size (wider for a finger), a nebula the pointer is inside.
 */
import { describe, it, expect, beforeEach } from '@jest/globals';
import * as THREE from 'three';
import { Picker, TOUCH_REACH_PX, type PickStar, type PickNebula } from '../src/controls/picker.js';

const SIZE: number = 400;
let camera: THREE.PerspectiveCamera;
let world: THREE.Group;
let meshes: THREE.Mesh[];
let stars: PickStar[];
let nebulae: PickNebula[];
let census: { pick(raycaster: THREE.Raycaster): string | null } | null;
let picker: Picker;

const element = { getBoundingClientRect: (): DOMRect => ({ left: 0, top: 0, width: SIZE, height: SIZE, right: SIZE, bottom: SIZE, x: 0, y: 0, toJSON: () => ({}) }) };
const centre = { clientX: SIZE / 2, clientY: SIZE / 2 };

/** A sphere naming a node, at a place, with marks. */
function sphere(nodeId: string, radius: number, at: [number, number, number], marks: Record<string, unknown> = {}): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 16, 12), new THREE.MeshBasicMaterial());
  mesh.position.set(...at);
  mesh.userData = { nodeId, ...marks };
  world.add(mesh);
  meshes.push(mesh);
  return mesh;
}

/** Pixels on screen per world unit at a depth, for this camera and canvas. */
const perUnitAt = (depth: number): number => SIZE / (2 * Math.tan((50 * Math.PI) / 360)) / depth;

beforeEach(() => {
  camera = new THREE.PerspectiveCamera(50, 1, 0.1, 200);
  camera.position.set(0, 0, 10);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);
  world = new THREE.Group();
  meshes = [];
  stars = [];
  nebulae = [];
  census = null;
  picker = new Picker(camera, world, element, { meshes: () => meshes, stars: () => stars, nebulae: () => nebulae, census: () => census }, 2);
});

describe('spheres', () => {
  it('takes the sphere under the pointer, and nothing over empty space', () => {
    sphere('a', 1, [0, 0, 0]);
    expect(picker.meshNode_under(centre)).toBe('a');
    expect(picker.meshNode_under({ clientX: 5, clientY: 5 })).toBeNull();
  });

  it('lets a dimmed sphere take no pointer', () => {
    sphere('a', 1, [0, 0, 0], { dim: true });
    expect(picker.mesh_under(centre)).toBeNull();
  });

  it('takes a solid sphere inside a halo, and the halo only over nothing solid', () => {
    sphere('cluster', 3, [0, 0, 0], { halo: true });
    sphere('a', 0.5, [0, 0, 0]);
    expect(picker.meshNode_under(centre)).toBe('a');
    const offSolid = { clientX: SIZE / 2 + 2 * perUnitAt(10), clientY: SIZE / 2 };
    expect(picker.meshNode_under(offSolid)).toBe('cluster');
  });

  it('follows a moved and turned world', () => {
    sphere('a', 1, [5, 0, 0]);
    world.position.set(-5, 0, 0);
    expect(picker.meshNode_under(centre)).toBe('a');
  });

  it('aims the ray from the eye through the pointer', () => {
    const ray = picker.ray_aim(centre).ray;
    expect(ray.origin.toArray()).toEqual([0, 0, 10]);
    expect(ray.direction.z).toBeCloseTo(-1, 9);
  });
});

describe('stars and nebulae', () => {
  const star = (id: string, x: number, radius: number = 0.1, dim: boolean = false): PickStar => ({ id, position: new THREE.Vector3(x, 0, 0), radius, dim });

  it('takes a star within its drawn size, nearest for its size winning', () => {
    stars = [star('near', 0.05), star('far', 0.5)];
    expect(picker.star_under(centre, false)).toBe('near');
  });

  it('misses a star farther than its reach, but a finger reaches farther', () => {
    stars = [star('s', 0, 0.01)];
    const off = { clientX: SIZE / 2 + 8, clientY: SIZE / 2 };
    expect(picker.star_under(off, false)).toBeNull();
    expect(picker.star_under(off, true)).toBe('s');
    expect(picker.star_under({ clientX: SIZE / 2 + TOUCH_REACH_PX + 1, clientY: SIZE / 2 }, true)).toBeNull();
  });

  it('lets a dimmed star and a star behind the eye take no pointer', () => {
    stars = [star('dim', 0, 0.5, true), { id: 'behind', position: new THREE.Vector3(0, 0, 20), radius: 0.5, dim: false }];
    expect(picker.star_under(centre, false)).toBeNull();
  });

  it('takes a nebula the pointer is inside when no star answers', () => {
    nebulae = [{ id: 'cloud', position: new THREE.Vector3(0, 0, 0), radius: 2 }];
    expect(picker.star_under({ clientX: SIZE / 2 + perUnitAt(10), clientY: SIZE / 2 }, false)).toBe('cloud');
    expect(picker.star_under({ clientX: SIZE / 2 + 3 * perUnitAt(10), clientY: SIZE / 2 }, false)).toBeNull();
  });
});

describe('the order of what is picked', () => {
  it('prefers a solid sphere, then a census, then a star', () => {
    stars = [{ id: 'star', position: new THREE.Vector3(0, 0, 0), radius: 0.5, dim: false }];
    expect(picker.node_under(centre, false)).toBe('star');
    let aimed: THREE.Raycaster | null = null;
    census = { pick: (raycaster: THREE.Raycaster): string | null => { aimed = raycaster; return 'member'; } };
    expect(picker.node_under(centre, false)).toBe('member');
    expect(aimed).not.toBeNull();
    sphere('solid', 1, [0, 0, 0]);
    expect(picker.node_under(centre, false)).toBe('solid');
  });
});
