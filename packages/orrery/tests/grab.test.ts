/**
 * @file The grab: a press on a node takes hold of it, a move past the
 * threshold starts the pull (solo under ranked: the node alone tracks the
 * plane), a release eases a peeked node home over a few frames, and the
 * scene is told when positions moved.
 */
import { describe, it, expect } from '@jest/globals';
import * as THREE from 'three';
import { DRAG_THRESHOLD_PX } from '../src/controls/index.js';
import type { Picker } from '../src/controls/index.js';
import { GrabSession } from '../src/scene/grab.js';
import type { SpaceNode } from '../src/scene/node.js';

function node_make(id: string, parentIds: string[] = []): SpaceNode {
  return { id, label: id, parentIds, joinParentIds: [], look: { state: 'done', paint: { token: 'done' }, ember: false, waved: true } };
}

function event_make(x: number, y: number): PointerEvent {
  return { clientX: x, clientY: y } as unknown as PointerEvent;
}

/** A scene of two spheres, a picker that always hits the first, and a ray that lands where it is told. */
function scene_make(solo: boolean): { grab: GrabSession; meshes: Map<string, THREE.Mesh>; aim: THREE.Vector3; pauses: () => number; tick: (ms: number) => void } {
  let now: number = 50_000;
  const group: THREE.Group = new THREE.Group();
  const camera: THREE.PerspectiveCamera = new THREE.PerspectiveCamera();
  camera.position.set(0, 0, 10);
  camera.lookAt(0, 0, 0);
  const meshes: Map<string, THREE.Mesh> = new Map();
  for (const [id, x] of [['a', 0], ['b', 3]] as Array<[string, number]>) {
    const mesh: THREE.Mesh = new THREE.Mesh(new THREE.SphereGeometry(0.5), new THREE.MeshStandardMaterial());
    mesh.position.set(x, 0, 0);
    mesh.userData['nodeId'] = id;
    group.add(mesh);
    meshes.set(id, mesh);
  }
  const aim: THREE.Vector3 = new THREE.Vector3(1, 1, 0);
  let paused: number = 0;
  const picker = {
    mesh_under: (): THREE.Mesh | null => meshes.get('a') ?? null,
    ray_aim: () => ({ ray: { intersectPlane: (_plane: THREE.Plane, out: THREE.Vector3): THREE.Vector3 => out.copy(aim) } }),
  } as unknown as Picker;
  const grab: GrabSession = new GrabSession({
    picker,
    camera,
    group,
    meshes: () => meshes,
    nodes: () => [node_make('a'), node_make('b', ['a'])],
    solo: () => solo,
    dimensions: () => 3,
    spin_pause: (): void => { paused += 1; },
    now: () => now,
  });
  return { grab, meshes, aim, pauses: () => paused, tick: (ms: number): void => { now += ms; } };
}

describe('GrabSession', () => {
  it('takes hold of the node under the press, and nothing without one', () => {
    const { grab } = scene_make(true);
    expect(grab.dragging()).toBe(false);
    expect(grab.begin(event_make(0, 0))).toBe(true);
    expect(grab.dragging()).toBe(true);
    expect(grab.end()).toBe(false);
    expect(grab.dragging()).toBe(false);
  });

  it('under ranked, a moved pull peeks the node alone and eases it home on release', () => {
    const { grab, meshes, pauses, tick } = scene_make(true);
    const a: THREE.Mesh = meshes.get('a') as THREE.Mesh;
    grab.begin(event_make(0, 0));
    // Within the threshold nothing moves.
    expect(grab.move(event_make(1, 1))).toBe(false);
    expect(a.position.x).toBe(0);
    expect(grab.move(event_make(DRAG_THRESHOLD_PX + 5, 0))).toBe(true);
    expect(pauses()).toBe(2);
    expect(a.position.x).toBeCloseTo(1);
    expect(a.position.y).toBeCloseTo(1);
    // The release swallows the click, and the node eases home.
    expect(grab.end()).toBe(true);
    expect(grab.step()).toBe(true);
    tick(150);
    expect(grab.step()).toBe(true);
    const midway: number = a.position.x;
    expect(midway).toBeGreaterThan(0);
    expect(midway).toBeLessThan(1);
    tick(150);
    expect(grab.step()).toBe(true);
    expect(a.position.x).toBeCloseTo(0);
    expect(a.position.y).toBeCloseTo(0);
    // Home: nothing left to ease.
    tick(100);
    expect(grab.step()).toBe(false);
  });

  it('under the molecule, a moved pull heats the reaction and the release lets it cool', () => {
    const { grab, meshes } = scene_make(false);
    grab.begin(event_make(0, 0));
    expect(grab.positions()).toEqual([]);
    expect(grab.move(event_make(DRAG_THRESHOLD_PX + 5, 0))).toBe(false);
    expect(grab.positions().length).toBe(2);
    expect(grab.step()).toBe(true);
    const pinned = grab.positions().find((entry) => entry.id === 'a');
    expect(pinned?.position[0]).toBeCloseTo(1);
    expect(grab.end()).toBe(true);
    // Cooling: it steps on, then settles and is let go.
    let steps: number = 0;
    while (grab.step() && steps < 10_000) steps += 1;
    expect(steps).toBeGreaterThan(0);
    expect(grab.positions()).toEqual([]);
    expect(meshes.size).toBe(2);
  });

  it('forgets the grab and the simulation when cleared', () => {
    const { grab } = scene_make(false);
    grab.begin(event_make(0, 0));
    grab.move(event_make(DRAG_THRESHOLD_PX + 5, 0));
    grab.clear();
    expect(grab.dragging()).toBe(false);
    expect(grab.positions()).toEqual([]);
    expect(grab.step()).toBe(false);
  });
});
