/**
 * @file Pointer gestures: a drag orbits or pans and is no click, a press
 * on a node is the scene's grab, a tap selects and two taps activate, two
 * fingers pinch and pan, the wheel dollies — on a fake canvas and a clock
 * the test owns.
 */
import { describe, it, expect, beforeEach } from '@jest/globals';
import * as THREE from 'three';
import { CameraRig } from '../src/controls/cameraRig.js';
import { PointerGestures, type GestureTarget } from '../src/controls/gestures.js';

/** A canvas that keeps its listeners and lets the test fire events at them. */
class FakeCanvas {
  public readonly style: Record<string, string> = {};
  private readonly listeners: Map<string, Array<(event: Event) => void>> = new Map();
  public addEventListener(name: string, handler: (event: Event) => void): void {
    this.listeners.set(name, [...(this.listeners.get(name) ?? []), handler]);
  }
  public removeEventListener(name: string, handler: (event: Event) => void): void {
    this.listeners.set(name, (this.listeners.get(name) ?? []).filter((h) => h !== handler));
  }
  public setPointerCapture(): void {
    // Capture is a nicety the gestures do not depend on.
  }
  public fire(name: string, props: Record<string, unknown> = {}): { defaultPrevented: boolean } {
    const event = { type: name, defaultPrevented: false, preventDefault(): void { this.defaultPrevented = true; }, clientX: 0, clientY: 0, button: 0, shiftKey: false, pointerId: 1, pointerType: 'mouse', isPrimary: true, deltaY: 0, ...props };
    for (const handler of this.listeners.get(name) ?? []) handler(event as unknown as Event);
    return event;
  }
}

let now: number;
let canvas: FakeCanvas;
let camera: THREE.PerspectiveCamera;
let world: THREE.Group;
let rig: CameraRig;
let log: string[];
let grabs: boolean;
let grabMoved: boolean;
let flat: boolean;
let untethered: boolean;
let gestures: PointerGestures;

beforeEach(() => {
  now = 5_000_000;
  canvas = new FakeCanvas();
  camera = new THREE.PerspectiveCamera(50, 1, 0.1, 200);
  camera.position.set(0, 0, 14);
  camera.updateMatrixWorld(true);
  world = new THREE.Group();
  rig = new CameraRig(camera, world, () => now, 0);
  log = [];
  grabs = false;
  grabMoved = false;
  flat = false;
  untethered = false;
  const target: GestureTarget = {
    grab_begin: () => { log.push('grab'); return grabs; },
    grab_move: () => { log.push('grab-move'); grabMoved = true; },
    grab_end: () => { log.push('grab-end'); return grabMoved; },
    hover: () => { log.push('hover'); },
    leave: () => { log.push('leave'); },
    tap: (_event, kind) => { log.push(kind); },
    tip_hide: () => { log.push('tip-hide'); },
  };
  gestures = new PointerGestures(canvas as unknown as HTMLElement, rig, target, { flat: () => flat, untethered: () => untethered }, () => now);
});

/** A mouse press, a drag by (dx, dy) in six steps, a release and its click. */
function mouseDrag(dx: number, dy: number, props: Record<string, unknown> = {}): void {
  canvas.fire('pointerdown', { clientX: 100, clientY: 100, ...props });
  for (let k = 1; k <= 6; k++) canvas.fire('pointermove', { clientX: 100 + (dx * k) / 6, clientY: 100 + (dy * k) / 6, ...props });
  canvas.fire('pointerup', props);
  canvas.fire('click', { clientX: 100 + dx, clientY: 100 + dy });
}

const turned = (): number => world.quaternion.angleTo(new THREE.Quaternion());

describe('a mouse', () => {
  it('orbits on an empty-space drag, marks the camera placed, and the release is no click', () => {
    expect(canvas.style['touchAction']).toBe('none');
    mouseDrag(60, 0);
    expect(turned()).toBeCloseTo(60 * 0.005, 6);
    expect(rig.touched_get()).toBe(true);
    expect(log).not.toContain('select');
    expect(log).toContain('tip-hide');
  });

  it('pans with shift, the right button, or in a flat view', () => {
    mouseDrag(50, 0, { shiftKey: true });
    expect(rig.focus.x).toBeLessThan(0);
    expect(turned()).toBe(0);
    rig.focus.set(0, 0, 0);
    flat = true;
    mouseDrag(50, 0);
    expect(rig.focus.x).toBeLessThan(0);
    expect(turned()).toBe(0);
  });

  it('selects on a click that did not travel, and activates on a double click', () => {
    mouseDrag(2, 0);
    expect(log.filter((e) => e === 'select')).toHaveLength(1);
    expect(rig.touched_get()).toBe(false);
    canvas.fire('dblclick');
    expect(log).toContain('activate');
  });

  it('hands a press on a node to the scene, move by move, and swallows the pull\'s click', () => {
    grabs = true;
    mouseDrag(40, 0);
    expect(log.filter((e) => e === 'grab-move')).toHaveLength(6);
    expect(log).toContain('grab-end');
    expect(log).not.toContain('select');
    expect(turned()).toBe(0);
  });

  it('lets a grab that never moved click', () => {
    grabs = true;
    canvas.fire('pointerdown', { clientX: 100, clientY: 100 });
    canvas.fire('pointerup');
    canvas.fire('click', { clientX: 100, clientY: 100 });
    expect(log).toContain('select');
  });

  it('does nothing on a press while a flight or a hold has the camera', () => {
    rig.flyInto(new THREE.Vector3(0, 0, 4), () => undefined);
    mouseDrag(60, 0);
    expect(log).not.toContain('grab');
    expect(turned()).toBe(0);
  });

  it('dollies on the wheel, down the eye ray when untethered', () => {
    const wheel = canvas.fire('wheel', { deltaY: -500 });
    expect(wheel.defaultPrevented).toBe(true);
    expect(camera.position.z).toBeCloseTo(14 * Math.exp(-0.5), 6);
    untethered = true;
    camera.lookAt(0, 0, 0);
    const before = camera.position.z;
    canvas.fire('wheel', { deltaY: -100 });
    expect(camera.position.z).toBeCloseTo(before - 100 * Math.max(4, before) * 0.0012, 6);
  });

  it('is over the field while it hovers, and not once it leaves', () => {
    canvas.fire('pointermove', { clientX: 5, clientY: 5 });
    expect(gestures.pointerOver()).toBe(true);
    canvas.fire('pointerleave');
    expect(gestures.pointerOver()).toBe(false);
    expect(log).toEqual(['hover', 'leave']);
  });

  it('refuses the browser\'s menu, which would eat a right-drag', () => {
    expect(canvas.fire('contextmenu').defaultPrevented).toBe(true);
  });

  it('stops listening once detached', () => {
    gestures.detach();
    mouseDrag(60, 0);
    expect(log).toEqual([]);
  });
});

describe('fingers', () => {
  const touch = (name: string, id: number, x: number, y: number, primary: boolean = id === 1): void => {
    canvas.fire(name, { pointerType: 'touch', pointerId: id, clientX: x, clientY: y, isPrimary: primary });
  };

  it('names what a finger lands on, and takes two quick taps close together as one activation', () => {
    touch('pointerdown', 1, 50, 50);
    expect(gestures.pressKind()).toBe('touch');
    expect(log.slice(0, 3)).toEqual(['grab', 'tip-hide', 'hover']);
    touch('pointerup', 1, 50, 50);
    canvas.fire('click', { clientX: 50, clientY: 50 });
    now += 200;
    touch('pointerdown', 1, 55, 52);
    touch('pointerup', 1, 55, 52);
    canvas.fire('click', { clientX: 55, clientY: 52 });
    // The browser's own dblclick that follows is the same act.
    canvas.fire('dblclick');
    expect(log.filter((e) => e === 'select')).toHaveLength(1);
    expect(log.filter((e) => e === 'activate')).toHaveLength(1);
  });

  it('keeps two taps far apart, or slow, as two selects', () => {
    touch('pointerdown', 1, 50, 50);
    touch('pointerup', 1, 50, 50);
    canvas.fire('click', { clientX: 50, clientY: 50 });
    now += 1000;
    touch('pointerdown', 1, 50, 50);
    touch('pointerup', 1, 50, 50);
    canvas.fire('click', { clientX: 50, clientY: 50 });
    expect(log.filter((e) => e === 'select')).toHaveLength(2);
  });

  it('closes in on a spread and pans with the pair; the lift is no tap', () => {
    touch('pointerdown', 1, 100, 100);
    touch('pointerdown', 2, 140, 100, false);
    touch('pointermove', 2, 180, 100, false);
    expect(camera.position.z).toBeCloseTo(14 * (40 / 80), 6);
    expect(rig.focus.x).toBeLessThan(0);
    // The finger left behind neither orbits nor taps.
    touch('pointerup', 2, 180, 100, false);
    touch('pointermove', 1, 160, 100);
    expect(turned()).toBe(0);
    touch('pointerup', 1, 160, 100);
    canvas.fire('click', { clientX: 160, clientY: 100 });
    expect(log).not.toContain('select');
  });

  it('does not pan a pinch when untethered', () => {
    untethered = true;
    touch('pointerdown', 1, 100, 100);
    touch('pointerdown', 2, 140, 100, false);
    touch('pointermove', 2, 180, 100, false);
    expect(rig.focus.x).toBe(0);
  });

  it('lets go of a pull when a second finger lands', () => {
    grabs = true;
    touch('pointerdown', 1, 100, 100);
    touch('pointermove', 1, 130, 100);
    touch('pointerdown', 2, 200, 100, false);
    expect(log).toContain('grab-end');
    touch('pointermove', 2, 220, 100, false);
    expect(log.filter((e) => e === 'grab-move')).toHaveLength(1);
  });

  it('starts a new touch clean: a lift the browser never reported leaves no phantom finger', () => {
    touch('pointerdown', 1, 100, 100);
    touch('pointerdown', 2, 140, 100, false);
    // Both lifts lost; a fresh touch begins.
    touch('pointerdown', 7, 50, 50, true);
    expect(gestures.fingersDown()).toBe(1);
    expect(log.filter((e) => e === 'grab')).toHaveLength(2);
  });
});
