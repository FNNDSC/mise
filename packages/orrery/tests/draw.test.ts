/**
 * @file The drawing layer's pure pieces: tubes, star layers, the sphere
 * cache, the star scale, halos and shells.
 */
import { describe, it, expect } from '@jest/globals';
import * as THREE from 'three';
import { tubeMesh_make, type TubeSpec } from '../src/draw/tubes.js';
import { starLayer_make, starScale_of, type StarEntry } from '../src/draw/stars.js';
import { SphereGeometries, fibonacciPoint_make, haloRadius_of } from '../src/draw/geometry.js';
import { DIM_OPACITY } from '../src/draw/constants.js';

describe('tubes', () => {
  it('carries one instance per spec, with its hue, mode and start', () => {
    const specs: TubeSpec[] = [
      { from: new THREE.Vector3(0, 0, 0), to: new THREE.Vector3(0, 2, 0), width: 0.1, color: new THREE.Color(1, 0, 0), mode: 2, start: 450 },
      { from: new THREE.Vector3(1, 0, 0), to: new THREE.Vector3(1, 0, 3), width: 0.2, color: new THREE.Color(0, 1, 0), mode: 1, start: 0 },
    ];
    const mesh = tubeMesh_make(specs, 3000);
    expect(mesh.count).toBe(2);
    expect(Array.from(mesh.geometry.getAttribute('aMode').array)).toEqual([2, 1]);
    expect(Array.from(mesh.geometry.getAttribute('aStart').array)).toEqual([450, 0]);
    expect(Array.from(mesh.geometry.getAttribute('aColor').array)).toEqual([1, 0, 0, 0, 1, 0]);
    const matrix = new THREE.Matrix4();
    mesh.getMatrixAt(0, matrix);
    const position = new THREE.Vector3().setFromMatrixPosition(matrix);
    expect(position.toArray()).toEqual([0, 1, 0]);
    expect((mesh.material as THREE.ShaderMaterial).uniforms['cycle']?.value).toBe(3000);
  });
});

describe('stars', () => {
  it('builds one layer, recording each entry\'s slot, dimmed ones faint', () => {
    const entries: StarEntry[] = [
      { id: 'a', position: new THREE.Vector3(1, 2, 3), radius: 0.5, color: new THREE.Color(1, 1, 1), dim: false, ember: false },
      { id: 'b', position: new THREE.Vector3(4, 5, 6), radius: 0.7, color: new THREE.Color(0, 0, 1), dim: true, ember: false },
    ];
    const layer = starLayer_make(entries, false, 3, 2);
    expect(entries.map((e) => [e.layer, e.slot])).toEqual([[3, 0], [3, 1]]);
    expect(Array.from(layer.base)).toEqual([1, Math.fround(DIM_OPACITY * 1.5)]);
    expect(layer.points.renderOrder).toBe(1);
    expect(layer.material.blending).toBe(THREE.AdditiveBlending);
    expect(starLayer_make(entries, true, 4, 1).material.blending).toBe(THREE.NormalBlending);
  });

  it('scales to the canvas and the camera', () => {
    expect(starScale_of(1000, 90)).toBeCloseTo(500, 9);
  });
});

describe('shapes', () => {
  it('shares one sphere per radius, to a thousandth', () => {
    const cache = new SphereGeometries();
    expect(cache.of(0.5)).toBe(cache.of(0.5004));
    expect(cache.of(0.5)).not.toBe(cache.of(0.6));
    cache.dispose();
  });

  it('grows a halo with its crowd', () => {
    expect(haloRadius_of(1)).toBeLessThan(haloRadius_of(100));
  });

  it('spreads a shell of points on its sphere', () => {
    for (let k = 0; k < 5; k++) expect(fibonacciPoint_make(k, 5, 2).length()).toBeCloseTo(2, 9);
    expect(fibonacciPoint_make(0, 1, 2).toArray()).toEqual([2, 0, 0]);
  });
});
