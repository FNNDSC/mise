/**
 * @file The star field: stars drawn in two layers with their slots kept,
 * a molecule's stars and threads faded as it turns solid, nebulae marked,
 * and everything forgotten on a redraw.
 */
import { describe, it, expect, beforeAll } from '@jest/globals';
import * as THREE from 'three';
import { StarField } from '../src/draw/starField.js';
import type { StarEntry } from '../src/draw/stars.js';

beforeAll(() => {
  // A nebula's glow is drawn on a canvas; there is no page here.
  (globalThis as { document?: unknown }).document ??= { createElement: () => ({ width: 0, height: 0, getContext: () => null }) };
});

const star = (id: string, ember: boolean): StarEntry => ({ id, position: new THREE.Vector3(1, 2, 3), radius: 0.5, color: new THREE.Color(1, 1, 1), dim: false, ember });

describe('StarField', () => {
  it('draws glow and embers as two layers, keeping each star\'s place', () => {
    const parent = new THREE.Group();
    const field = new StarField(parent);
    field.draw([star('a', false), star('b', true), star('c', false)], 2, 1000, 90);
    expect(field.count()).toBe(3);
    expect(parent.children.length).toBe(2);
    expect(field.entry('b')?.layer).toBe(1);
    expect(field.entry('c')?.slot).toBe(1);
    expect([...field.ids()].sort()).toEqual(['a', 'b', 'c']);
    const material = (parent.children[0] as THREE.Points).material as THREE.ShaderMaterial;
    expect(material.uniforms['scale']?.value).toBeCloseTo(500, 9);
  });

  it('fades a molecule\'s stars and threads, and shows the fade once flushed', () => {
    const parent = new THREE.Group();
    const field = new StarField(parent);
    const entries: StarEntry[] = [star('a', false), star('b', false)];
    field.draw(entries, 1, 800, 50);
    field.threads_draw([0, 0, 0, 1, 1, 1, 0, 0, 0, 2, 2, 2], [1, 1, 1, 1, 1, 1, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5]);
    const points = parent.children[0] as THREE.Points;
    const alpha = points.geometry.getAttribute('alpha') as THREE.BufferAttribute;
    const lines = parent.children[1] as THREE.LineSegments;
    const color = lines.geometry.getAttribute('color') as THREE.BufferAttribute;
    const versionBefore: number = alpha.version;
    field.stars_fade([entries[1] as StarEntry], 0.25);
    field.threads_fade([1], 0);
    expect(alpha.getX(0)).toBe(1);
    expect(alpha.getX(1)).toBe(0.25);
    expect(Array.from(color.array).slice(6)).toEqual([0, 0, 0, 0, 0, 0]);
    field.flush();
    expect(alpha.version).toBeGreaterThan(versionBefore);
  });

  it('marks a cluster with a nebula, dimmed at a third', () => {
    const parent = new THREE.Group();
    const field = new StarField(parent);
    field.nebula_add('shape:x', new THREE.Vector3(5, 0, 0), 3, new THREE.Color(1, 0.5, 0), true);
    expect(field.nebulae()).toEqual([{ id: 'shape:x', position: new THREE.Vector3(5, 0, 0), radius: 3 }]);
    const sprite = parent.children[0] as THREE.Sprite;
    expect(sprite.scale.x).toBe(6);
    expect(sprite.material.opacity).toBeCloseTo(0.2 / 3, 9);
  });

  it('forgets everything on a redraw', () => {
    const field = new StarField(new THREE.Group());
    field.draw([star('a', false)], 1, 800, 50);
    field.clear();
    expect(field.count()).toBe(0);
    expect(field.entry('a')).toBeUndefined();
    expect(field.nebulae()).toEqual([]);
  });
});
