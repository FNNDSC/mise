/**
 * @file The camera rig: framing, orbit, dolly and pan, the flights and the
 * hold inside a node, the idle spin's pause, the ambient tumble — driven on
 * a clock the test owns.
 */
import { describe, it, expect, beforeEach } from '@jest/globals';
import * as THREE from 'three';
import { CameraRig, SPIN_RESUME_MS, FLIGHT_INTO_MS, SPIN_INTERACTIVE, ease_smooth } from '../src/controls/cameraRig.js';

let now: number;
let camera: THREE.PerspectiveCamera;
let world: THREE.Group;
let rig: CameraRig;

/** Moves the test's clock and lets the rig's flight catch up. */
function advance(ms: number): void {
  now += ms;
  rig.flight_step();
  camera.updateMatrixWorld(true);
}

beforeEach(() => {
  now = 1_000_000;
  camera = new THREE.PerspectiveCamera(50, 1, 0.1, 200);
  camera.position.set(0, 0, 14);
  camera.updateMatrixWorld(true);
  world = new THREE.Group();
  rig = new CameraRig(camera, world, () => now, 0);
});

/** The distance at which a radius fills a square 50° view. */
const fitAt = (radius: number): number => radius / Math.tan((50 * Math.PI) / 360);

describe('framing', () => {
  it('moves the world so the centre is the origin and stands back to hold the radius', () => {
    rig.frame(new THREE.Vector3(5, -2, 1), 10);
    expect(world.position.toArray()).toEqual([-5, 2, -1]);
    expect(rig.focus.toArray()).toEqual([0, 0, 0]);
    expect(camera.position.z).toBeCloseTo(fitAt(10) * 1.15, 9);
    expect(camera.far).toBeCloseTo(Math.max(200, (fitAt(10) * 1.15 + 10) * 2), 9);
  });

  it('never stands closer than its floor, and opens a cloud on a three-quarter orbit', () => {
    rig.frame(new THREE.Vector3(), 0.1);
    expect(camera.position.z).toBe(8);
    rig.frame(new THREE.Vector3(), 0.1, { stance: 'threeQuarter', farScale: 2.5 });
    expect(camera.position.toArray()).toEqual([4, 3.2, 6.8]);
  });

  it('frames a turned world about the same centre', () => {
    world.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
    rig.frame(new THREE.Vector3(1, 0, 0), 2);
    world.updateMatrixWorld(true);
    const seen: THREE.Vector3 = world.localToWorld(new THREE.Vector3(1, 0, 0));
    expect(seen.length()).toBeCloseTo(0, 9);
  });
});

describe('steering by hand', () => {
  it('turns the world about the focus, which stays where it is', () => {
    rig.focus.set(3, 0, 0);
    rig.turn_about(new THREE.Vector3(0, 1, 0), 1.2);
    world.updateMatrixWorld(true);
    const focusPointBefore = new THREE.Vector3(3, 0, 0);
    // A point that sat on the focus before the turn still sits there.
    const moved = world.worldToLocal(focusPointBefore.clone());
    expect(world.localToWorld(moved).distanceTo(focusPointBefore)).toBeCloseTo(0, 9);
    expect(world.position.distanceTo(new THREE.Vector3(3, 0, 0))).toBeCloseTo(3, 9);
  });

  it('dollies toward the focus within its limits, and marks the camera placed', () => {
    expect(rig.touched_get()).toBe(false);
    rig.dolly(-100_000);
    expect(camera.position.z).toBeCloseTo(1.5, 9);
    rig.dolly(100_000);
    expect(camera.position.z).toBeCloseTo(90, 9);
    expect(rig.touched_get()).toBe(true);
    rig.touch_clear();
    expect(rig.touched_get()).toBe(false);
  });

  it('dollies down the eye ray when asked, unclamped', () => {
    camera.lookAt(0, 0, 0);
    rig.dolly(-1000, true);
    expect(camera.position.z).toBeCloseTo(14 - 1000 * 14 * 0.0012, 9);
  });

  it('pans the camera and the focus together', () => {
    rig.pan(100, 0);
    expect(rig.focus.x).toBeCloseTo(-100 * 14 * 0.0016, 9);
    expect(camera.position.x).toBeCloseTo(rig.focus.x, 9);
    expect(rig.eyeDistance()).toBeCloseTo(14, 9);
  });

  it('orbits: a drag across turns the world about its up', () => {
    rig.orbit(100, 0);
    expect(world.quaternion.angleTo(new THREE.Quaternion())).toBeCloseTo(0.5, 9);
  });
});

describe('the idle spin', () => {
  it('turns when let, and waits after a touch', () => {
    rig.spin_step(true);
    expect(world.quaternion.angleTo(new THREE.Quaternion())).toBeCloseTo(SPIN_INTERACTIVE, 9);
    const q = world.quaternion.clone();
    rig.spin_step(false);
    expect(world.quaternion.equals(q)).toBe(true);
    rig.spin_pause();
    rig.spin_step(true);
    expect(world.quaternion.equals(q)).toBe(true);
    now += SPIN_RESUME_MS;
    rig.spin_step(true);
    expect(world.quaternion.equals(q)).toBe(false);
  });

  it('tumbles a miniature about a wandering axis', () => {
    rig.tumble_step();
    const first = world.quaternion.clone();
    rig.tumble_step();
    expect(world.quaternion.angleTo(first)).toBeGreaterThan(0);
  });
});

describe('flights', () => {
  it('flies to frame a set, along the line it looks down, holding the bulk', () => {
    const reaches = [0, 1, 2, 3, 4, 5, 6, 7, 8, 100].map((x: number) => ({ position: new THREE.Vector3(x, 0, 0), radius: 0.5 }));
    let arrived = 0;
    rig.flyToFit(reaches, 500, () => { arrived += 1; }, 0.9);
    expect(rig.flying()).toBe(true);
    expect(rig.focus.x).toBeCloseTo(13.6, 9);
    advance(250);
    expect(arrived).toBe(0);
    advance(250);
    expect(arrived).toBe(1);
    expect(rig.flying()).toBe(false);
    // Nine of ten are held — the farthest of them sits 13.6 from the centre —
    // and the outlier at 100 spills.
    expect(rig.eyeDistance()).toBeCloseTo(fitAt(13.6 + 0.5) * 1.15, 6);
    const look = camera.getWorldDirection(new THREE.Vector3());
    const toFocus = rig.focus.clone().sub(camera.position).normalize();
    expect(look.distanceTo(toFocus)).toBeCloseTo(0, 6);
  });

  it('arrives at once when there is nothing to frame', () => {
    let arrived = false;
    rig.flyToFit([], 500, () => { arrived = true; });
    expect(arrived).toBe(true);
    expect(rig.flying()).toBe(false);
  });

  it('flies toward one thing, never closer than four radii', () => {
    rig.flyToward({ position: new THREE.Vector3(0, 0, 0), radius: 2 }, 3, 100, () => undefined);
    advance(100);
    expect(rig.eyeDistance()).toBeCloseTo(8, 9);
  });

  it('flies into a thing and holds, then flies back to where it stood', () => {
    const start = camera.position.clone();
    let inside = false;
    expect(rig.flyInto(new THREE.Vector3(0, 0, 4), () => { inside = true; })).toBe(true);
    expect(rig.holding_get()).toBe(true);
    expect(rig.flyInto(new THREE.Vector3(1, 1, 1), () => undefined)).toBe(false);
    advance(FLIGHT_INTO_MS);
    expect(inside).toBe(true);
    expect(camera.position.distanceTo(new THREE.Vector3(0, 0, 4))).toBeCloseTo(0.4, 9);
    rig.spin_step(true);
    expect(world.quaternion.angleTo(new THREE.Quaternion())).toBe(0);
    let home = false;
    rig.flyBack(() => { home = true; });
    advance(FLIGHT_INTO_MS);
    expect(home).toBe(true);
    expect(rig.holding_get()).toBe(false);
    expect(camera.position.distanceTo(start)).toBeCloseTo(0, 9);
    // Back home, the space waits a moment before it turns again.
    rig.spin_step(true);
    expect(world.quaternion.angleTo(new THREE.Quaternion())).toBe(0);
  });

  it('releases a hold it has no stance for', () => {
    let done = false;
    rig.flyBack(() => { done = true; });
    expect(done).toBe(true);
    expect(rig.holding_get()).toBe(false);
  });

  it('eases in and out', () => {
    expect(ease_smooth(0)).toBe(0);
    expect(ease_smooth(0.5)).toBe(0.5);
    expect(ease_smooth(1)).toBe(1);
  });
});
