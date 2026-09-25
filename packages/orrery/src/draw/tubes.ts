/**
 * @file Tubes: the lit cylinders a solid edge wears, carrying a pulse from parent to child — streaming into a live stage, replaying a finished run.
 *
 * @module
 */

import * as THREE from 'three';
import { PULSE_TRIP_MS } from './timing.js';

/**
 * The most job-to-job edges a census draws as tubes. Past it the census
 * keeps its lines: a lab's whole history is hundreds of thousands of
 * edges, and that many cylinders would stall the tablet it is read on.
 */
export const CENSUS_TUBE_CAP: number = 20_000;

export const TUBE_VERTEX: string = `
attribute vec3 aColor;
attribute float aMode;
attribute float aStart;
varying vec3 vColor;
varying float vMode;
varying float vStart;
varying float vAlong;
varying vec3 vNormal;
varying vec3 vView;
void main() {
  vAlong = position.y + 0.5;
  vec4 mv = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
  vView = -mv.xyz;
  vNormal = normalize(normalMatrix * mat3(instanceMatrix) * normal);
  vColor = aColor;
  vMode = aMode;
  vStart = aStart;
  gl_Position = projectionMatrix * mv;
}`;

/**
 * A tube lit by its facing, carrying a pulse from parent (its foot) to
 * child (its head): mode 1 streams (live), mode 2 replays the run — each
 * stage at vStart into a cycle that rests and repeats — mode 0 rests.
 */
export const TUBE_FRAGMENT: string = `
uniform float time;
uniform float opacity;
uniform float born;
uniform float cycle;
varying vec3 vColor;
varying float vMode;
varying float vStart;
varying float vAlong;
varying vec3 vNormal;
varying vec3 vView;
void main() {
  float facing = abs(dot(normalize(vNormal), normalize(vView)));
  vec3 base = vColor * (0.35 + 0.65 * facing);
  float pulse = 0.0;
  if (vMode > 0.5 && vMode < 1.5) {
    float head = fract(time / ${PULSE_TRIP_MS.toFixed(1)});
    pulse = smoothstep(0.14, 0.0, abs(vAlong - head));
  } else if (vMode > 1.5) {
    // A finished feed replays its run: the wave goes stage by stage in the
    // order the stages ran, rests, and goes again.
    float local = mod(time - born, cycle) - vStart;
    float head = local / ${(PULSE_TRIP_MS / 2).toFixed(1)};
    if (head > -0.1 && head < 1.2) pulse = smoothstep(0.14, 0.0, abs(vAlong - head));
  }
  gl_FragColor = vec4(base + vec3(1.0, 0.95, 0.8) * pulse * 1.3, opacity);
}`;

/** The tube every solid edge wears, stretched and turned per edge. */
let tubeGeometry: THREE.CylinderGeometry | null = null;

/** A unit tube, one high along y, centred: its foot at -0.5, its head at +0.5. */
export function tubeGeometry_get(): THREE.CylinderGeometry {
  if (tubeGeometry === null) tubeGeometry = new THREE.CylinderGeometry(1, 1, 1, 10, 1, true);
  return tubeGeometry;
}

/** One tube: where it runs, how wide, its hue, and its pulse. */
export interface TubeSpec {
  from: THREE.Vector3;
  to: THREE.Vector3;
  width: number;
  color: THREE.Color;
  /** 0 rests, 1 streams (a live stage), 2 replays (a finished run). */
  mode: number;
  /** When, into the replay's cycle, the wave sets off along it. */
  start: number;
}

/**
 * Makes one instanced mesh of tubes from their specs: the shared unit tube
 * stretched and turned per spec, each carrying its own hue and pulse.
 *
 * @param specs - The tubes.
 * @param cycle - The replay's period, in ms.
 * @returns The mesh, not yet added to anything.
 */
export function tubeMesh_make(specs: ReadonlyArray<TubeSpec>, cycle: number): THREE.InstancedMesh {
  const now: number = performance.now();
  const material: THREE.ShaderMaterial = new THREE.ShaderMaterial({
    uniforms: { time: { value: now }, opacity: { value: 1 }, born: { value: now }, cycle: { value: cycle } },
    vertexShader: TUBE_VERTEX,
    fragmentShader: TUBE_FRAGMENT,
    transparent: true,
  });
  const geometry: THREE.BufferGeometry = tubeGeometry_get().clone();
  const colors: Float32Array = new Float32Array(specs.length * 3);
  const modes: Float32Array = new Float32Array(specs.length);
  const starts: Float32Array = new Float32Array(specs.length);
  const mesh: THREE.InstancedMesh = new THREE.InstancedMesh(geometry, material, specs.length);
  const up: THREE.Vector3 = new THREE.Vector3(0, 1, 0);
  const carrier: THREE.Object3D = new THREE.Object3D();
  specs.forEach((spec: TubeSpec, i: number): void => {
    const along: THREE.Vector3 = spec.to.clone().sub(spec.from);
    const length: number = along.length();
    carrier.position.copy(spec.from).addScaledVector(along, 0.5);
    carrier.quaternion.setFromUnitVectors(up, length > 0 ? along.divideScalar(length) : up);
    carrier.scale.set(spec.width, length, spec.width);
    carrier.updateMatrix();
    mesh.setMatrixAt(i, carrier.matrix);
    colors.set([spec.color.r, spec.color.g, spec.color.b], i * 3);
    modes[i] = spec.mode;
    starts[i] = spec.start;
  });
  geometry.setAttribute('aColor', new THREE.InstancedBufferAttribute(colors, 3));
  geometry.setAttribute('aMode', new THREE.InstancedBufferAttribute(modes, 1));
  geometry.setAttribute('aStart', new THREE.InstancedBufferAttribute(starts, 1));
  mesh.instanceMatrix.needsUpdate = true;
  mesh.frustumCulled = false;
  return mesh;
}
