/**
 * @file A paint names a colour: a palette token, a hue parsed once, or a
 * blend of two tokens by a share — so a theme change repaints it.
 */
import { describe, it, expect } from '@jest/globals';
import * as THREE from 'three';
import { paint_resolve, type Palette } from '../src/draw/palette.js';

const palette: Palette = {
  running: new THREE.Color('#ff7700'), done: new THREE.Color('#ffffff'), error: new THREE.Color('#ff0000'),
  template: new THREE.Color('#ffaa44'), unknown: new THREE.Color('#555555'), edge: new THREE.Color('#cc5500'),
  join: new THREE.Color('#ffcc99'), root: new THREE.Color('#6fbfae'), pulse: new THREE.Color('#48d8f0'),
};

describe('paint_resolve', () => {
  it('names a palette colour, and follows the palette it is handed', () => {
    expect(paint_resolve({ token: 'root' }, palette)).toBe(palette.root);
    const other: Palette = { ...palette, root: new THREE.Color('#000000') };
    expect(paint_resolve({ token: 'root' }, other).getHexString()).toBe('000000');
  });

  it('parses a hue once and hands the same colour back', () => {
    const first = paint_resolve({ hue: '#123456' }, palette);
    expect(first.getHexString()).toBe('123456');
    expect(paint_resolve({ hue: '#123456' }, palette)).toBe(first);
  });

  it('blends two tokens by a share, clamped, without touching the palette', () => {
    const half = paint_resolve({ blend: ['done', 'error'], share: 0.5 }, palette);
    expect(half.r).toBeCloseTo(1, 6);
    expect(half.g).toBeCloseTo(0.5, 6);
    expect(paint_resolve({ blend: ['done', 'error'], share: 3 }, palette).getHexString()).toBe('ff0000');
    expect(paint_resolve({ blend: ['done', 'error'], share: -1 }, palette).getHexString()).toBe('ffffff');
    expect(palette.done.getHexString()).toBe('ffffff');
  });
});
