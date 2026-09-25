/**
 * @file Stars: every node a point of light, sized true to the sphere it stands for. Error-free stars glow additively; a star with any errored share is drawn solid over the glow, so failure always shows through.
 *
 * @module
 */

import * as THREE from 'three';
import { DIM_OPACITY } from './constants.js';

/** A star's smallest size on screen, in CSS pixels: no node ever vanishes. */
export const STAR_FLOOR_PX: number = 2;

/** A star never swells past this many CSS pixels: near the camera a feed is spheres, not a glow. */
export const STAR_CAP_PX: number = 28;

/** A star's sprite spans this many times its sphere's diameter: core plus glow. */
export const STAR_GLOW: number = 1.8;

export const STAR_VERTEX: string = `
attribute float radius;
attribute float alpha;
attribute vec3 tint;
uniform float scale;
uniform float floorPx;
uniform float capPx;
varying vec3 vTint;
varying float vAlpha;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  float px = ${STAR_GLOW.toFixed(1)} * 2.0 * radius * scale / max(0.0001, -mv.z);
  gl_PointSize = min(max(px, floorPx), capPx);
  vTint = tint;
  vAlpha = alpha;
}`;

/** The glow: a bright core falling off to nothing at the sprite's edge. */
export const STAR_FRAGMENT_GLOW: string = `
varying vec3 vTint;
varying float vAlpha;
void main() {
  float d = length(gl_PointCoord - vec2(0.5)) * 2.0;
  if (d > 1.0) discard;
  float core = smoothstep(0.6, 0.0, d);
  float halo = pow(1.0 - d, 2.2) * 0.55;
  float a = clamp(core + halo, 0.0, 1.0) * vAlpha;
  gl_FragColor = vec4(vTint * a, a);
}`;

/** The ember: an errored star drawn solid over the glow, so red stays red. */
export const STAR_FRAGMENT_EMBER: string = `
varying vec3 vTint;
varying float vAlpha;
void main() {
  float d = length(gl_PointCoord - vec2(0.5)) * 2.0;
  if (d > 1.0) discard;
  float a = smoothstep(1.0, 0.35, d) * vAlpha;
  gl_FragColor = vec4(vTint, a);
}`;

/** One star as drawn: whose it is, where, how big, its hue, whether dim, whether errored. */
export interface StarEntry {
  id: string;
  position: THREE.Vector3;
  radius: number;
  color: THREE.Color;
  dim: boolean;
  ember: boolean;
  /** Which layer draws it (0 glow, 1 ember) and its slot there, once drawn. */
  layer?: number;
  slot?: number;
}

/** One drawn layer of stars: its points, its material, and its alphas as drawn and as they rest. */
export interface StarLayer {
  points: THREE.Points;
  material: THREE.ShaderMaterial;
  alpha: THREE.BufferAttribute;
  base: Float32Array;
}

/**
 * Builds one layer of stars — the glow or the embers — as one draw call.
 * Each entry learns its slot in the layer.
 *
 * @param entries - The layer's stars.
 * @param ember - Whether this is the ember layer (drawn solid, over the glow).
 * @param layerIndex - The layer's index, recorded on each entry.
 * @param pixelRatio - The display's pixel ratio, for the size floor and cap.
 * @returns The layer, not yet added to anything.
 */
export function starLayer_make(entries: ReadonlyArray<StarEntry>, ember: boolean, layerIndex: number, pixelRatio: number): StarLayer {
  const positions: Float32Array = new Float32Array(entries.length * 3);
  const tints: Float32Array = new Float32Array(entries.length * 3);
  const radii: Float32Array = new Float32Array(entries.length);
  const alphas: Float32Array = new Float32Array(entries.length);
  entries.forEach((entry: StarEntry, i: number): void => {
    entry.layer = layerIndex;
    entry.slot = i;
    positions.set([entry.position.x, entry.position.y, entry.position.z], i * 3);
    tints.set([entry.color.r, entry.color.g, entry.color.b], i * 3);
    radii[i] = entry.radius;
    alphas[i] = entry.dim ? DIM_OPACITY * 1.5 : 1;
  });
  const geometry: THREE.BufferGeometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('tint', new THREE.BufferAttribute(tints, 3));
  geometry.setAttribute('radius', new THREE.BufferAttribute(radii, 1));
  const alpha: THREE.BufferAttribute = new THREE.BufferAttribute(alphas, 1);
  geometry.setAttribute('alpha', alpha);
  const material: THREE.ShaderMaterial = new THREE.ShaderMaterial({
    uniforms: { scale: { value: 1 }, floorPx: { value: STAR_FLOOR_PX * pixelRatio }, capPx: { value: STAR_CAP_PX * pixelRatio } },
    vertexShader: STAR_VERTEX,
    fragmentShader: ember ? STAR_FRAGMENT_EMBER : STAR_FRAGMENT_GLOW,
    transparent: true,
    depthWrite: false,
    blending: ember ? THREE.NormalBlending : THREE.AdditiveBlending,
  });
  const points: THREE.Points = new THREE.Points(geometry, material);
  // Embers over the glow: drawn after it, whatever the sort says.
  points.renderOrder = ember ? 2 : 1;
  points.frustumCulled = false;
  return { points, material, alpha, base: Float32Array.from(alphas) };
}

/**
 * The stars' pixel scale for a canvas and a camera: pixels per unit of size
 * at unit depth.
 *
 * @param heightPx - The canvas's height in device pixels.
 * @param fovDeg - The camera's vertical field of view, in degrees.
 * @returns The scale the star shader multiplies by.
 */
export function starScale_of(heightPx: number, fovDeg: number): number {
  return heightPx / (2 * Math.tan((fovDeg * Math.PI) / 360));
}
